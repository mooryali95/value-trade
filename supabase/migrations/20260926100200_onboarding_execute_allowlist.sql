-- ============================================================================
-- EXECUTE privileges for the onboarding functions (phase 3), following the
-- explicit allow-list pattern of 20260924100600_function_execute_audit.sql:
-- Supabase's default privileges grant EXECUTE on every new public function
-- to anon and authenticated, so each one is revoked from PUBLIC, anon and
-- authenticated and granted to service_role only. The server functions call
-- them with the verified user id of the caller.
-- Functions that do not exist on a given database are skipped.
-- ============================================================================
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    -- 20260926100000_invitation_lifecycle.sql
    'public.company_invitations_guard()',
    'public.company_has_member_email(uuid, text)',
    'public.create_company_invitation(uuid, text, public.company_role, uuid)',
    'public.renew_company_invitation(uuid, uuid, boolean)',
    'public.accept_company_invitation(uuid, uuid, text)',
    'public.invitation_preview(uuid)',
    'public.search_companies_public(text)',
    'public.get_company_by_slug_public(text)',
    -- 20260926100100_investor_access_requests.sql
    'public.access_request_reference()',
    'public.check_access_request_status_ref(text, text)',
    'public.approve_access_request(uuid, uuid, public.company_role, text, text)',
    'public.admin_pending_activations(uuid, integer)'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
