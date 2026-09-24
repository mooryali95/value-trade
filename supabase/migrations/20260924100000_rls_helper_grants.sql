-- ============================================================================
-- RLS helper functions must stay executable by `authenticated`.
--
-- has_role / has_company_role / is_company_owner / is_company_member are
-- called from ~20 RLS policies (user_roles, companies, company_members,
-- company_brands, company_invitations, brands, product_submissions,
-- submission_documents, audit_log, access_requests, ops_*), and server code
-- calls rpc('has_role') with the signed-in user's client. A policy
-- expression is evaluated with the privileges of the querying role, so when
-- 20260714134141 revoked EXECUTE from `authenticated`, every signed-in read of
-- those tables failed with "permission denied for function has_role".
--
-- DO NOT revoke EXECUTE on these four from `authenticated` again, even if a
-- security scanner flags "SECURITY DEFINER function executable by
-- authenticated": RLS needs it. They only return a boolean about role
-- membership. anon and PUBLIC stay revoked (no anon policy calls them).
-- ============================================================================

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_company_role(uuid, uuid, public.company_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_company_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_company_member(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, uuid, public.company_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_company_owner(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.has_role(uuid, public.app_role) IS
  'RLS helper. authenticated MUST keep EXECUTE: RLS policies call it with the caller''s privileges. Do not revoke.';
COMMENT ON FUNCTION public.has_company_role(uuid, uuid, public.company_role) IS
  'RLS helper. authenticated MUST keep EXECUTE: RLS policies call it with the caller''s privileges. Do not revoke.';
COMMENT ON FUNCTION public.is_company_owner(uuid, uuid) IS
  'RLS helper. authenticated MUST keep EXECUTE: RLS policies call it with the caller''s privileges. Do not revoke.';
COMMENT ON FUNCTION public.is_company_member(uuid, uuid) IS
  'RLS helper. authenticated MUST keep EXECUTE: RLS policies call it with the caller''s privileges. Do not revoke.';
