-- ============================================================================
-- Company membership is by invitation only (phase 3, onboarding).
--
-- Owners could INSERT company_members rows through the REST API
-- (policy members_insert_owner): any account, known by its id, could be
-- made a member (even an owner) without its consent, with a forged
-- invited_by. Joining a company now always goes through an invitation that
-- the invitee accepts from a confirmed address (accept_company_invitation,
-- service role only). Company creation keeps adding its creator as owner
-- through the add_creator_as_owner trigger (SECURITY DEFINER), and platform
-- admins repair memberships through the server (service role).
--
-- The INSERT policy is dropped, so every API insert is refused by row-level
-- security (the table keeps RLS enabled; the column grants stay as they are
-- so the refusal is the RLS error the existing checks expect). Owners keep
-- reading, re-assigning roles (protect_last_owner still guards the last
-- owner) and removing members.
-- ============================================================================

DROP POLICY IF EXISTS members_insert_owner ON public.company_members;
-- Any other INSERT-only policy an earlier environment may carry.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'company_members' AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.company_members', r.policyname);
  END LOOP;
END $$;

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- Belt and braces for the service role path used by the server.
GRANT ALL ON TABLE public.company_members TO service_role;
