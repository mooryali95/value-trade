-- ============================================================================
-- Company invitation lifecycle (phase 3, onboarding).
--
-- (1) Expiry is real. accept_company_invitation used to UPDATE the row to
--     'expired' and then RAISE, which rolled the update back: expired rows
--     stayed 'pending' for ever and blocked a new invitation to the same
--     address (company_invitations_unique_pending). Now:
--       * accept raises INVITATION_EXPIRED without writing anything (the
--         server marks the row expired afterwards, in its own statement);
--       * create_company_invitation expires stale rows of the same
--         company/address before inserting;
--       * renew_company_invitation extends a pending invitation, and rotates
--         the token of an expired one (the old link stops working).
-- (2) ALREADY_MEMBER: inviting (or accepting for) someone who is already a
--     member of the company is refused instead of "accepting" an invitation
--     that silently changed nothing.
-- (3) Invitations are written by the server only. Owners keep reading their
--     company's invitations and may revoke / un-revoke a pending one
--     (status only); every other column is frozen for API callers, so an
--     owner can no longer re-address an invitation, forge invited_by or
--     push expires_at ten years out through the REST API.
-- (4) The invitee read policy trusted the JWT email claim, which is not
--     proof of ownership when e-mail confirmation is off. It is dropped: the
--     server lists a user's invitations with the service role after checking
--     auth.users.email_confirmed_at.
-- (5) Platform admins can create, renew and re-issue invitations (e.g. the
--     owner invitation of a company created by an approved access request,
--     which has no member until its founder accepts).
-- (6) search_companies_public / get_company_by_slug_public only list
--     companies that have an owner, escape LIKE wildcards and cap results.
--
-- Every function here is SECURITY DEFINER, pins search_path and is
-- executable by service_role only (see 20260926100200).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Privileges and policies.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Invitees can read pending invitations for their email" ON public.company_invitations;

REVOKE ALL ON TABLE public.company_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.company_invitations TO authenticated;
GRANT UPDATE (status) ON TABLE public.company_invitations TO authenticated;
GRANT ALL ON TABLE public.company_invitations TO service_role;

-- ---------------------------------------------------------------------------
-- Guard: API users (owners, through RLS) may only move a pending invitation
-- to 'revoked' and back while it has not expired. Inserts come from the
-- server (service role / SECURITY DEFINER functions) only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.company_invitations_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- PostgREST switches every request to one of these roles; the server
  -- (service_role), migrations and the SQL editor are trusted.
  _user_api boolean := COALESCE(current_setting('role', true), 'none') IN ('anon', 'authenticated');
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.email := lower(btrim(NEW.email));
    IF _user_api THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT _user_api THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.token IS DISTINCT FROM OLD.token
     OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
     OR NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status = 'revoked' THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'revoked' AND NEW.status = 'pending' THEN
      IF OLD.expires_at <= now() THEN
        RAISE EXCEPTION 'INVITATION_EXPIRED';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_invitations_guard ON public.company_invitations;
CREATE TRIGGER company_invitations_guard
  BEFORE INSERT OR UPDATE ON public.company_invitations
  FOR EACH ROW EXECUTE FUNCTION public.company_invitations_guard();

-- Addresses are stored lower-case (the server matches them exactly). The
-- unique pending index is on lower(email), so this cannot collide.
UPDATE public.company_invitations
   SET email = lower(btrim(email))
 WHERE email <> lower(btrim(email));

-- ---------------------------------------------------------------------------
-- Is the address already a member of the company? (auth.users is read by
-- the definer; the result is only ever a boolean.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.company_has_member_email(_company_id uuid, _email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.company_members m
      JOIN auth.users u ON u.id = m.user_id
     WHERE m.company_id = _company_id
       AND lower(u.email) = lower(btrim(COALESCE(_email, '')))
  );
$$;

-- ---------------------------------------------------------------------------
-- create_company_invitation: the only way an invitation is created from the
-- app (the access-request approval inserts its own, in the same function as
-- the approval). Owners invite non-owner roles; a platform admin may invite
-- any role, including the owner of a company that has none.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_company_invitation(uuid, text, public.company_role, uuid);
CREATE OR REPLACE FUNCTION public.create_company_invitation(
  _company_id uuid,
  _email text,
  _role public.company_role,
  _actor_id uuid
)
RETURNS public.company_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _addr text := lower(btrim(COALESCE(_email, '')));
  _is_admin boolean;
  inv public.company_invitations;
BEGIN
  IF _actor_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  _is_admin := public.has_role(_actor_id, 'platform_admin');
  IF NOT (_is_admin OR public.is_company_owner(_actor_id, _company_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = _company_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _role IS NULL THEN
    RAISE EXCEPTION 'ROLE_REQUIRED';
  END IF;
  IF _role = 'owner' AND NOT _is_admin THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF char_length(_addr) > 320 OR _addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF public.company_has_member_email(_company_id, _addr) THEN
    RAISE EXCEPTION 'ALREADY_MEMBER';
  END IF;

  -- A pending invitation past its expiry no longer blocks a new one.
  UPDATE public.company_invitations ci
     SET status = 'expired'
   WHERE ci.company_id = _company_id
     AND lower(ci.email) = _addr
     AND ci.status = 'pending'
     AND ci.expires_at <= now();

  BEGIN
    INSERT INTO public.company_invitations (company_id, email, role, invited_by)
    VALUES (_company_id, _addr, _role, _actor_id)
    RETURNING * INTO inv;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'INVITATION_ALREADY_PENDING';
  END;
  RETURN inv;
END;
$$;

-- ---------------------------------------------------------------------------
-- renew_company_invitation: resend (extend by 7 days) or re-issue (new
-- token, the old link stops working). An expired invitation is always
-- re-issued with a new token.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.renew_company_invitation(uuid, uuid, boolean);
CREATE OR REPLACE FUNCTION public.renew_company_invitation(
  _invitation_id uuid,
  _actor_id uuid,
  _rotate_token boolean DEFAULT false
)
RETURNS public.company_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.company_invitations;
  _expired boolean;
BEGIN
  IF _actor_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  SELECT * INTO inv FROM public.company_invitations ci WHERE ci.id = _invitation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND';
  END IF;
  IF NOT (public.has_role(_actor_id, 'platform_admin') OR public.is_company_owner(_actor_id, inv.company_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF inv.status NOT IN ('pending', 'expired') THEN
    RAISE EXCEPTION 'INVITATION_NOT_PENDING';
  END IF;
  IF public.company_has_member_email(inv.company_id, inv.email) THEN
    RAISE EXCEPTION 'ALREADY_MEMBER';
  END IF;
  _expired := inv.status = 'expired' OR inv.expires_at <= now();

  IF inv.status = 'expired' THEN
    -- Other stale rows for the same address give way; a live one wins.
    UPDATE public.company_invitations ci
       SET status = 'expired'
     WHERE ci.company_id = inv.company_id
       AND lower(ci.email) = lower(inv.email)
       AND ci.status = 'pending'
       AND ci.id <> inv.id
       AND ci.expires_at <= now();
  END IF;

  BEGIN
    UPDATE public.company_invitations ci
       SET status = 'pending',
           expires_at = now() + interval '7 days',
           token = CASE WHEN _rotate_token OR _expired THEN gen_random_uuid() ELSE ci.token END
     WHERE ci.id = inv.id
    RETURNING * INTO inv;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'INVITATION_ALREADY_PENDING';
  END;
  RETURN inv;
END;
$$;

-- ---------------------------------------------------------------------------
-- accept_company_invitation: same signature and result as before.
--   * the account's own address (auth.users) must match the address the
--     server passes, which must match the invitation;
--   * expiry raises INVITATION_EXPIRED without an update that would be
--     rolled back anyway;
--   * an existing member gets ALREADY_MEMBER (role unchanged, invitation
--     left pending for the owner to revoke or re-issue).
-- The server additionally requires a confirmed e-mail address before it
-- calls this function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_company_invitation(_token uuid, _actor_id uuid, _actor_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite public.company_invitations;
  caller_email text := lower(btrim(COALESCE(_actor_email, '')));
  account_email text;
BEGIN
  IF _actor_id IS NULL OR caller_email = '' THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  SELECT lower(u.email) INTO account_email FROM auth.users u WHERE u.id = _actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF account_email IS NOT NULL AND account_email <> caller_email THEN
    RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH';
  END IF;

  SELECT * INTO invite FROM public.company_invitations ci
   WHERE ci.token = _token
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND';
  END IF;
  IF invite.status = 'expired' OR (invite.status = 'pending' AND invite.expires_at <= now()) THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED';
  END IF;
  IF invite.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_NOT_PENDING';
  END IF;
  IF lower(invite.email) <> caller_email THEN
    RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_members m
              WHERE m.company_id = invite.company_id AND m.user_id = _actor_id) THEN
    RAISE EXCEPTION 'ALREADY_MEMBER';
  END IF;

  INSERT INTO public.company_members (company_id, user_id, role, invited_by)
  VALUES (invite.company_id, _actor_id, invite.role, invite.invited_by);

  UPDATE public.company_invitations ci
     SET status = 'accepted', accepted_at = now(), accepted_by = _actor_id
   WHERE ci.id = invite.id;

  RETURN invite.company_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- invitation_preview: what the public /invite/<token> page may show. The
-- token is the secret; the address is masked by the server before it
-- reaches the browser. status is the effective status (a pending row past
-- its expiry reads 'expired').
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.invitation_preview(uuid);
CREATE OR REPLACE FUNCTION public.invitation_preview(_token uuid)
RETURNS TABLE(
  invitation_id uuid,
  company_id uuid,
  company_name_ar text,
  company_name_en text,
  email text,
  role public.company_role,
  status text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ci.id, ci.company_id, c.name_ar, c.name_en, lower(ci.email), ci.role,
         CASE WHEN ci.status = 'pending' AND ci.expires_at <= now() THEN 'expired' ELSE ci.status END,
         ci.expires_at
    FROM public.company_invitations ci
    JOIN public.companies c ON c.id = ci.company_id
   WHERE ci.token = _token
   LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Public company lookup for access requests: companies with an owner only,
-- LIKE wildcards in the query are literal, at most 8 rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_companies_public(_query text)
RETURNS TABLE (id uuid, slug text, name_ar text, name_en text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT btrim(COALESCE(_query, '')) AS raw,
           replace(replace(replace(left(btrim(COALESCE(_query, '')), 80), '\', '\\'), '%', '\%'), '_', '\_') AS pat
  )
  SELECT c.id, c.slug, c.name_ar, c.name_en
    FROM public.companies c, q
   WHERE char_length(q.raw) >= 2
     AND (c.name_ar ILIKE '%' || q.pat || '%'
          OR c.name_en ILIKE '%' || q.pat || '%'
          OR c.slug ILIKE '%' || q.pat || '%')
     AND EXISTS (SELECT 1 FROM public.company_members m WHERE m.company_id = c.id AND m.role = 'owner')
   ORDER BY c.name_en
   LIMIT 8;
$$;

CREATE OR REPLACE FUNCTION public.get_company_by_slug_public(_slug text)
RETURNS TABLE (id uuid, slug text, name_ar text, name_en text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.slug, c.name_ar, c.name_en
    FROM public.companies c
   WHERE c.slug = _slug
     AND EXISTS (SELECT 1 FROM public.company_members m WHERE m.company_id = c.id AND m.role = 'owner')
   LIMIT 1;
$$;
