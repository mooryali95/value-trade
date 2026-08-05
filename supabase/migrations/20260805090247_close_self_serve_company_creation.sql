-- ============================================================================
-- Close self-serve company creation. Previously any authenticated user could
-- INSERT into companies with created_by = themselves and instantly become
-- owner via the add_creator_as_owner trigger -- a full bypass of the
-- access_requests approval flow (20260802121145_access_requests.sql).
--
-- New companies now only get created through approve_access_request(),
-- which is SECURITY DEFINER and therefore unaffected by this RLS change.
-- Direct creation stays available to platform_admin only, as an
-- administrative shortcut (e.g. seeding, support cases) -- still fully
-- audited the same way any admin action is.
-- ============================================================================

DROP POLICY "companies_insert_self" ON public.companies;

CREATE POLICY "companies_insert_admin_only" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'));
