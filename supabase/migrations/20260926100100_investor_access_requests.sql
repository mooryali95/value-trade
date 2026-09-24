-- ============================================================================
-- Access requests from investors, short reference codes, and the admin's
-- "pending activation" queue (phase 3, onboarding).
--
-- (1) join_method 'investor': a person asks to invest (no company). Only a
--     platform admin approves or rejects it. Approval records the decision
--     only; the server then sends the platform invitation (a Supabase Auth
--     invite link to set a password) and the account appears in the admin's
--     pending-activation queue. Trading is still activated by an admin
--     (user_roles 'trader') and cash still arrives only through deposits.
-- (2) reference_code: a short code (VU-XXXX-XXXX, 40 random bits from
--     gen_random_uuid) shown to the applicant and e-mailed to them, usable
--     with their e-mail address to check the request status.
-- (3) admin_pending_activations: platform-admin-only list of accounts that
--     are waiting for trading activation.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Shape checks. Any older check that mentions join_method is replaced.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.access_requests'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%join_method%'
  LOOP
    EXECUTE format('ALTER TABLE public.access_requests DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.access_requests ADD CONSTRAINT access_requests_join_method_check
  CHECK (join_method IN ('search', 'link', 'new_company', 'investor'));
ALTER TABLE public.access_requests ADD CONSTRAINT access_requests_target_shape CHECK (
  (join_method IN ('search', 'link') AND requested_company_id IS NOT NULL
     AND new_company_name_ar IS NULL AND new_company_name_en IS NULL)
  OR (join_method = 'new_company' AND requested_company_id IS NULL
     AND new_company_name_ar IS NOT NULL AND new_company_name_en IS NOT NULL)
  OR (join_method = 'investor' AND requested_company_id IS NULL
     AND new_company_name_ar IS NULL AND new_company_name_en IS NULL)
) NOT VALID;
-- A company deleted after a join request was filed leaves requested_company_id
-- NULL (ON DELETE SET NULL): such legacy rows keep the check NOT VALID.
DO $$ BEGIN
  ALTER TABLE public.access_requests VALIDATE CONSTRAINT access_requests_target_shape;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'access_requests has legacy rows whose company was deleted; shape check left NOT VALID';
END $$;

-- ---------------------------------------------------------------------------
-- 2) Reference codes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.access_request_reference()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  -- 32 symbols, no 0/O/1/I: 256 is a multiple of 32, so byte % 32 is uniform.
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  -- Bytes 6 and 8 carry the UUID version/variant bits: skip them.
  idx constant integer[] := ARRAY[0, 1, 2, 3, 4, 5, 9, 10];
  code text := '';
  i integer;
BEGIN
  FOREACH i IN ARRAY idx LOOP
    code := code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  END LOOP;
  RETURN 'VU-' || substr(code, 1, 4) || '-' || substr(code, 5, 4);
END;
$$;

ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS reference_code text;
UPDATE public.access_requests SET reference_code = public.access_request_reference() WHERE reference_code IS NULL;
ALTER TABLE public.access_requests ALTER COLUMN reference_code SET DEFAULT public.access_request_reference();
ALTER TABLE public.access_requests ALTER COLUMN reference_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_reference_code_key ON public.access_requests (reference_code);

-- Status by reference code + e-mail (the unauthenticated status check).
DROP FUNCTION IF EXISTS public.check_access_request_status_ref(text, text);
CREATE OR REPLACE FUNCTION public.check_access_request_status_ref(_ref text, _email text)
RETURNS TABLE(status text, reviewed_at timestamptz, join_method text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ar.status, ar.reviewed_at, ar.join_method
    FROM public.access_requests ar
   WHERE ar.reference_code = upper(btrim(COALESCE(_ref, '')))
     AND lower(ar.email) = lower(btrim(COALESCE(_email, '')))
   LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 3) Approval: investor requests. Same signature and result columns; an
--    investor approval returns NULLs (no company, no company invitation).
-- ---------------------------------------------------------------------------
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

  IF req.join_method = 'investor' THEN
    -- Investor: platform_admin only. No company, no role: the account is
    -- invited to the platform by the server and activated by an admin.
    IF NOT public.has_role(_actor_id, 'platform_admin') THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    UPDATE public.access_requests ar
       SET status = 'approved', reviewed_by = _actor_id, reviewed_at = now()
     WHERE ar.id = _request_id;
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
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
    IF _role = 'owner' AND NOT public.has_role(_actor_id, 'platform_admin') THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF public.company_has_member_email(req.requested_company_id, req.email) THEN
      RAISE EXCEPTION 'ALREADY_MEMBER';
    END IF;

    v_company_id := req.requested_company_id;
    -- A pending invitation past its expiry no longer blocks this one.
    UPDATE public.company_invitations ci
       SET status = 'expired'
     WHERE ci.company_id = v_company_id
       AND lower(ci.email) = lower(req.email)
       AND ci.status = 'pending'
       AND ci.expires_at <= now();
    INSERT INTO public.company_invitations (company_id, email, role, invited_by)
    VALUES (v_company_id, req.email, _role, _actor_id)
    RETURNING * INTO inv;
  ELSIF req.join_method = 'new_company' THEN
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
  ELSE
    -- A join request whose company was deleted since.
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
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

-- ---------------------------------------------------------------------------
-- 4) Pending activation queue (platform admin only).
--    source:
--      'investor_request'   approved investor request, account exists
--      'invited_no_account' approved investor request, no account yet (the
--                           platform invitation was not used yet)
--      'no_role'            account with no platform role and no company
--    Accounts holding the trader role are never listed.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_pending_activations(uuid, integer);
CREATE OR REPLACE FUNCTION public.admin_pending_activations(_actor_id uuid, _limit integer DEFAULT 200)
RETURNS TABLE(
  user_id uuid,
  email text,
  full_name text,
  created_at timestamptz,
  email_confirmed boolean,
  source text,
  request_id uuid,
  request_reference text,
  requested_at timestamptz,
  pending_company_invitations integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;

  RETURN QUERY
  WITH inv_req AS (
    SELECT DISTINCT ON (lower(ar.email))
           lower(ar.email) AS addr, ar.id, ar.reference_code, ar.full_name, ar.created_at, ar.reviewed_at
      FROM public.access_requests ar
     WHERE ar.join_method = 'investor' AND ar.status = 'approved'
     ORDER BY lower(ar.email), ar.reviewed_at DESC NULLS LAST, ar.created_at DESC
  ),
  accounts AS (
    SELECT u.id AS uid, lower(u.email) AS addr, u.created_at AS u_created, u.email_confirmed_at IS NOT NULL AS confirmed
      FROM auth.users u
     WHERE u.email IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'trader')
  ),
  cand AS (
    SELECT a.uid, a.addr, COALESCE(p.full_name, ir.full_name) AS name, a.u_created, a.confirmed,
           'investor_request'::text AS src, ir.id AS rid, ir.reference_code AS rref, ir.created_at AS rat
      FROM accounts a
      JOIN inv_req ir ON ir.addr = a.addr
      LEFT JOIN public.profiles p ON p.id = a.uid
    UNION ALL
    SELECT a.uid, a.addr, p.full_name, a.u_created, a.confirmed,
           'no_role'::text, NULL::uuid, NULL::text, NULL::timestamptz
      FROM accounts a
      LEFT JOIN public.profiles p ON p.id = a.uid
     WHERE NOT EXISTS (SELECT 1 FROM inv_req ir WHERE ir.addr = a.addr)
       AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = a.uid)
       AND NOT EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = a.uid)
    UNION ALL
    SELECT NULL::uuid, ir.addr, ir.full_name, NULL::timestamptz, false,
           'invited_no_account'::text, ir.id, ir.reference_code, ir.created_at
      FROM inv_req ir
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = ir.addr)
  )
  SELECT r.uid, r.addr, r.name, r.u_created, r.confirmed, r.src, r.rid, r.rref, r.rat,
         (SELECT count(*)::integer FROM public.company_invitations ci
           WHERE lower(ci.email) = r.addr AND ci.status = 'pending' AND ci.expires_at > now())
    FROM cand r
   ORDER BY COALESCE(r.rat, r.u_created) DESC NULLS LAST, r.addr
   LIMIT GREATEST(1, LEAST(COALESCE(_limit, 200), 500));
END;
$$;
