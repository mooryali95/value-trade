-- ============================================================================
-- Table privilege lockdown (launch audit C1 and follow-ups).
--
-- Supabase's default privileges grant ALL on every new public table to anon
-- and authenticated, and several tables were created with explicit user
-- write grants plus FOR ALL own-row policies. On the financial tables that
-- let a signed-in user set their own cash_balance, mint positions, insert
-- fake resting orders (with a backdated created_at for time priority) or
-- insert status='filled' rows that fed the public market statistics.
--
-- The model after this migration:
--   * every public table: REVOKE ALL from PUBLIC/anon/authenticated, then an
--     explicit per-table allow-list below; service_role keeps ALL;
--   * portfolios, positions, orders, orders_audit, cash_ledger, trades are
--     READ-ONLY for users (own rows). Only SECURITY DEFINER functions called
--     by the server with the service role (match_order, cancel_order,
--     replace_order, restore_order, post_cash_movement) write them;
--   * audit_log and access_requests have no user write path (the server
--     writes them with the service role after validation);
--   * user-owned preference rows (price_alerts, symbol_watchers,
--     notification_preferences, profiles) stay writable, own row only.
-- Written defensively: it must apply both on a fresh rebuild and on a
-- production database whose grants/policies may have drifted.
-- ============================================================================

-- 1) Reset privileges on every known public table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'user_roles', 'portfolios', 'positions', 'orders',
    'shariah_decisions', 'price_alerts', 'companies', 'company_members',
    'company_brands', 'product_submissions', 'shariah_decision_audit',
    'orders_audit', 'company_invitations', 'audit_log', 'rate_limits',
    'email_send_log', 'email_send_state', 'suppressed_emails',
    'email_unsubscribe_tokens', 'symbol_watchers', 'notification_preferences',
    'access_requests', 'cash_ledger', 'submission_documents', 'ops_run_log',
    'ops_settings', 'brands', 'trades'
  ] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- 2) Explicit allow-list. Every grant below is still filtered by RLS.

-- Own profile (policies: profiles_self_*). Identity/timestamps not writable.
GRANT SELECT ON public.profiles TO authenticated;
GRANT INSERT (id, full_name, avatar_url, locale) ON public.profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url, locale) ON public.profiles TO authenticated;

-- App roles: users read their own; writes pass RLS only for platform_admin
-- (user_roles_admin_all). Investor activation = admin grants 'trader'.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;

-- Financial state: read-only for users.
GRANT SELECT ON public.portfolios TO authenticated;
GRANT SELECT ON public.positions TO authenticated;
GRANT SELECT ON public.orders TO authenticated;
GRANT SELECT ON public.orders_audit TO authenticated;
GRANT SELECT ON public.cash_ledger TO authenticated;
-- trades: counterparty identities (buyer_id/seller_id) are not readable by
-- users; the RLS policy still filters on them. The server returns a trader's
-- own executions with their side via list_my_trades().
GRANT SELECT (id, symbol, asset_class, qty, price, created_at) ON public.trades TO authenticated;

-- Shariah rulings are public; the board writes them. reviewer_id /
-- updated_by are stamped from auth.uid() by a trigger (see the trading
-- engine migration), so they are not client-writable columns.
GRANT SELECT ON public.shariah_decisions TO anon, authenticated;
GRANT INSERT (symbol, status, reason) ON public.shariah_decisions TO authenticated;
GRANT UPDATE (status, reason) ON public.shariah_decisions TO authenticated;
GRANT SELECT ON public.shariah_decision_audit TO authenticated;

-- User-owned preferences.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.symbol_watchers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;

-- Tenancy. Direct company creation stays platform_admin-only (RLS); owners
-- may rename their company; member rows only ever change role in place.
GRANT SELECT, INSERT ON public.companies TO authenticated;
GRANT UPDATE (name_ar, name_en) ON public.companies TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.company_members TO authenticated;
GRANT UPDATE (role) ON public.company_members TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.company_brands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_invitations TO authenticated;

-- Submissions: companies submit, the Shariah board decides. Only the decision
-- columns are updatable; a trigger forces fresh inserts to 'pending'.
GRANT SELECT, INSERT ON public.product_submissions TO authenticated;
GRANT UPDATE (status, reviewer_id, review_reason, reviewed_at) ON public.product_submissions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.submission_documents TO authenticated;

-- Instruments: public read of published rows; platform_admin inserts;
-- owners update descriptive fields only (trigger in governance migration).
GRANT SELECT ON public.brands TO anon, authenticated;
GRANT INSERT, UPDATE ON public.brands TO authenticated;

-- Read-only governance / ops tables.
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT ON public.access_requests TO authenticated;
GRANT SELECT ON public.ops_run_log TO authenticated;
GRANT SELECT ON public.ops_settings TO authenticated;

-- rate_limits, email_send_log, email_send_state, suppressed_emails,
-- email_unsubscribe_tokens: service_role only (no grant to anon/authenticated).

-- 3) Policies on the financial tables: SELECT-only, own rows. Policies may
-- have been added under other names on a drifted database, so every policy
-- on these tables is dropped (and every write policy on the server-written
-- governance tables) before the intended ones are recreated.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.tablename, p.policyname
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND (p.tablename IN ('portfolios', 'positions', 'orders', 'orders_audit', 'cash_ledger', 'trades')
            OR (p.tablename IN ('audit_log', 'access_requests', 'shariah_decision_audit')
                AND p.cmd <> 'SELECT'))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "portfolios_self" ON public.portfolios;
DROP POLICY IF EXISTS "portfolios_select_own" ON public.portfolios;
CREATE POLICY "portfolios_select_own" ON public.portfolios
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "positions_self" ON public.positions;
DROP POLICY IF EXISTS "positions_select_own" ON public.positions;
CREATE POLICY "positions_select_own" ON public.positions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "orders_self" ON public.orders;
DROP POLICY IF EXISTS "orders_select_own" ON public.orders;
CREATE POLICY "orders_select_own" ON public.orders
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "orders_audit_owner_insert" ON public.orders_audit;
DROP POLICY IF EXISTS "orders_audit_owner_read" ON public.orders_audit;
CREATE POLICY "orders_audit_owner_read" ON public.orders_audit
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = orders_audit.order_id AND o.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "cash_ledger_read_own" ON public.cash_ledger;
CREATE POLICY "cash_ledger_read_own" ON public.cash_ledger
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "trades_own_read" ON public.trades;
CREATE POLICY "trades_own_read" ON public.trades
  FOR SELECT TO authenticated
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- 4) User-writable tables: make sure every write policy pins the row owner.
DROP POLICY IF EXISTS "alerts_self" ON public.price_alerts;
CREATE POLICY "alerts_self" ON public.price_alerts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "watchers_self" ON public.symbol_watchers;
CREATE POLICY "watchers_self" ON public.symbol_watchers
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "prefs_self" ON public.notification_preferences;
CREATE POLICY "prefs_self" ON public.notification_preferences
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "profiles_self_insert" ON public.profiles;
CREATE POLICY "profiles_self_insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Basic shape checks on user-written alert rows (NOT VALID: existing rows
-- are not re-checked; validated below when they already comply).
ALTER TABLE public.price_alerts DROP CONSTRAINT IF EXISTS price_alerts_direction_check;
ALTER TABLE public.price_alerts ADD CONSTRAINT price_alerts_direction_check
  CHECK (direction IN ('above', 'below')) NOT VALID;
ALTER TABLE public.price_alerts DROP CONSTRAINT IF EXISTS price_alerts_target_positive;
ALTER TABLE public.price_alerts ADD CONSTRAINT price_alerts_target_positive
  CHECK (target_price > 0) NOT VALID;
DO $$ BEGIN
  ALTER TABLE public.price_alerts VALIDATE CONSTRAINT price_alerts_direction_check;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'price_alerts has legacy rows with an unknown direction; check left NOT VALID';
END $$;
DO $$ BEGIN
  ALTER TABLE public.price_alerts VALIDATE CONSTRAINT price_alerts_target_positive;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'price_alerts has legacy rows with target_price <= 0; check left NOT VALID';
END $$;

-- 5) Platform admins can see every company and invitation (the approval
-- flow reads the company/invitation it just created, of which the admin is
-- not a member).
DROP POLICY IF EXISTS "companies_platform_admin_read" ON public.companies;
CREATE POLICY "companies_platform_admin_read" ON public.companies
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'platform_admin'));

DROP POLICY IF EXISTS "invitations_platform_admin_read" ON public.company_invitations;
CREATE POLICY "invitations_platform_admin_read" ON public.company_invitations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'platform_admin'));
