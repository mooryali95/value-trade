-- 1) Public lookup helpers: only trusted server code (service_role) may execute.
REVOKE EXECUTE ON FUNCTION public.search_companies_public(text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_company_by_slug_public(text) FROM anon, authenticated, PUBLIC;

-- 2) Invitation acceptance: actor identity supplied by the trusted server.
DROP FUNCTION IF EXISTS public.accept_company_invitation(uuid);

CREATE OR REPLACE FUNCTION public.accept_company_invitation(_token uuid, _actor_id uuid, _actor_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  invite record;
  caller_email text := lower(coalesce(_actor_email, ''));
BEGIN
  IF _actor_id IS NULL OR caller_email = '' THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO invite FROM public.company_invitations
   WHERE token = _token
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND';
  END IF;
  IF invite.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_NOT_PENDING';
  END IF;
  IF invite.expires_at < now() THEN
    UPDATE public.company_invitations SET status = 'expired' WHERE id = invite.id;
    RAISE EXCEPTION 'INVITATION_EXPIRED';
  END IF;
  IF lower(invite.email) <> caller_email THEN
    RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH';
  END IF;

  INSERT INTO public.company_members (company_id, user_id, role, invited_by)
  VALUES (invite.company_id, _actor_id, invite.role, invite.invited_by)
  ON CONFLICT (company_id, user_id) DO NOTHING;

  UPDATE public.company_invitations
     SET status = 'accepted', accepted_at = now(), accepted_by = _actor_id
   WHERE id = invite.id;

  RETURN invite.company_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_company_invitation(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_company_invitation(uuid, uuid, text) TO service_role;

-- 3) Access request approval.
DROP FUNCTION IF EXISTS public.approve_access_request(uuid, company_role, text, text);

CREATE OR REPLACE FUNCTION public.approve_access_request(_request_id uuid, _actor_id uuid, _role company_role DEFAULT NULL::company_role, _sector text DEFAULT NULL::text, _slug text DEFAULT NULL::text)
RETURNS TABLE(invitation_id uuid, invitation_token uuid, company_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  req record;
  new_co_id uuid;
  inv record;
BEGIN
  IF _actor_id IS NULL THEN
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
    IF NOT (public.is_company_owner(_actor_id, req.requested_company_id) OR public.has_role(_actor_id, 'platform_admin')) THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF _role IS NULL THEN
      RAISE EXCEPTION 'ROLE_REQUIRED';
    END IF;

    INSERT INTO public.company_invitations (company_id, email, role, invited_by)
    VALUES (req.requested_company_id, req.email, _role, _actor_id)
    RETURNING * INTO inv;

    new_co_id := req.requested_company_id;
  ELSE
    IF NOT public.has_role(_actor_id, 'platform_admin') THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF _slug IS NULL OR _sector IS NULL THEN
      RAISE EXCEPTION 'SLUG_AND_SECTOR_REQUIRED';
    END IF;

    INSERT INTO public.companies (slug, name_ar, name_en, sector, created_by)
    VALUES (_slug, req.new_company_name_ar, req.new_company_name_en, _sector, _actor_id)
    RETURNING id INTO new_co_id;

    DELETE FROM public.company_members WHERE company_id = new_co_id AND user_id = _actor_id;

    INSERT INTO public.company_invitations (company_id, email, role, invited_by)
    VALUES (new_co_id, req.email, 'owner', _actor_id)
    RETURNING * INTO inv;
  END IF;

  UPDATE public.access_requests
  SET status = 'approved', reviewed_by = _actor_id, reviewed_at = now(), resulting_invitation_id = inv.id
  WHERE id = _request_id;

  RETURN QUERY SELECT inv.id, inv.token, new_co_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'INVITATION_ALREADY_PENDING';
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_access_request(uuid, uuid, company_role, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_access_request(uuid, uuid, company_role, text, text) TO service_role;

-- 4) Access request rejection.
DROP FUNCTION IF EXISTS public.reject_access_request(uuid, text);

CREATE OR REPLACE FUNCTION public.reject_access_request(_request_id uuid, _actor_id uuid, _reason text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  req record;
BEGIN
  IF _actor_id IS NULL THEN
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
    (req.requested_company_id IS NOT NULL AND public.is_company_owner(_actor_id, req.requested_company_id))
    OR public.has_role(_actor_id, 'platform_admin')
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.access_requests
  SET status = 'rejected', reviewed_by = _actor_id, reviewed_at = now(), rejection_reason = _reason
  WHERE id = _request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_access_request(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_access_request(uuid, uuid, text) TO service_role;