
-- 1. Restrict shariah_decision_audit reads to shariah_board members only
DROP POLICY IF EXISTS audit_read_all_auth ON public.shariah_decision_audit;
CREATE POLICY audit_read_shariah_board
  ON public.shariah_decision_audit
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'shariah_board'));

-- 2. Revoke EXECUTE on trigger-only SECURITY DEFINER functions from all app roles
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_shariah_decision_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_brand_cap() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_creator_as_owner() FROM PUBLIC, anon, authenticated;

-- 3. Restrict accept_company_invitation to signed-in users only
REVOKE EXECUTE ON FUNCTION public.accept_company_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_company_invitation(uuid) TO authenticated;

-- 4. Ensure role-check helpers (used inside RLS policies) are limited to authenticated
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_company_role(uuid, uuid, company_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_company_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_company_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, uuid, company_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid, uuid) TO authenticated;
