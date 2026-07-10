
-- 1) Table
CREATE TABLE public.company_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.company_role NOT NULL,
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX company_invitations_company_idx ON public.company_invitations(company_id);
CREATE INDEX company_invitations_email_idx ON public.company_invitations(lower(email));
CREATE UNIQUE INDEX company_invitations_unique_pending
  ON public.company_invitations(company_id, lower(email))
  WHERE status = 'pending';

-- 2) Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_invitations TO authenticated;
GRANT ALL ON public.company_invitations TO service_role;

-- 3) RLS
ALTER TABLE public.company_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage invitations for their company"
  ON public.company_invitations
  FOR ALL TO authenticated
  USING (public.is_company_owner(auth.uid(), company_id))
  WITH CHECK (public.is_company_owner(auth.uid(), company_id));

CREATE POLICY "Invitees can read pending invitations for their email"
  ON public.company_invitations
  FOR SELECT TO authenticated
  USING (
    status = 'pending'
    AND lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  );

-- 4) Acceptance RPC (security definer): validates token, expiry, and email match,
-- inserts into company_members, marks invitation accepted, returns company_id.
CREATE OR REPLACE FUNCTION public.accept_company_invitation(_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite record;
  caller_email text := lower(coalesce((auth.jwt() ->> 'email'), ''));
BEGIN
  IF auth.uid() IS NULL THEN
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
  VALUES (invite.company_id, auth.uid(), invite.role, invite.invited_by)
  ON CONFLICT (company_id, user_id) DO NOTHING;

  UPDATE public.company_invitations
     SET status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   WHERE id = invite.id;

  RETURN invite.company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_company_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_company_invitation(uuid) TO authenticated;
