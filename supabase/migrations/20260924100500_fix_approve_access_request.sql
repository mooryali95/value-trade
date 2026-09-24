-- ============================================================================
-- approve_access_request: fix the "new company" path.
--
-- (a) Its RETURNS TABLE output column `company_id` is also a PL/pgSQL
--     variable, so `DELETE ... WHERE company_id = new_co_id` was ambiguous
--     and every new-company approval failed.
-- (b) The old flow created the company (the add_creator_as_owner trigger
--     made the approving admin its owner) and then deleted the admin again,
--     which protect_last_owner rejects with LAST_OWNER_PROTECTED.
--
-- Now the company is created without any member (a transaction-local flag
-- tells add_creator_as_owner to skip); the applicant becomes its owner by
-- accepting the 'owner' invitation. Signature and result columns unchanged.
-- New error code: SLUG_TAKEN (the requested company slug already exists).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.add_creator_as_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set (transaction-local) only by approve_access_request, which creates a
  -- company on behalf of an applicant who is not a member yet.
  IF current_setting('app.skip_creator_owner', true) = 'on' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.company_members (company_id, user_id, role, invited_by)
  VALUES (NEW.id, NEW.created_by, 'owner', NEW.created_by)
  ON CONFLICT (company_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.add_creator_as_owner() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_access_request(
  _request_id uuid,
  _actor_id uuid,
  _role public.company_role DEFAULT NULL::public.company_role,
  _sector text DEFAULT NULL::text,
  _slug text DEFAULT NULL::text
)
RETURNS TABLE(invitation_id uuid, invitation_token uuid, company_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  req public.access_requests;
  v_company_id uuid;
  inv public.company_invitations;
  v_constraint text;
BEGIN
  IF _actor_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO req FROM public.access_requests ar WHERE ar.id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING';
  END IF;

  IF req.requested_company_id IS NOT NULL THEN
    -- Joining an existing company: its owner or a platform_admin approves.
    IF NOT (public.is_company_owner(_actor_id, req.requested_company_id)
            OR public.has_role(_actor_id, 'platform_admin')) THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF _role IS NULL THEN
      RAISE EXCEPTION 'ROLE_REQUIRED';
    END IF;

    v_company_id := req.requested_company_id;
    INSERT INTO public.company_invitations (company_id, email, role, invited_by)
    VALUES (v_company_id, req.email, _role, _actor_id)
    RETURNING * INTO inv;
  ELSE
    -- Brand-new company: platform_admin only; the applicant is invited as
    -- its owner.
    IF NOT public.has_role(_actor_id, 'platform_admin') THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF _slug IS NULL OR _sector IS NULL OR btrim(_slug) = '' OR btrim(_sector) = '' THEN
      RAISE EXCEPTION 'SLUG_AND_SECTOR_REQUIRED';
    END IF;
    IF EXISTS (SELECT 1 FROM public.companies c WHERE c.slug = _slug) THEN
      RAISE EXCEPTION 'SLUG_TAKEN';
    END IF;

    PERFORM set_config('app.skip_creator_owner', 'on', true);
    INSERT INTO public.companies (slug, name_ar, name_en, sector, created_by)
    VALUES (_slug, req.new_company_name_ar, req.new_company_name_en, _sector, _actor_id)
    RETURNING id INTO v_company_id;
    PERFORM set_config('app.skip_creator_owner', '', true);

    INSERT INTO public.company_invitations (company_id, email, role, invited_by)
    VALUES (v_company_id, req.email, 'owner', _actor_id)
    RETURNING * INTO inv;
  END IF;

  UPDATE public.access_requests ar
     SET status = 'approved', reviewed_by = _actor_id, reviewed_at = now(),
         resulting_invitation_id = inv.id
   WHERE ar.id = _request_id;

  RETURN QUERY SELECT inv.id, inv.token, v_company_id;
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'companies_slug_key' THEN
      RAISE EXCEPTION 'SLUG_TAKEN';
    END IF;
    -- company_invitations_unique_pending: the applicant already has a
    -- pending invitation to this company.
    RAISE EXCEPTION 'INVITATION_ALREADY_PENDING';
END;
$$;
REVOKE ALL ON FUNCTION public.approve_access_request(uuid, uuid, public.company_role, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_access_request(uuid, uuid, public.company_role, text, text) TO service_role;
