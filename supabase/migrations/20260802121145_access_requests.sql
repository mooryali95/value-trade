-- ============================================================================
-- Access Requests: gated self-registration replacing open signup
--
-- Two request paths:
--   A) requested_company_id set   -> visible/actionable ONLY by that company's
--      owner(s), via the existing is_company_owner() pattern (same as
--      company_invitations). Full tenant isolation, enforced at the DB level.
--   B) requested_company_id NULL  -> "new company" request; visible/actionable
--      ONLY by platform_admin, who classifies it (sector) on approval.
--
-- Approval does not create a Supabase Auth account directly. It creates a
-- company_invitations row (existing, battle-tested flow: token + email +
-- accept_company_invitation), reusing infrastructure instead of duplicating it.
-- ============================================================================

-- 1) Classification field for platform_admin when approving a brand-new company
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS sector text;

-- 2) access_requests table
CREATE TABLE public.access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text NOT NULL,
  requested_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  new_company_name_ar text,
  new_company_name_en text,
  join_method text NOT NULL CHECK (join_method IN ('search', 'link', 'new_company')),
  assigned_role public.company_role,
  sector text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  resulting_invitation_id uuid REFERENCES public.company_invitations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_requests_target_shape CHECK (
    (join_method IN ('search', 'link') AND requested_company_id IS NOT NULL AND new_company_name_ar IS NULL AND new_company_name_en IS NULL)
    OR
    (join_method = 'new_company' AND requested_company_id IS NULL AND new_company_name_ar IS NOT NULL AND new_company_name_en IS NOT NULL)
  )
);

CREATE INDEX access_requests_company_idx ON public.access_requests(requested_company_id);
CREATE INDEX access_requests_status_idx ON public.access_requests(status);
CREATE INDEX access_requests_email_idx ON public.access_requests(lower(email));

GRANT SELECT, INSERT, UPDATE ON public.access_requests TO authenticated;
GRANT INSERT ON public.access_requests TO anon;
GRANT ALL ON public.access_requests TO service_role;
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

-- Anyone (even signed-out visitors) can submit a request, but only ever as
-- a fresh pending row -- they cannot self-approve or backdate a review.
CREATE POLICY "access_requests_insert_public" ON public.access_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL
    AND resulting_invitation_id IS NULL
  );

-- Tenant-scoped read: a company owner sees ONLY requests targeting their own
-- company. platform_admin sees everything (oversight + new-company queue).
CREATE POLICY "access_requests_select_scoped" ON public.access_requests
  FOR SELECT TO authenticated
  USING (
    (requested_company_id IS NOT NULL AND public.is_company_owner(auth.uid(), requested_company_id))
    OR public.has_role(auth.uid(), 'platform_admin')
  );

CREATE POLICY "access_requests_update_scoped" ON public.access_requests
  FOR UPDATE TO authenticated
  USING (
    (requested_company_id IS NOT NULL AND public.is_company_owner(auth.uid(), requested_company_id))
    OR public.has_role(auth.uid(), 'platform_admin')
  )
  WITH CHECK (
    (requested_company_id IS NOT NULL AND public.is_company_owner(auth.uid(), requested_company_id))
    OR public.has_role(auth.uid(), 'platform_admin')
  );

-- 3) Public, minimal-exposure company search (name/slug/id only) so an
--    unauthenticated visitor can find the company they want to join.
--    `companies` itself stays members-only; this RPC is the sole public window.
CREATE OR REPLACE FUNCTION public.search_companies_public(_query text)
RETURNS TABLE (id uuid, slug text, name_ar text, name_en text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, slug, name_ar, name_en
  FROM public.companies
  WHERE name_ar ILIKE '%' || _query || '%' OR name_en ILIKE '%' || _query || '%' OR slug ILIKE '%' || _query || '%'
  ORDER BY name_en
  LIMIT 10;
$$;
REVOKE EXECUTE ON FUNCTION public.search_companies_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_companies_public(text) TO anon, authenticated;

-- Same shape, for the direct-link join method (company.com/join/:slug).
CREATE OR REPLACE FUNCTION public.get_company_by_slug_public(_slug text)
RETURNS TABLE (id uuid, slug text, name_ar text, name_en text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, slug, name_ar, name_en FROM public.companies WHERE slug = _slug LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.get_company_by_slug_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_by_slug_public(text) TO anon, authenticated;

-- 4) Atomic approval. Encapsulates the whole transaction (company creation
--    for path B, invitation creation, request bookkeeping) so it can never
--    be left half-applied, and re-checks authorization server-side even
--    though RLS already gates the UPDATE -- defense in depth for a
--    multi-table write.
CREATE OR REPLACE FUNCTION public.approve_access_request(
  _request_id uuid,
  _role public.company_role DEFAULT NULL,   -- required for search/link paths
  _sector text DEFAULT NULL,                -- required for new_company path
  _slug text DEFAULT NULL                   -- required for new_company path
)
RETURNS TABLE (invitation_id uuid, invitation_token uuid, company_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  req record;
  new_co_id uuid;
  inv record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO req FROM public.access_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING';
  END IF;

  IF req.requested_company_id IS NOT NULL THEN
    -- Path A/B: joining an existing company. Only that company's owner
    -- (or platform_admin) may approve.
    IF NOT (public.is_company_owner(auth.uid(), req.requested_company_id) OR public.has_role(auth.uid(), 'platform_admin')) THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF _role IS NULL THEN
      RAISE EXCEPTION 'ROLE_REQUIRED';
    END IF;

    INSERT INTO public.company_invitations (company_id, email, role, invited_by)
    VALUES (req.requested_company_id, req.email, _role, auth.uid())
    RETURNING * INTO inv;

    new_co_id := req.requested_company_id;
  ELSE
    -- Path C: brand-new company. Only platform_admin may approve + classify.
    IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF _slug IS NULL OR _sector IS NULL THEN
      RAISE EXCEPTION 'SLUG_AND_SECTOR_REQUIRED';
    END IF;

    INSERT INTO public.companies (slug, name_ar, name_en, sector, created_by)
    VALUES (_slug, req.new_company_name_ar, req.new_company_name_en, _sector, auth.uid())
    RETURNING id INTO new_co_id;

    -- The insert trigger auto-adds the approving admin as owner; the real
    -- owner is the requester, added below once they accept the invite.
    DELETE FROM public.company_members WHERE company_id = new_co_id AND user_id = auth.uid();

    INSERT INTO public.company_invitations (company_id, email, role, invited_by)
    VALUES (new_co_id, req.email, 'owner', auth.uid())
    RETURNING * INTO inv;
  END IF;

  UPDATE public.access_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), resulting_invitation_id = inv.id
  WHERE id = _request_id;

  RETURN QUERY SELECT inv.id, inv.token, new_co_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.approve_access_request(uuid, public.company_role, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_access_request(uuid, public.company_role, text, text) TO authenticated;

-- 5) Rejection (simpler: no side effects beyond the row itself).
CREATE OR REPLACE FUNCTION public.reject_access_request(_request_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  req record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO req FROM public.access_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING';
  END IF;

  IF NOT (
    (req.requested_company_id IS NOT NULL AND public.is_company_owner(auth.uid(), req.requested_company_id))
    OR public.has_role(auth.uid(), 'platform_admin')
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.access_requests
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = _reason
  WHERE id = _request_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reject_access_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_access_request(uuid, text) TO authenticated;

-- 6) Submission rate limiting: reuse the existing check_rate_limit
--    (service_role only), called from the TS server function per email+IP.
--    No table changes needed here -- see access-requests.functions.ts.
