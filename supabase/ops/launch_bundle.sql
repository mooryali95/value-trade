-- ============================================================================
-- Value Unit (وحدة القيمة): LAUNCH MIGRATION BUNDLE
-- GENERATED FILE: do not edit by hand. Rebuild with
--   bash supabase/ops/build_launch_bundle.sh
-- Source: 31 files of supabase/migrations, 20260924100000_rls_helper_grants.sql
--         ... 20260926101700_fixer_execute_allowlist.sql, in filename order.
--
-- ENGLISH
-- What it is: every database change made for the launch (security lockdown,
-- matching engine, investor onboarding, exact money, submission to listing
-- lifecycle, integrity report), concatenated in order.
-- How to run: ONCE, in the Lovable Cloud SQL editor, on the production
-- database: paste the whole file and run it. It is ONE transaction: if any
-- statement fails, nothing is changed; fix the cause and run it again.
-- Before: take a backup (or confirm point-in-time recovery is on), and
-- confirm none of these migrations was already applied (the bundle stops
-- with LAUNCH_BUNDLE_ALREADY_APPLIED when the migration history says so).
-- After: the migration history (supabase_migrations.schema_migrations,
-- when present) records each version, so they are not applied twice.
-- Expect the notice LAUNCH_BUNDLE_DONE. Then follow supabase/ops/README.md
-- (smoke suite, /admin/health integrity checks, go_live_reset.sql).
--
-- العربية
-- ما هذا الملف: جميع تغييرات قاعدة البيانات الخاصة بالإطلاق (إحكام الأمان،
-- ومحرّك المطابقة، وتسجيل المستثمرين، ودقة المبالغ، ومسار الطلب حتى الإدراج،
-- وتقرير سلامة البيانات)، مجمّعة بترتيبها.
-- طريقة التشغيل: مرة واحدة فقط في محرّر SQL في Lovable Cloud على قاعدة بيانات
-- الإنتاج: الصق الملف كاملًا وشغّله. يُنفَّذ الملف معاملةً واحدة: إذا فشلت أي
-- عبارة لا يتغيّر شيء؛ عالج السبب ثم أعد التشغيل.
-- قبل التشغيل: خذ نسخة احتياطية (أو تأكّد من تفعيل الاستعادة إلى نقطة زمنية)،
-- وتأكّد أن أيًّا من هذه الترحيلات لم يُطبَّق من قبل (يتوقف الملف برسالة
-- LAUNCH_BUNDLE_ALREADY_APPLIED إذا دلّ سجل الترحيلات على ذلك).
-- بعد التشغيل: يُسجَّل كل إصدار في سجل الترحيلات
-- (supabase_migrations.schema_migrations عند وجوده) فلا يُطبَّق مرتين.
-- ينبغي أن يظهر الإشعار LAUNCH_BUNDLE_DONE، ثم اتبع supabase/ops/README.md.
-- ============================================================================

BEGIN;

-- Preconditions: the pre-launch schema is there, and this bundle has not
-- been applied already.
DO $launch_bundle_pre$
DECLARE
  _applied text[];
BEGIN
  IF to_regclass('public.brands') IS NULL OR to_regclass('public.orders') IS NULL
     OR to_regclass('public.portfolios') IS NULL THEN
    RAISE EXCEPTION 'LAUNCH_BUNDLE_WRONG_DATABASE'
      USING DETAIL = 'public.brands / orders / portfolios not found: this is not the Value Unit database.';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce(array_agg(version ORDER BY version), '{}')
        FROM supabase_migrations.schema_migrations
       WHERE version >= '20260924100000' AND version <= '20260926101700'
    $q$ INTO _applied;
    IF cardinality(_applied) > 0 THEN
      RAISE EXCEPTION 'LAUNCH_BUNDLE_ALREADY_APPLIED'
        USING DETAIL = format('The migration history already lists %s of these versions: %s. Nothing was changed.',
                              cardinality(_applied), array_to_string(_applied, ', ')),
              HINT = 'Apply only the missing migration files instead of this bundle.';
    END IF;
  END IF;
END
$launch_bundle_pre$;

-- ============================================================================
-- >>> 20260924100000_rls_helper_grants.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
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


-- ============================================================================
-- >>> 20260924100100_lock_down_table_privileges.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
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


-- ============================================================================
-- >>> 20260924100200_trading_engine_hardening.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Trading engine hardening.
--
-- All order-state changes now happen inside SECURITY DEFINER functions that
-- only service_role may execute; the server calls them with the verified
-- JWT user id. Users have no write privileges on orders/orders_audit/
-- portfolios/positions/trades (see 20260924100100).
--
--   match_order    place + match one order (validation, instrument, Shariah,
--                  price band, max notional, cash/holdings, settlement)
--   cancel_order   cancel the caller's own open/partial order
--   replace_order  atomic modify: cancel + place a new order in one txn
--   restore_order  re-place a cancelled order as a NEW order (full checks)
--   list_my_trades a trader's own executions with side, no counterparty id
--
-- Engine rules (enforced here, not only in TypeScript):
--   * qty: whole units, 1 .. 10,000,000                        INVALID_QTY
--   * limit price: > 0, tick 0.01                              INVALID_PRICE
--   * instrument: a published row in public.brands             INSTRUMENT_NOT_FOUND
--   * caller holds app_role 'trader'                           FORBIDDEN_TRADER_REQUIRED
--   * current Shariah ruling (latest shariah_decisions row by
--     created_at) non_halal blocks buys; resting buys on such a
--     symbol are cancelled and never filled                    SHARIAH_BLOCKED
--   * reference price = last trade price, else
--     brands.reference_price; limit prices must lie within
--     ref x [0.8, 1.2]                                         PRICE_OUT_OF_BAND
--   * market orders only fill inside the same band (buy against
--     asks <= ref x 1.2, sell against bids >= ref x 0.8); an
--     unfilled market remainder is cancelled, never rests
--   * order notional (limit: qty x price; market: qty x ref x 1.2)
--     <= 5,000,000                                             ORDER_TOO_LARGE
--   * buying power: cash >= this order's notional + all open buy
--     orders' remaining notional                               INSUFFICIENT_CASH
--   * holdings: position >= this order's qty + open sell qty   INSUFFICIENT_QTY
--   * each fill's notional is round(qty x price, 2) and the same
--     amount is debited from the buyer and credited to the seller
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Shariah rulings: normalized symbols, valid statuses, fast "latest".
-- ---------------------------------------------------------------------------
UPDATE public.shariah_decisions
   SET symbol = upper(btrim(symbol))
 WHERE symbol IS DISTINCT FROM upper(btrim(symbol));

ALTER TABLE public.shariah_decisions DROP CONSTRAINT IF EXISTS shariah_decisions_status_check;
ALTER TABLE public.shariah_decisions ADD CONSTRAINT shariah_decisions_status_check
  CHECK (status IN ('halal', 'non_halal', 'reviewing')) NOT VALID;
DO $$ BEGIN
  ALTER TABLE public.shariah_decisions VALIDATE CONSTRAINT shariah_decisions_status_check;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'shariah_decisions has legacy statuses; check left NOT VALID';
END $$;

CREATE INDEX IF NOT EXISTS idx_shariah_decisions_symbol_latest
  ON public.shariah_decisions (symbol, created_at DESC, id DESC);

-- The ruling in force for a symbol is the most recently created decision row.
CREATE OR REPLACE FUNCTION public.current_shariah_status(_symbol text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.status
    FROM public.shariah_decisions d
   WHERE d.symbol = upper(btrim(_symbol))
   ORDER BY d.created_at DESC, d.id DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_shariah_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_shariah_status(text) TO service_role;

-- Identity columns come from the verified session, never from the client.
CREATE OR REPLACE FUNCTION public.shariah_decisions_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.symbol := upper(btrim(NEW.symbol));
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    IF auth.uid() IS NOT NULL THEN
      NEW.reviewer_id := auth.uid();
      NEW.updated_by := auth.uid();
    END IF;
  ELSE
    NEW.created_at := OLD.created_at;
    IF auth.uid() IS NOT NULL THEN
      NEW.reviewer_id := OLD.reviewer_id;
      NEW.updated_by := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.shariah_decisions_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shariah_stamp ON public.shariah_decisions;
CREATE TRIGGER trg_shariah_stamp BEFORE INSERT OR UPDATE ON public.shariah_decisions
  FOR EACH ROW EXECUTE FUNCTION public.shariah_decisions_stamp();

-- Audit trail: changed_by is the session user (auth.uid()); only a
-- service-role write (no end-user identity) falls back to updated_by.
CREATE OR REPLACE FUNCTION public.log_shariah_decision_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    INSERT INTO public.shariah_decision_audit
      (decision_id, previous_status, new_status, previous_reason, new_reason, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, OLD.reason, NEW.reason,
            COALESCE(auth.uid(), NEW.updated_by));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.log_shariah_decision_update() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) orders / orders_audit bookkeeping.
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders_audit ADD COLUMN IF NOT EXISTS previous_status text;
ALTER TABLE public.orders_audit ADD COLUMN IF NOT EXISTS new_status text;
-- For 'modify' / 'restore': the NEW order that replaced this one.
ALTER TABLE public.orders_audit ADD COLUMN IF NOT EXISTS related_order_id uuid
  REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_audit_order ON public.orders_audit (order_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON public.orders (user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_buyer ON public.trades (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_seller ON public.trades (seller_id, created_at DESC);

-- Legacy statuses: 'pending' (pre-engine) and 'modified' (old in-place
-- modify) rows are not in the book and can never match. Close them as
-- 'cancelled' so they read as closed and can be restored through the full
-- placement checks.
WITH legacy AS (
  SELECT o.id, o.qty, o.price, o.status
    FROM public.orders o
   WHERE o.status IN ('pending', 'modified')
   FOR UPDATE
), upd AS (
  UPDATE public.orders o
     SET status = 'cancelled', updated_at = now()
    FROM legacy
   WHERE o.id = legacy.id
  RETURNING o.id
)
INSERT INTO public.orders_audit
  (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by, previous_status, new_status)
SELECT legacy.id, 'legacy_close', legacy.qty, legacy.price, legacy.qty, legacy.price, NULL, legacy.status, 'cancelled'
  FROM legacy JOIN upd ON upd.id = legacy.id;

-- Internal: the engine cancels a resting order it can no longer settle.
CREATE OR REPLACE FUNCTION public.engine_cancel_order(_order_id uuid, _action text, _actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND OR o.status NOT IN ('open', 'partial') THEN
    RETURN;
  END IF;
  UPDATE public.orders
     SET status = 'cancelled', updated_at = clock_timestamp()
   WHERE id = o.id;
  INSERT INTO public.orders_audit
    (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by, previous_status, new_status)
  VALUES (o.id, _action, o.qty, o.price, o.qty, o.price, _actor, o.status, 'cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.engine_cancel_order(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.engine_cancel_order(uuid, text, uuid) TO service_role;

-- Cancel every resting BUY on a symbol whose ruling is non_halal.
CREATE OR REPLACE FUNCTION public.cancel_shariah_blocked_buys(_symbol text, _actor uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  WITH blocked AS (
    SELECT o.id, o.qty, o.price, o.status
      FROM public.orders o
     WHERE upper(o.symbol) = upper(btrim(_symbol)) AND o.side = 'buy' AND o.status IN ('open', 'partial')
     FOR UPDATE
  ), upd AS (
    UPDATE public.orders o
       SET status = 'cancelled', updated_at = clock_timestamp()
      FROM blocked
     WHERE o.id = blocked.id
    RETURNING o.id
  )
  INSERT INTO public.orders_audit
    (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by, previous_status, new_status)
  SELECT blocked.id, 'shariah_cancel', blocked.qty, blocked.price, blocked.qty, blocked.price,
         _actor, blocked.status, 'cancelled'
    FROM blocked JOIN upd ON upd.id = blocked.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_shariah_blocked_buys(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_shariah_blocked_buys(text, uuid) TO service_role;

-- When a symbol's ruling in force becomes non_halal, its resting buys go.
-- Takes the same per-symbol lock as match_order so no buy can slip in.
CREATE OR REPLACE FUNCTION public.shariah_decisions_enforce()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s text;
  syms text[] := ARRAY[NEW.symbol];
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.symbol IS DISTINCT FROM NEW.symbol THEN
    syms := syms || OLD.symbol;
  END IF;
  FOREACH s IN ARRAY syms LOOP
    PERFORM pg_advisory_xact_lock(hashtext('match:' || s));
    IF public.current_shariah_status(s) = 'non_halal' THEN
      PERFORM public.cancel_shariah_blocked_buys(s, COALESCE(auth.uid(), NEW.updated_by, NEW.reviewer_id));
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.shariah_decisions_enforce() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shariah_enforce ON public.shariah_decisions;
CREATE TRIGGER trg_shariah_enforce AFTER INSERT OR UPDATE ON public.shariah_decisions
  FOR EACH ROW EXECUTE FUNCTION public.shariah_decisions_enforce();

-- Apply the rule to rulings already in force.
DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT DISTINCT o.symbol FROM public.orders o
            WHERE o.side = 'buy' AND o.status IN ('open', 'partial') LOOP
    IF public.current_shariah_status(s) = 'non_halal' THEN
      PERFORM public.cancel_shariah_blocked_buys(s, NULL);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Matching engine. Same signature as before (callers unchanged);
--    _asset_class is ignored: the instrument's own asset_class is used.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_order(
  _user_id uuid, _symbol text, _asset_class text, _side text, _type text,
  _qty numeric, _limit_price numeric DEFAULT NULL
) RETURNS TABLE(order_id uuid, filled_qty numeric, avg_price numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  c_max_qty constant numeric := 10000000;
  c_max_notional constant numeric := 5000000;
  c_band constant numeric := 0.2;
  _brand public.brands;
  _opposite text;
  _price numeric;
  _ref numeric;
  _low numeric;
  _high numeric;
  _order_notional numeric;
  _cash numeric;
  _held numeric;
  _open numeric;
  _parties uuid[];
  my_order public.orders;
  cand public.orders;
  remaining numeric;
  trade_qty numeric;
  trade_price numeric;
  notional numeric;
  total_qty numeric := 0;
  total_cost numeric := 0;
  buyer uuid;
  seller uuid;
  buyer_cash numeric;
  seller_qty numeric;
  final_status text;
BEGIN
  -- Input validation (K1).
  IF _side IS NULL OR _side NOT IN ('buy', 'sell') THEN RAISE EXCEPTION 'INVALID_SIDE'; END IF;
  IF _type IS NULL OR _type NOT IN ('limit', 'market') THEN RAISE EXCEPTION 'INVALID_TYPE'; END IF;
  IF _qty IS NULL OR _qty = 'NaN'::numeric OR _qty <= 0 OR _qty > c_max_qty OR _qty <> trunc(_qty) THEN
    RAISE EXCEPTION 'INVALID_QTY';
  END IF;
  IF _type = 'limit' THEN
    IF _limit_price IS NULL OR _limit_price = 'NaN'::numeric OR _limit_price <= 0
       OR _limit_price > 1000000000 OR _limit_price <> round(_limit_price, 2) THEN
      RAISE EXCEPTION 'INVALID_PRICE';
    END IF;
    _price := _limit_price;
  ELSE
    _price := NULL;
  END IF;

  IF _user_id IS NULL OR NOT public.has_role(_user_id, 'trader') THEN
    RAISE EXCEPTION 'FORBIDDEN_TRADER_REQUIRED';
  END IF;

  SELECT * INTO _brand FROM public.brands b WHERE b.symbol = _symbol AND b.published;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- One matcher per symbol at a time (shared with cancel/replace/restore and
  -- the Shariah trigger).
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _brand.symbol));

  IF public.current_shariah_status(_brand.symbol) = 'non_halal' AND _side = 'buy' THEN
    RAISE EXCEPTION 'SHARIAH_BLOCKED';
  END IF;

  -- Reference price and protection band.
  SELECT t.price INTO _ref
    FROM public.trades t
   WHERE t.symbol = _brand.symbol
   ORDER BY t.created_at DESC, t.id DESC
   LIMIT 1;
  _ref := COALESCE(_ref, _brand.reference_price);
  IF _ref IS NULL OR _ref <= 0 THEN RAISE EXCEPTION 'PRICE_OUT_OF_BAND'; END IF;
  _low := _ref * (1 - c_band);
  _high := _ref * (1 + c_band);
  IF _type = 'limit' AND (_price < _low OR _price > _high) THEN
    RAISE EXCEPTION 'PRICE_OUT_OF_BAND';
  END IF;

  -- Size limit: market orders are measured at the top of the band.
  _order_notional := _qty * COALESCE(_price, _high);
  IF _order_notional > c_max_notional THEN RAISE EXCEPTION 'ORDER_TOO_LARGE'; END IF;

  -- The trader's own side must be covered, including what their other
  -- resting orders already promise (no spoofed depth).
  INSERT INTO public.portfolios (user_id, cash_balance) VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  IF _side = 'buy' THEN
    SELECT p.cash_balance INTO _cash FROM public.portfolios p WHERE p.user_id = _user_id;
    SELECT COALESCE(sum((o.qty - o.filled_qty) * o.price), 0) INTO _open
      FROM public.orders o
     WHERE o.user_id = _user_id AND o.side = 'buy'
       AND o.status IN ('open', 'partial') AND o.price IS NOT NULL;
    IF COALESCE(_cash, 0) < _order_notional + _open THEN RAISE EXCEPTION 'INSUFFICIENT_CASH'; END IF;
  ELSE
    SELECT ps.qty INTO _held FROM public.positions ps
     WHERE ps.user_id = _user_id AND ps.symbol = _brand.symbol;
    SELECT COALESCE(sum(o.qty - o.filled_qty), 0) INTO _open
      FROM public.orders o
     WHERE o.user_id = _user_id AND o.symbol = _brand.symbol AND o.side = 'sell'
       AND o.status IN ('open', 'partial');
    IF COALESCE(_held, 0) < _qty + _open THEN RAISE EXCEPTION 'INSUFFICIENT_QTY'; END IF;
  END IF;

  -- Defensive: resting buys on a non_halal symbol must never fill.
  IF public.current_shariah_status(_brand.symbol) = 'non_halal' THEN
    PERFORM public.cancel_shariah_blocked_buys(_brand.symbol, NULL);
  END IF;

  -- created_at is taken after the symbol lock, so time priority follows the
  -- real arrival order.
  INSERT INTO public.orders
    (user_id, symbol, asset_class, side, type, qty, price, status, filled_qty, created_at, updated_at)
  VALUES
    (_user_id, _brand.symbol, _brand.asset_class, _side, _type, _qty, _price, 'open', 0,
     clock_timestamp(), clock_timestamp())
  RETURNING * INTO my_order;

  _opposite := CASE WHEN _side = 'buy' THEN 'sell' ELSE 'buy' END;

  -- Lock every portfolio this order may touch, in user_id order, before any
  -- cash moves: two matchers on different symbols with overlapping traders
  -- then always lock in the same order and cannot deadlock.
  SELECT array_agg(DISTINCT o.user_id) INTO _parties
    FROM public.orders o
   WHERE o.symbol = _brand.symbol AND o.side = _opposite
     AND o.status IN ('open', 'partial') AND o.user_id <> _user_id
     AND o.price IS NOT NULL AND o.qty > o.filled_qty
     AND ((_side = 'buy' AND o.price <= COALESCE(_price, _high))
       OR (_side = 'sell' AND o.price >= COALESCE(_price, _low)));
  _parties := array_append(COALESCE(_parties, ARRAY[]::uuid[]), _user_id);
  INSERT INTO public.portfolios (user_id, cash_balance)
  SELECT u, 0 FROM unnest(_parties) AS u
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.portfolios p
   WHERE p.user_id = ANY(_parties)
   ORDER BY p.user_id
     FOR UPDATE;

  remaining := _qty;
  FOR cand IN
    SELECT * FROM public.orders o
     WHERE o.symbol = _brand.symbol AND o.side = _opposite
       AND o.status IN ('open', 'partial') AND o.user_id <> _user_id
       AND o.price IS NOT NULL AND o.qty > o.filled_qty
       AND ((_side = 'buy' AND o.price <= COALESCE(_price, _high))
         OR (_side = 'sell' AND o.price >= COALESCE(_price, _low)))
     ORDER BY CASE WHEN _side = 'buy' THEN o.price ELSE -o.price END ASC,
              o.created_at ASC, o.id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;

    trade_qty := LEAST(remaining, cand.qty - cand.filled_qty);
    CONTINUE WHEN trade_qty <= 0;
    trade_price := cand.price;
    -- One rounded amount, debited and credited identically.
    notional := round(trade_qty * trade_price, 2);

    IF _side = 'buy' THEN
      buyer := _user_id; seller := cand.user_id;
    ELSE
      buyer := cand.user_id; seller := _user_id;
    END IF;

    SELECT p.cash_balance INTO buyer_cash FROM public.portfolios p WHERE p.user_id = buyer FOR UPDATE;
    IF COALESCE(buyer_cash, 0) < notional THEN
      IF buyer = cand.user_id THEN
        PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_insufficient_cash', NULL);
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'INSUFFICIENT_CASH';
    END IF;

    SELECT ps.qty INTO seller_qty FROM public.positions ps
     WHERE ps.user_id = seller AND ps.symbol = _brand.symbol FOR UPDATE;
    IF COALESCE(seller_qty, 0) < trade_qty THEN
      IF seller = cand.user_id THEN
        PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_insufficient_qty', NULL);
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'INSUFFICIENT_QTY';
    END IF;

    INSERT INTO public.trades
      (symbol, asset_class, qty, price, buy_order_id, sell_order_id, buyer_id, seller_id, created_at)
    VALUES
      (_brand.symbol, _brand.asset_class, trade_qty, trade_price,
       CASE WHEN _side = 'buy' THEN my_order.id ELSE cand.id END,
       CASE WHEN _side = 'buy' THEN cand.id ELSE my_order.id END,
       buyer, seller, clock_timestamp());

    PERFORM public.apply_trade_position(buyer, _brand.symbol, _brand.asset_class, 'buy', trade_qty, trade_price);
    PERFORM public.apply_trade_position(seller, _brand.symbol, _brand.asset_class, 'sell', trade_qty, trade_price);

    PERFORM public.post_cash_movement(buyer, 'order_buy', -notional,
      CASE WHEN _side = 'buy' THEN my_order.id ELSE cand.id END,
      'buy ' || trade_qty || ' ' || _brand.symbol || ' @ ' || trade_price, buyer);
    PERFORM public.post_cash_movement(seller, 'order_sell', notional,
      CASE WHEN _side = 'buy' THEN cand.id ELSE my_order.id END,
      'sell ' || trade_qty || ' ' || _brand.symbol || ' @ ' || trade_price, seller);

    -- filled_price is the running average fill price of the resting order.
    UPDATE public.orders o
       SET filled_qty = cand.filled_qty + trade_qty,
           filled_price = round(
             (COALESCE(cand.filled_price, 0) * cand.filled_qty + trade_qty * trade_price)
             / (cand.filled_qty + trade_qty), 4),
           status = CASE WHEN cand.filled_qty + trade_qty >= cand.qty THEN 'filled' ELSE 'partial' END,
           filled_at = clock_timestamp(),
           updated_at = clock_timestamp()
     WHERE o.id = cand.id;

    remaining := remaining - trade_qty;
    total_qty := total_qty + trade_qty;
    total_cost := total_cost + notional;
  END LOOP;

  IF remaining <= 0 THEN
    final_status := 'filled';
  ELSIF _type = 'market' THEN
    -- K3: a market order never rests; the unfilled remainder is cancelled.
    final_status := 'cancelled';
  ELSIF total_qty > 0 THEN
    final_status := 'partial';
  ELSE
    final_status := 'open';
  END IF;

  UPDATE public.orders o
     SET filled_qty = total_qty,
         status = final_status,
         filled_price = CASE WHEN total_qty > 0 THEN round(total_cost / total_qty, 4) ELSE NULL END,
         filled_at = CASE WHEN total_qty > 0 THEN clock_timestamp() ELSE NULL END,
         updated_at = clock_timestamp()
   WHERE o.id = my_order.id;

  IF final_status = 'cancelled' THEN
    INSERT INTO public.orders_audit
      (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by, previous_status, new_status)
    VALUES (my_order.id, 'market_unfilled', _qty, NULL, total_qty, NULL, NULL, 'open', 'cancelled');
  END IF;

  RETURN QUERY SELECT my_order.id, total_qty,
    CASE WHEN total_qty > 0 THEN round(total_cost / total_qty, 4) ELSE NULL::numeric END,
    final_status;
END;
$$;
REVOKE ALL ON FUNCTION public.match_order(uuid, text, text, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_order(uuid, text, text, text, text, numeric, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Order lifecycle.
-- ---------------------------------------------------------------------------

-- Cancel the caller's own resting order.
CREATE OR REPLACE FUNCTION public.cancel_order(_user_id uuid, _order_id uuid)
RETURNS TABLE(order_id uuid, status text, filled_qty numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sym text;
  o public.orders;
BEGIN
  SELECT x.symbol INTO _sym FROM public.orders x WHERE x.id = _order_id AND x.user_id = _user_id;
  IF _user_id IS NULL OR _sym IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_OPEN'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

  SELECT * INTO o FROM public.orders x WHERE x.id = _order_id AND x.user_id = _user_id FOR UPDATE;
  IF NOT FOUND OR o.status NOT IN ('open', 'partial') THEN RAISE EXCEPTION 'ORDER_NOT_OPEN'; END IF;

  UPDATE public.orders x SET status = 'cancelled', updated_at = clock_timestamp() WHERE x.id = o.id;
  INSERT INTO public.orders_audit
    (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by, previous_status, new_status)
  VALUES (o.id, 'cancel', o.qty, o.price, o.qty, o.price, _user_id, o.status, 'cancelled');

  RETURN QUERY SELECT o.id, 'cancelled'::text, o.filled_qty;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, uuid) TO service_role;

-- Atomic modify: cancel the resting order and place a NEW limit order with
-- the new price/qty through match_order, in one transaction. If the new
-- placement raises, everything rolls back and the old order is untouched.
CREATE OR REPLACE FUNCTION public.replace_order(_user_id uuid, _order_id uuid, _price numeric, _qty numeric)
RETURNS TABLE(order_id uuid, filled_qty numeric, avg_price numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sym text;
  o public.orders;
  r record;
BEGIN
  SELECT x.symbol INTO _sym FROM public.orders x WHERE x.id = _order_id AND x.user_id = _user_id;
  IF _user_id IS NULL OR _sym IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_OPEN'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

  SELECT * INTO o FROM public.orders x WHERE x.id = _order_id AND x.user_id = _user_id FOR UPDATE;
  IF NOT FOUND OR o.status NOT IN ('open', 'partial') OR o.type <> 'limit' THEN
    RAISE EXCEPTION 'ORDER_NOT_OPEN';
  END IF;

  UPDATE public.orders x SET status = 'cancelled', updated_at = clock_timestamp() WHERE x.id = o.id;

  SELECT m.order_id, m.filled_qty, m.avg_price, m.status INTO r
    FROM public.match_order(_user_id, o.symbol, o.asset_class, o.side, 'limit', _qty, _price) m;

  INSERT INTO public.orders_audit
    (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by,
     previous_status, new_status, related_order_id)
  VALUES (o.id, 'modify', o.qty, o.price, _qty, _price, _user_id, o.status, 'cancelled', r.order_id);

  RETURN QUERY SELECT r.order_id, r.filled_qty, r.avg_price, r.status;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_order(uuid, uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_order(uuid, uuid, numeric, numeric) TO service_role;

-- Undo a cancellation: re-place the order's side/type/price and remaining
-- qty as a NEW order through match_order (all checks apply again). An order
-- can be restored once; modified-away orders cannot be restored.
CREATE OR REPLACE FUNCTION public.restore_order(_user_id uuid, _order_id uuid)
RETURNS TABLE(order_id uuid, filled_qty numeric, avg_price numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sym text;
  o public.orders;
  _remaining numeric;
  r record;
BEGIN
  SELECT x.symbol INTO _sym FROM public.orders x WHERE x.id = _order_id AND x.user_id = _user_id;
  IF _user_id IS NULL OR _sym IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_OPEN'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

  SELECT * INTO o FROM public.orders x WHERE x.id = _order_id AND x.user_id = _user_id FOR UPDATE;
  IF NOT FOUND OR o.status <> 'cancelled' THEN RAISE EXCEPTION 'ORDER_NOT_OPEN'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders_audit a
     WHERE a.order_id = o.id AND a.action IN ('modify', 'restore') AND a.related_order_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ORDER_NOT_OPEN';
  END IF;

  _remaining := o.qty - COALESCE(o.filled_qty, 0);
  IF _remaining <= 0 THEN RAISE EXCEPTION 'ORDER_NOT_OPEN'; END IF;

  SELECT m.order_id, m.filled_qty, m.avg_price, m.status INTO r
    FROM public.match_order(_user_id, o.symbol, o.asset_class, o.side, o.type, _remaining,
                            CASE WHEN o.type = 'limit' THEN o.price ELSE NULL END) m;

  INSERT INTO public.orders_audit
    (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by,
     previous_status, new_status, related_order_id)
  VALUES (o.id, 'restore', o.qty, o.price, _remaining, o.price, _user_id, 'cancelled', 'cancelled', r.order_id);

  RETURN QUERY SELECT r.order_id, r.filled_qty, r.avg_price, r.status;
END;
$$;
REVOKE ALL ON FUNCTION public.restore_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_order(uuid, uuid) TO service_role;

-- A trader's own executions, with their side and their own order id, never
-- the counterparty's identity.
CREATE OR REPLACE FUNCTION public.list_my_trades(_user_id uuid, _symbol text DEFAULT NULL, _limit integer DEFAULT 50)
RETURNS TABLE(id uuid, symbol text, asset_class text, side text, qty numeric, price numeric, order_id uuid, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.symbol, t.asset_class,
         CASE WHEN t.buyer_id = _user_id THEN 'buy' ELSE 'sell' END,
         t.qty, t.price,
         CASE WHEN t.buyer_id = _user_id THEN t.buy_order_id ELSE t.sell_order_id END,
         t.created_at
    FROM public.trades t
   WHERE _user_id IS NOT NULL
     AND (t.buyer_id = _user_id OR t.seller_id = _user_id)
     AND (_symbol IS NULL OR t.symbol = _symbol)
   ORDER BY t.created_at DESC, t.id DESC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 5000);
$$;
REVOKE ALL ON FUNCTION public.list_my_trades(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_trades(uuid, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Public market data, computed from executed trades only (never from
--    user-controlled order rows). Names and result columns are unchanged.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_symbol_last_trade(text);
CREATE FUNCTION public.get_symbol_last_trade(_symbol text)
RETURNS TABLE(last_price numeric, traded_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.price, t.created_at
    FROM public.trades t
   WHERE t.symbol = _symbol
   ORDER BY t.created_at DESC, t.id DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_symbol_last_trade(text) FROM PUBLIC, anon, authenticated;
-- The public trade page reads it with the publishable (anon) key.
GRANT EXECUTE ON FUNCTION public.get_symbol_last_trade(text) TO anon, authenticated, service_role;

-- Aggregated book: price levels and sizes only; depth capped at 50.
CREATE OR REPLACE FUNCTION public.get_order_book(_symbol text, _depth integer DEFAULT 12)
RETURNS TABLE(side text, price numeric, qty numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  (SELECT o.side, o.price, sum(o.qty - o.filled_qty) AS qty
     FROM public.orders o
    WHERE o.symbol = _symbol AND o.side = 'buy' AND o.status IN ('open','partial') AND o.price IS NOT NULL
    GROUP BY o.side, o.price HAVING sum(o.qty - o.filled_qty) > 0
    ORDER BY o.price DESC LIMIT LEAST(GREATEST(COALESCE(_depth, 12), 1), 50))
  UNION ALL
  (SELECT o.side, o.price, sum(o.qty - o.filled_qty) AS qty
     FROM public.orders o
    WHERE o.symbol = _symbol AND o.side = 'sell' AND o.status IN ('open','partial') AND o.price IS NOT NULL
    GROUP BY o.side, o.price HAVING sum(o.qty - o.filled_qty) > 0
    ORDER BY o.price ASC LIMIT LEAST(GREATEST(COALESCE(_depth, 12), 1), 50));
$$;
REVOKE ALL ON FUNCTION public.get_order_book(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_book(text, integer) TO anon, authenticated, service_role;

-- Last price, change vs the reference (the last trade at least 24h old, else
-- the first trade inside the window), 24h volume (each trade counted once).
DROP FUNCTION IF EXISTS public.get_symbol_market_stats(text);
CREATE FUNCTION public.get_symbol_market_stats(_symbol text)
RETURNS TABLE (
  last_price numeric,
  last_traded_at timestamptz,
  change_24h_pct numeric,
  volume_24h numeric,
  trade_count_24h bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH last_trade AS (
    SELECT t.price, t.created_at
      FROM public.trades t
     WHERE t.symbol = _symbol
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT 1
  ),
  base AS (
    SELECT COALESCE(
      (SELECT t.price FROM public.trades t
        WHERE t.symbol = _symbol AND t.created_at <= now() - interval '24 hours'
        ORDER BY t.created_at DESC, t.id DESC LIMIT 1),
      (SELECT t.price FROM public.trades t
        WHERE t.symbol = _symbol AND t.created_at > now() - interval '24 hours'
        ORDER BY t.created_at ASC, t.id ASC LIMIT 1)
    ) AS price
  ),
  window_24h AS (
    SELECT COALESCE(sum(t.qty), 0) AS vol, count(*) AS cnt
      FROM public.trades t
     WHERE t.symbol = _symbol AND t.created_at > now() - interval '24 hours'
  )
  SELECT
    lt.price,
    lt.created_at,
    CASE WHEN lt.price IS NOT NULL AND b.price IS NOT NULL AND b.price <> 0
         THEN round(((lt.price - b.price) / b.price) * 100, 2) END,
    w.vol,
    w.cnt
  FROM window_24h w
  CROSS JOIN base b
  LEFT JOIN last_trade lt ON true;
$$;
REVOKE ALL ON FUNCTION public.get_symbol_market_stats(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_symbol_market_stats(text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_market_snapshot(text[]);
CREATE FUNCTION public.get_market_snapshot(_symbols text[])
RETURNS TABLE (
  symbol text,
  last_price numeric,
  change_24h_pct numeric,
  volume_24h numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH syms AS (
    SELECT DISTINCT s AS symbol FROM unnest(_symbols[1:1000]) AS s WHERE s IS NOT NULL
  ),
  last_trade AS (
    SELECT DISTINCT ON (t.symbol) t.symbol, t.price
      FROM public.trades t JOIN syms ON syms.symbol = t.symbol
     ORDER BY t.symbol, t.created_at DESC, t.id DESC
  ),
  before_window AS (
    SELECT DISTINCT ON (t.symbol) t.symbol, t.price
      FROM public.trades t JOIN syms ON syms.symbol = t.symbol
     WHERE t.created_at <= now() - interval '24 hours'
     ORDER BY t.symbol, t.created_at DESC, t.id DESC
  ),
  first_in_window AS (
    SELECT DISTINCT ON (t.symbol) t.symbol, t.price
      FROM public.trades t JOIN syms ON syms.symbol = t.symbol
     WHERE t.created_at > now() - interval '24 hours'
     ORDER BY t.symbol, t.created_at ASC, t.id ASC
  ),
  window_24h AS (
    SELECT t.symbol, COALESCE(sum(t.qty), 0) AS vol
      FROM public.trades t JOIN syms ON syms.symbol = t.symbol
     WHERE t.created_at > now() - interval '24 hours'
     GROUP BY t.symbol
  )
  SELECT
    s.symbol,
    lt.price,
    CASE WHEN lt.price IS NOT NULL AND COALESCE(bw.price, fw.price) IS NOT NULL
              AND COALESCE(bw.price, fw.price) <> 0
         THEN round(((lt.price - COALESCE(bw.price, fw.price)) / COALESCE(bw.price, fw.price)) * 100, 2) END,
    COALESCE(w.vol, 0)
  FROM syms s
  LEFT JOIN last_trade lt ON lt.symbol = s.symbol
  LEFT JOIN before_window bw ON bw.symbol = s.symbol
  LEFT JOIN first_in_window fw ON fw.symbol = s.symbol
  LEFT JOIN window_24h w ON w.symbol = s.symbol;
$$;
REVOKE ALL ON FUNCTION public.get_market_snapshot(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_market_snapshot(text[]) TO authenticated, service_role;


-- ============================================================================
-- >>> 20260924100300_cash_opening_balance.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Cash: new portfolios start at 0 and every balance is explained by the
-- ledger.
--
-- Investors are activated and funded by a platform admin (deposit through
-- post_cash_movement); nobody receives play money on first touch any more.
-- Portfolios created before this migration got cash_balance = 100000 from
-- the column default, outside the ledger, so the ledger never reconciled.
-- For every such portfolio we add ONE 'adjustment' row (note 'opening
-- balance reconciliation') so that, afterwards, for every user:
--     sum(cash_ledger.amount)             = portfolios.cash_balance
--     latest cash_ledger.balance_after    = portfolios.cash_balance
-- No balance is changed.
-- ============================================================================

ALTER TABLE public.portfolios ALTER COLUMN cash_balance SET DEFAULT 0;

-- Same signature and behaviour; the portfolio is created explicitly at 0,
-- amounts must be whole cents (portfolios.cash_balance is numeric(18,2), so a
-- sub-cent amount would silently drift from the ledger), and ledger rows get
-- clock_timestamp() so several movements in one transaction keep their order.
CREATE OR REPLACE FUNCTION public.post_cash_movement(
  _user_id uuid,
  _kind text,
  _amount numeric,
  _ref_order_id uuid DEFAULT NULL,
  _note text DEFAULT NULL,
  _actor_id uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _balance numeric;
BEGIN
  IF _kind IS NULL OR _kind NOT IN ('deposit','withdrawal','order_buy','order_sell','adjustment') THEN
    RAISE EXCEPTION 'INVALID_KIND';
  END IF;
  IF _user_id IS NULL OR _amount IS NULL OR _amount = 'NaN'::numeric OR _amount <> round(_amount, 2) THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  INSERT INTO public.portfolios (user_id, cash_balance)
  VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT cash_balance INTO _balance FROM public.portfolios WHERE user_id = _user_id FOR UPDATE;
  IF _balance IS NULL THEN
    RAISE EXCEPTION 'PORTFOLIO_UNAVAILABLE';
  END IF;

  _balance := _balance + _amount;
  IF _balance < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_CASH';
  END IF;

  INSERT INTO public.cash_ledger (user_id, kind, amount, balance_after, ref_order_id, note, created_by, created_at)
  VALUES (_user_id, _kind, _amount, _balance, _ref_order_id, _note, COALESCE(_actor_id, _user_id), clock_timestamp());

  UPDATE public.portfolios SET cash_balance = _balance, updated_at = now() WHERE user_id = _user_id;
  RETURN _balance;
END;
$$;
REVOKE ALL ON FUNCTION public.post_cash_movement(uuid, text, numeric, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_cash_movement(uuid, text, numeric, uuid, text, uuid) TO service_role;

-- Opening balance reconciliation.
--  * If the ledger is otherwise consistent (no rows, or its newest row already
--    shows the current balance), the missing amount is the opening balance:
--    the row is dated before the first movement (at portfolio creation) and
--    its balance_after is the opening balance, so the running balance of the
--    whole history is coherent.
--  * Otherwise (the balance was changed outside the ledger later on), the
--    difference is booked now, with balance_after = the current balance.
WITH pf AS (
  SELECT p.user_id,
         p.cash_balance,
         p.created_at AS pf_created_at,
         COALESCE((SELECT sum(l.amount) FROM public.cash_ledger l WHERE l.user_id = p.user_id), 0) AS ledger_sum,
         (SELECT min(l.created_at) FROM public.cash_ledger l WHERE l.user_id = p.user_id) AS first_at,
         (SELECT max(l.created_at) FROM public.cash_ledger l WHERE l.user_id = p.user_id) AS last_at
    FROM public.portfolios p
), diff AS (
  SELECT pf.*,
         pf.cash_balance - pf.ledger_sum AS missing,
         (pf.first_at IS NULL OR EXISTS (
            SELECT 1 FROM public.cash_ledger l
             WHERE l.user_id = pf.user_id AND l.created_at = pf.last_at
               AND l.balance_after = pf.cash_balance)) AS opening_only
    FROM pf
   WHERE pf.cash_balance <> pf.ledger_sum
)
INSERT INTO public.cash_ledger (user_id, kind, amount, balance_after, ref_order_id, note, created_by, created_at)
SELECT d.user_id,
       'adjustment',
       d.missing,
       CASE WHEN d.opening_only THEN d.missing ELSE d.cash_balance END,
       NULL,
       'opening balance reconciliation',
       NULL,
       CASE
         WHEN d.first_at IS NULL THEN d.pf_created_at
         WHEN d.opening_only THEN LEAST(d.pf_created_at, d.first_at - interval '1 millisecond')
         ELSE clock_timestamp()
       END
  FROM diff d;


-- ============================================================================
-- >>> 20260924100400_governance_lockdown.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Governance lockdown: invitation-only activation, append-only audit log,
-- server-only access requests, protected instrument fields, submission and
-- document integrity, race-safe last-owner protection.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Sign-up no longer grants the global 'trader' role. A platform admin
--    activates an investor (inserts user_roles 'trader') and funds them.
--    Existing role rows are untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) audit_log is append-only and written by the server (service role) with
--    the verified actor id. Users keep their read policies.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "actor can insert own audit rows" ON public.audit_log;

-- ---------------------------------------------------------------------------
-- 3) access_requests: no direct anon/authenticated INSERT or UPDATE. The
--    server inserts with the service role after validation + rate limiting;
--    approval/rejection go through approve_/reject_access_request().
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "access_requests_insert_public" ON public.access_requests;
DROP POLICY IF EXISTS "access_requests_update_scoped" ON public.access_requests;

ALTER TABLE public.access_requests DROP CONSTRAINT IF EXISTS access_requests_text_lengths;
ALTER TABLE public.access_requests ADD CONSTRAINT access_requests_text_lengths CHECK (
  char_length(email) <= 320
  AND char_length(full_name) <= 2000
  AND (new_company_name_ar IS NULL OR char_length(new_company_name_ar) <= 2000)
  AND (new_company_name_en IS NULL OR char_length(new_company_name_en) <= 2000)
  AND (sector IS NULL OR char_length(sector) <= 2000)
  AND (rejection_reason IS NULL OR char_length(rejection_reason) <= 2000)
) NOT VALID;
DO $$ BEGIN
  ALTER TABLE public.access_requests VALIDATE CONSTRAINT access_requests_text_lengths;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'access_requests has legacy oversized rows; length check left NOT VALID';
END $$;

-- ---------------------------------------------------------------------------
-- 4) brands: company owners may edit descriptive fields only. symbol (the
--    Shariah rulings are keyed by it), slug, company_id, published,
--    reference_price (it anchors the price band), asset_class and
--    source_submission_id change only for service_role / platform_admin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brands_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Symbols are stored upper-case (Shariah rulings and orders match on them).
  IF TG_OP = 'INSERT' THEN
    NEW.symbol := upper(btrim(NEW.symbol));
    RETURN NEW;
  END IF;
  -- No end-user identity: service role (server) or a migration.
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'platform_admin') THEN
    IF NEW.symbol IS DISTINCT FROM OLD.symbol THEN
      NEW.symbol := upper(btrim(NEW.symbol));
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.symbol IS DISTINCT FROM OLD.symbol
     OR NEW.slug IS DISTINCT FROM OLD.slug
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.published IS DISTINCT FROM OLD.published
     OR NEW.reference_price IS DISTINCT FROM OLD.reference_price
     OR NEW.asset_class IS DISTINCT FROM OLD.asset_class
     OR NEW.source_submission_id IS DISTINCT FROM OLD.source_submission_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'FORBIDDEN_BRAND_FIELD';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.brands_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_brands_guard ON public.brands;
CREATE TRIGGER trg_brands_guard BEFORE INSERT OR UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.brands_guard();

-- ---------------------------------------------------------------------------
-- 5) product_submissions: a new submission is always 'pending' with no
--    decision; the submitter is the session user. Reviews stamp the
--    reviewer from the session.
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_submissions DROP CONSTRAINT IF EXISTS product_submissions_status_check;
ALTER TABLE public.product_submissions ADD CONSTRAINT product_submissions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected')) NOT VALID;
DO $$ BEGIN
  ALTER TABLE public.product_submissions VALIDATE CONSTRAINT product_submissions_status_check;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'product_submissions has legacy statuses; check left NOT VALID';
END $$;

CREATE OR REPLACE FUNCTION public.product_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.reviewer_id := NULL;
    NEW.review_reason := NULL;
    NEW.reviewed_at := NULL;
    NEW.submitted_at := now();
    NEW.created_at := now();
    NEW.updated_at := now();
    IF auth.uid() IS NOT NULL THEN
      NEW.submitted_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.reviewer_id := auth.uid();
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.reviewed_at := now();
    ELSE
      NEW.reviewed_at := OLD.reviewed_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.product_submissions_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_product_submissions_guard ON public.product_submissions;
CREATE TRIGGER trg_product_submissions_guard BEFORE INSERT OR UPDATE ON public.product_submissions
  FOR EACH ROW EXECUTE FUNCTION public.product_submissions_guard();

-- ---------------------------------------------------------------------------
-- 6) submission_documents: the row must reference a submission of the same
--    company, and file_path must be "<company_id>/<submission_id>/<name>"
--    where <name> is non-empty and contains no '/' (max 512 chars in total).
--    The INSERT policy already requires the uploader to be an owner/finance
--    member of company_id; uploaded_by is stamped from the session.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submission_documents_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sub_company uuid;
  _prefix text;
BEGIN
  SELECT s.company_id INTO _sub_company
    FROM public.product_submissions s
   WHERE s.id = NEW.submission_id;
  IF _sub_company IS NULL OR _sub_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'SUBMISSION_NOT_FOUND';
  END IF;

  _prefix := NEW.company_id::text || '/' || NEW.submission_id::text || '/';
  IF NEW.file_path IS NULL
     OR left(NEW.file_path, char_length(_prefix)) <> _prefix
     OR char_length(NEW.file_path) <= char_length(_prefix)
     OR char_length(NEW.file_path) > 512
     OR position('/' IN substr(NEW.file_path, char_length(_prefix) + 1)) > 0 THEN
    RAISE EXCEPTION 'INVALID_FILE_PATH';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.uploaded_by := auth.uid();
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.submission_documents_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_submission_documents_guard ON public.submission_documents;
CREATE TRIGGER trg_submission_documents_guard BEFORE INSERT ON public.submission_documents
  FOR EACH ROW EXECUTE FUNCTION public.submission_documents_guard();

-- ---------------------------------------------------------------------------
-- 7) protect_last_owner, race-safe. Every removal/demotion of an owner first
--    locks the company row, so owner changes of one company are serialized
--    and the count below (a fresh READ COMMITTED snapshot taken after the
--    lock) sees the other transaction's committed change: two owners can no
--    longer remove each other concurrently. The company row is locked rather
--    than the owner rows: each concurrent DELETE already holds its own member
--    row, so locking all owner rows would deadlock instead of serializing.
--    FOR NO KEY UPDATE does not block member inserts (FK KEY SHARE).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_last_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owners int;
BEGIN
  IF OLD.role <> 'owner' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' AND NEW.company_id = OLD.company_id THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.companies c WHERE c.id = OLD.company_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    -- The company itself is being deleted (cascade): nothing to protect.
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*) INTO _owners
    FROM public.company_members m
   WHERE m.company_id = OLD.company_id AND m.role = 'owner';
  IF _owners <= 1 THEN
    RAISE EXCEPTION 'LAST_OWNER_PROTECTED';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.protect_last_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_last_owner_upd ON public.company_members;
CREATE TRIGGER trg_protect_last_owner_upd BEFORE UPDATE OF role, company_id ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_owner();


-- ============================================================================
-- >>> 20260924100500_fix_approve_access_request.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- approve_access_request: fix the "new company" path.
--
-- (a) Its RETURNS TABLE output column `company_id` is also a PL/pgSQL
--     variable, so `DELETE ... WHERE company_id = new_co_id` was ambiguous
--     and every new-company approval failed.
-- (b) The old flow created the company (the add_creator_as_owner trigger
--     made the approving admin its owner) and then deleted the admin again,
--     which protect_last_owner rejects with LAST_OWNER_PROTECTED.
--
-- Now the company is created without any member (a transaction-local flag
-- tells add_creator_as_owner to skip); the applicant becomes its owner by
-- accepting the 'owner' invitation. Signature and result columns unchanged.
-- New error code: SLUG_TAKEN (the requested company slug already exists).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.add_creator_as_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set (transaction-local) only by approve_access_request, which creates a
  -- company on behalf of an applicant who is not a member yet.
  IF current_setting('app.skip_creator_owner', true) = 'on' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.company_members (company_id, user_id, role, invited_by)
  VALUES (NEW.id, NEW.created_by, 'owner', NEW.created_by)
  ON CONFLICT (company_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.add_creator_as_owner() FROM PUBLIC, anon, authenticated;

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

  IF req.requested_company_id IS NOT NULL THEN
    -- Joining an existing company: its owner or a platform_admin approves.
    IF NOT (public.is_company_owner(_actor_id, req.requested_company_id)
            OR public.has_role(_actor_id, 'platform_admin')) THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF _role IS NULL THEN
      RAISE EXCEPTION 'ROLE_REQUIRED';
    END IF;

    v_company_id := req.requested_company_id;
    INSERT INTO public.company_invitations (company_id, email, role, invited_by)
    VALUES (v_company_id, req.email, _role, _actor_id)
    RETURNING * INTO inv;
  ELSE
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
REVOKE ALL ON FUNCTION public.approve_access_request(uuid, uuid, public.company_role, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_access_request(uuid, uuid, public.company_role, text, text) TO service_role;


-- ============================================================================
-- >>> 20260924100600_function_execute_audit.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- EXECUTE privileges on public functions: explicit, per function.
--
-- Supabase's default privileges grant EXECUTE on every new public function
-- to anon and authenticated (and PostgreSQL grants it to PUBLIC), so a
-- REVOKE ... FROM PUBLIC alone leaves anon able to call a function. This
-- pass sets the intended audience of every function the migrations define:
--   * browser-visible market data (the public trade page uses the
--     publishable key): anon + authenticated;
--   * RLS helpers and signed-in market data: authenticated;
--   * everything else (engine, cash, approvals, email queue, triggers,
--     rate limiting): service_role only, called by trusted server code.
-- Functions that do not exist on a given database are skipped.
-- ============================================================================
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    'public.handle_new_user()',
    'public.set_updated_at()',
    'public.add_creator_as_owner()',
    'public.enforce_brand_cap()',
    'public.log_shariah_decision_update()',
    'public.protect_last_owner()',
    'public.shariah_decisions_stamp()',
    'public.shariah_decisions_enforce()',
    'public.brands_guard()',
    'public.product_submissions_guard()',
    'public.submission_documents_guard()',
    'public.email_queue_dispatch()',
    'public.email_queue_wake()',
    'public.check_rate_limit(text, integer, integer)',
    'public.enqueue_email(text, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.delete_email(text, bigint)',
    'public.move_to_dlq(text, text, bigint, jsonb)',
    'public.search_companies_public(text)',
    'public.get_company_by_slug_public(text)',
    'public.check_access_request_status(uuid, text)',
    'public.accept_company_invitation(uuid, uuid, text)',
    'public.approve_access_request(uuid, uuid, public.company_role, text, text)',
    'public.reject_access_request(uuid, uuid, text)',
    'public.post_cash_movement(uuid, text, numeric, uuid, text, uuid)',
    'public.apply_trade_position(uuid, text, text, text, numeric, numeric)',
    'public.match_order(uuid, text, text, text, text, numeric, numeric)',
    'public.cancel_order(uuid, uuid)',
    'public.replace_order(uuid, uuid, numeric, numeric)',
    'public.restore_order(uuid, uuid)',
    'public.engine_cancel_order(uuid, text, uuid)',
    'public.cancel_shariah_blocked_buys(text, uuid)',
    'public.current_shariah_status(text)',
    'public.list_my_trades(uuid, text, integer)'
  ];
  signed_in text[] := ARRAY[
    'public.has_role(uuid, public.app_role)',
    'public.has_company_role(uuid, uuid, public.company_role)',
    'public.is_company_owner(uuid, uuid)',
    'public.is_company_member(uuid, uuid)',
    'public.get_symbol_market_stats(text)',
    'public.get_market_snapshot(text[])'
  ];
  public_read text[] := ARRAY[
    'public.get_symbol_last_trade(text)',
    'public.get_order_book(text, integer)'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only || signed_in || public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY signed_in || public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
  FOREACH fn IN ARRAY public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', fn);
  END LOOP;
END $$;


-- ============================================================================
-- >>> 20260924100700_market_integrity_fixes.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Market integrity fixes (launch audit, fixer round 1).
--
--   1) Shariah: the ruling in force is the most recent CHANGE (new row, or a
--      status change on an existing row), tracked in effective_at. Before,
--      editing an older row to non_halal was shown but not enforced.
--   2) Price band anchor: the ±20% band is measured from the previous close
--      (the last trade before the current trading day, Asia/Riyadh), else
--      brands.reference_price. Trades of the current day no longer move the
--      band, so two colluding accounts cannot walk the price 20% per trade.
--      Every execution price is kept inside the band as well: a crossing
--      resting order priced outside it trades at the band edge, which is
--      never worse than its own limit.
--   3) Deactivated investors: resting orders whose owner no longer holds the
--      'trader' role are cancelled instead of filled, and
--      deactivate_trader() revokes the role and cancels the investor's
--      open/partial orders atomically.
--   4) Buying power race: every order path takes a per-user lock before the
--      cash/holdings checks, so concurrent orders of one trader on different
--      symbols are checked one after the other.
--   5) Self-trade prevention: an order that would cross the trader's own
--      resting order is rejected (SELF_TRADE) instead of resting on a
--      crossed book.
--   6) Legacy rows: a resting order with a fractional remaining quantity or
--      an off-tick price (K1) is cancelled when it is reached, never filled.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Shariah ruling in force = most recent change.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shariah_decisions ADD COLUMN IF NOT EXISTS effective_at timestamptz;

-- Backfill: creation time, or the latest recorded status change if later.
UPDATE public.shariah_decisions d
   SET effective_at = GREATEST(
         d.created_at,
         COALESCE((SELECT max(a.changed_at) FROM public.shariah_decision_audit a
                    WHERE a.decision_id = d.id
                      AND a.new_status IS DISTINCT FROM a.previous_status), d.created_at))
 WHERE d.effective_at IS NULL;

ALTER TABLE public.shariah_decisions ALTER COLUMN effective_at SET DEFAULT now();
ALTER TABLE public.shariah_decisions ALTER COLUMN effective_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shariah_decisions_symbol_effective
  ON public.shariah_decisions (symbol, effective_at DESC, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.current_shariah_status(_symbol text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.status
    FROM public.shariah_decisions d
   WHERE d.symbol = upper(btrim(_symbol))
   ORDER BY d.effective_at DESC, d.created_at DESC, d.id DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_shariah_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_shariah_status(text) TO service_role;

-- Identity columns and effective_at come from the session and the clock,
-- never from the client.
CREATE OR REPLACE FUNCTION public.shariah_decisions_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.symbol := upper(btrim(NEW.symbol));
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.effective_at := clock_timestamp();
    IF auth.uid() IS NOT NULL THEN
      NEW.reviewer_id := auth.uid();
      NEW.updated_by := auth.uid();
    END IF;
  ELSE
    NEW.created_at := OLD.created_at;
    -- A status change (or moving the row to another symbol) puts this row
    -- in force; a reason-only edit does not.
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.symbol IS DISTINCT FROM OLD.symbol THEN
      NEW.effective_at := clock_timestamp();
    ELSE
      NEW.effective_at := OLD.effective_at;
    END IF;
    IF auth.uid() IS NOT NULL THEN
      NEW.reviewer_id := OLD.reviewer_id;
      NEW.updated_by := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.shariah_decisions_stamp() FROM PUBLIC, anon, authenticated;

-- Rulings already in force under the new definition.
DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT DISTINCT o.symbol FROM public.orders o
            WHERE o.side = 'buy' AND o.status IN ('open', 'partial') LOOP
    IF public.current_shariah_status(s) = 'non_halal' THEN
      PERFORM public.cancel_shariah_blocked_buys(s, NULL);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Band reference price: previous close, else the listing reference.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.band_reference_price(_symbol text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT t.price
       FROM public.trades t
      WHERE t.symbol = upper(btrim(_symbol))
        AND t.created_at < (date_trunc('day', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh')
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 1),
    (SELECT b.reference_price FROM public.brands b WHERE b.symbol = upper(btrim(_symbol)))
  );
$$;
REVOKE ALL ON FUNCTION public.band_reference_price(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.band_reference_price(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Matching engine. Same signature and result columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_order(
  _user_id uuid, _symbol text, _asset_class text, _side text, _type text,
  _qty numeric, _limit_price numeric DEFAULT NULL
) RETURNS TABLE(order_id uuid, filled_qty numeric, avg_price numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  c_max_qty constant numeric := 10000000;
  c_max_notional constant numeric := 5000000;
  c_band constant numeric := 0.2;
  _brand public.brands;
  _opposite text;
  _price numeric;
  _ref numeric;
  _low numeric;
  _high numeric;
  _low_tick numeric;
  _high_tick numeric;
  _order_notional numeric;
  _cash numeric;
  _held numeric;
  _open numeric;
  _parties uuid[];
  my_order public.orders;
  cand public.orders;
  remaining numeric;
  trade_qty numeric;
  trade_price numeric;
  notional numeric;
  total_qty numeric := 0;
  total_cost numeric := 0;
  buyer uuid;
  seller uuid;
  buyer_cash numeric;
  seller_qty numeric;
  final_status text;
BEGIN
  -- Input validation (K1).
  IF _side IS NULL OR _side NOT IN ('buy', 'sell') THEN RAISE EXCEPTION 'INVALID_SIDE'; END IF;
  IF _type IS NULL OR _type NOT IN ('limit', 'market') THEN RAISE EXCEPTION 'INVALID_TYPE'; END IF;
  IF _qty IS NULL OR _qty = 'NaN'::numeric OR _qty <= 0 OR _qty > c_max_qty OR _qty <> trunc(_qty) THEN
    RAISE EXCEPTION 'INVALID_QTY';
  END IF;
  IF _type = 'limit' THEN
    IF _limit_price IS NULL OR _limit_price = 'NaN'::numeric OR _limit_price <= 0
       OR _limit_price > 1000000000 OR _limit_price <> round(_limit_price, 2) THEN
      RAISE EXCEPTION 'INVALID_PRICE';
    END IF;
    _price := _limit_price;
  ELSE
    _price := NULL;
  END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN_TRADER_REQUIRED'; END IF;

  -- One order path per trader at a time (placement, modify, restore,
  -- deactivation), taken before the symbol lock everywhere: the buying-power
  -- and holdings checks below then see the trader's other orders.
  PERFORM pg_advisory_xact_lock(4242, hashtext(_user_id::text));

  IF NOT public.has_role(_user_id, 'trader') THEN
    RAISE EXCEPTION 'FORBIDDEN_TRADER_REQUIRED';
  END IF;

  SELECT * INTO _brand FROM public.brands b WHERE b.symbol = _symbol AND b.published;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- One matcher per symbol at a time (shared with cancel/replace/restore and
  -- the Shariah trigger).
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _brand.symbol));

  IF public.current_shariah_status(_brand.symbol) = 'non_halal' AND _side = 'buy' THEN
    RAISE EXCEPTION 'SHARIAH_BLOCKED';
  END IF;

  -- Reference price (previous close, else the listing reference) and the
  -- protection band. Trades of the current day do not move it.
  _ref := public.band_reference_price(_brand.symbol);
  IF _ref IS NULL OR _ref <= 0 THEN RAISE EXCEPTION 'PRICE_OUT_OF_BAND'; END IF;
  _low := _ref * (1 - c_band);
  _high := _ref * (1 + c_band);
  -- Band edges on the 0.01 tick, inside the band.
  _low_tick := ceil(_low * 100) / 100;
  _high_tick := floor(_high * 100) / 100;
  IF _type = 'limit' AND (_price < _low OR _price > _high) THEN
    RAISE EXCEPTION 'PRICE_OUT_OF_BAND';
  END IF;

  -- Size limit: market orders are measured at the top of the band.
  _order_notional := _qty * COALESCE(_price, _high);
  IF _order_notional > c_max_notional THEN RAISE EXCEPTION 'ORDER_TOO_LARGE'; END IF;

  _opposite := CASE WHEN _side = 'buy' THEN 'sell' ELSE 'buy' END;

  -- Self-trade prevention: an order that would cross the trader's own
  -- resting order is refused (it would otherwise rest on a crossed book).
  IF EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.user_id = _user_id AND o.symbol = _brand.symbol AND o.side = _opposite
       AND o.status IN ('open', 'partial') AND o.price IS NOT NULL AND o.qty > o.filled_qty
       AND ((_side = 'buy' AND o.price <= COALESCE(_price, _high))
         OR (_side = 'sell' AND o.price >= COALESCE(_price, _low)))
  ) THEN
    RAISE EXCEPTION 'SELF_TRADE';
  END IF;

  -- The trader's own side must be covered, including what their other
  -- resting orders already promise (no spoofed depth).
  INSERT INTO public.portfolios (user_id, cash_balance) VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  IF _side = 'buy' THEN
    SELECT p.cash_balance INTO _cash FROM public.portfolios p WHERE p.user_id = _user_id;
    SELECT COALESCE(sum((o.qty - o.filled_qty) * o.price), 0) INTO _open
      FROM public.orders o
     WHERE o.user_id = _user_id AND o.side = 'buy'
       AND o.status IN ('open', 'partial') AND o.price IS NOT NULL;
    IF COALESCE(_cash, 0) < _order_notional + _open THEN RAISE EXCEPTION 'INSUFFICIENT_CASH'; END IF;
  ELSE
    SELECT ps.qty INTO _held FROM public.positions ps
     WHERE ps.user_id = _user_id AND ps.symbol = _brand.symbol;
    SELECT COALESCE(sum(o.qty - o.filled_qty), 0) INTO _open
      FROM public.orders o
     WHERE o.user_id = _user_id AND o.symbol = _brand.symbol AND o.side = 'sell'
       AND o.status IN ('open', 'partial');
    IF COALESCE(_held, 0) < _qty + _open THEN RAISE EXCEPTION 'INSUFFICIENT_QTY'; END IF;
  END IF;

  -- Defensive: resting buys on a non_halal symbol must never fill.
  IF public.current_shariah_status(_brand.symbol) = 'non_halal' THEN
    PERFORM public.cancel_shariah_blocked_buys(_brand.symbol, NULL);
  END IF;

  -- created_at is taken after the locks, so time priority follows the real
  -- arrival order.
  INSERT INTO public.orders
    (user_id, symbol, asset_class, side, type, qty, price, status, filled_qty, created_at, updated_at)
  VALUES
    (_user_id, _brand.symbol, _brand.asset_class, _side, _type, _qty, _price, 'open', 0,
     clock_timestamp(), clock_timestamp())
  RETURNING * INTO my_order;

  -- Lock every portfolio this order may touch, in user_id order, before any
  -- cash moves: two matchers on different symbols with overlapping traders
  -- then always lock in the same order and cannot deadlock.
  SELECT array_agg(DISTINCT o.user_id) INTO _parties
    FROM public.orders o
   WHERE o.symbol = _brand.symbol AND o.side = _opposite
     AND o.status IN ('open', 'partial') AND o.user_id <> _user_id
     AND o.price IS NOT NULL AND o.qty > o.filled_qty
     AND ((_side = 'buy' AND o.price <= COALESCE(_price, _high))
       OR (_side = 'sell' AND o.price >= COALESCE(_price, _low)));
  _parties := array_append(COALESCE(_parties, ARRAY[]::uuid[]), _user_id);
  INSERT INTO public.portfolios (user_id, cash_balance)
  SELECT u, 0 FROM unnest(_parties) AS u
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.portfolios p
   WHERE p.user_id = ANY(_parties)
   ORDER BY p.user_id
     FOR UPDATE;

  remaining := _qty;
  FOR cand IN
    SELECT * FROM public.orders o
     WHERE o.symbol = _brand.symbol AND o.side = _opposite
       AND o.status IN ('open', 'partial') AND o.user_id <> _user_id
       AND o.price IS NOT NULL AND o.qty > o.filled_qty
       AND ((_side = 'buy' AND o.price <= COALESCE(_price, _high))
         OR (_side = 'sell' AND o.price >= COALESCE(_price, _low)))
     ORDER BY CASE WHEN _side = 'buy' THEN o.price ELSE -o.price END ASC,
              o.created_at ASC, o.id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;

    -- Legacy rows that break K1 (fractional remaining units, off-tick price)
    -- are taken off the book, never filled.
    IF (cand.qty - cand.filled_qty) <> trunc(cand.qty - cand.filled_qty)
       OR cand.price <> round(cand.price, 2) THEN
      PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_invalid_order', NULL);
      CONTINUE;
    END IF;

    -- An investor whose trading access was withdrawn cannot trade, not even
    -- as the passive side.
    IF NOT public.has_role(cand.user_id, 'trader') THEN
      PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_inactive_trader', NULL);
      CONTINUE;
    END IF;

    trade_qty := LEAST(remaining, cand.qty - cand.filled_qty);
    CONTINUE WHEN trade_qty <= 0;
    -- Resting price, kept inside the band. A resting ask below the band
    -- trades at the band floor, a resting bid above it at the band ceiling:
    -- never worse than the resting order's limit, never outside the band.
    -- Both are on the 0.01 tick; scale 2 keeps trades.price and the ledger
    -- notes readable ('@ 360.00', not the division's 16 decimals).
    trade_price := round(CASE WHEN _side = 'buy' THEN GREATEST(cand.price, _low_tick)
                              ELSE LEAST(cand.price, _high_tick) END, 2);
    -- One rounded amount, debited and credited identically.
    notional := round(trade_qty * trade_price, 2);

    IF _side = 'buy' THEN
      buyer := _user_id; seller := cand.user_id;
    ELSE
      buyer := cand.user_id; seller := _user_id;
    END IF;

    SELECT p.cash_balance INTO buyer_cash FROM public.portfolios p WHERE p.user_id = buyer FOR UPDATE;
    IF COALESCE(buyer_cash, 0) < notional THEN
      IF buyer = cand.user_id THEN
        PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_insufficient_cash', NULL);
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'INSUFFICIENT_CASH';
    END IF;

    SELECT ps.qty INTO seller_qty FROM public.positions ps
     WHERE ps.user_id = seller AND ps.symbol = _brand.symbol FOR UPDATE;
    IF COALESCE(seller_qty, 0) < trade_qty THEN
      IF seller = cand.user_id THEN
        PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_insufficient_qty', NULL);
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'INSUFFICIENT_QTY';
    END IF;

    INSERT INTO public.trades
      (symbol, asset_class, qty, price, buy_order_id, sell_order_id, buyer_id, seller_id, created_at)
    VALUES
      (_brand.symbol, _brand.asset_class, trade_qty, trade_price,
       CASE WHEN _side = 'buy' THEN my_order.id ELSE cand.id END,
       CASE WHEN _side = 'buy' THEN cand.id ELSE my_order.id END,
       buyer, seller, clock_timestamp());

    PERFORM public.apply_trade_position(buyer, _brand.symbol, _brand.asset_class, 'buy', trade_qty, trade_price);
    PERFORM public.apply_trade_position(seller, _brand.symbol, _brand.asset_class, 'sell', trade_qty, trade_price);

    PERFORM public.post_cash_movement(buyer, 'order_buy', -notional,
      CASE WHEN _side = 'buy' THEN my_order.id ELSE cand.id END,
      'buy ' || trade_qty || ' ' || _brand.symbol || ' @ ' || trade_price, buyer);
    PERFORM public.post_cash_movement(seller, 'order_sell', notional,
      CASE WHEN _side = 'buy' THEN cand.id ELSE my_order.id END,
      'sell ' || trade_qty || ' ' || _brand.symbol || ' @ ' || trade_price, seller);

    -- filled_price is the running average fill price of the resting order.
    UPDATE public.orders o
       SET filled_qty = cand.filled_qty + trade_qty,
           filled_price = round(
             (COALESCE(cand.filled_price, 0) * cand.filled_qty + trade_qty * trade_price)
             / (cand.filled_qty + trade_qty), 4),
           status = CASE WHEN cand.filled_qty + trade_qty >= cand.qty THEN 'filled' ELSE 'partial' END,
           filled_at = clock_timestamp(),
           updated_at = clock_timestamp()
     WHERE o.id = cand.id;

    remaining := remaining - trade_qty;
    total_qty := total_qty + trade_qty;
    total_cost := total_cost + notional;
  END LOOP;

  IF remaining <= 0 THEN
    final_status := 'filled';
  ELSIF _type = 'market' THEN
    -- K3: a market order never rests; the unfilled remainder is cancelled.
    final_status := 'cancelled';
  ELSIF total_qty > 0 THEN
    final_status := 'partial';
  ELSE
    final_status := 'open';
  END IF;

  UPDATE public.orders o
     SET filled_qty = total_qty,
         status = final_status,
         filled_price = CASE WHEN total_qty > 0 THEN round(total_cost / total_qty, 4) ELSE NULL END,
         filled_at = CASE WHEN total_qty > 0 THEN clock_timestamp() ELSE NULL END,
         updated_at = clock_timestamp()
   WHERE o.id = my_order.id;

  IF final_status = 'cancelled' THEN
    INSERT INTO public.orders_audit
      (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by, previous_status, new_status)
    VALUES (my_order.id, 'market_unfilled', _qty, NULL, total_qty, NULL, NULL, 'open', 'cancelled');
  END IF;

  RETURN QUERY SELECT my_order.id, total_qty,
    CASE WHEN total_qty > 0 THEN round(total_cost / total_qty, 4) ELSE NULL::numeric END,
    final_status;
END;
$$;
REVOKE ALL ON FUNCTION public.match_order(uuid, text, text, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_order(uuid, text, text, text, text, numeric, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Modify / restore take the per-user lock before the symbol lock, the
--    same order as match_order (no lock-order inversion). Otherwise
--    unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_order(_user_id uuid, _order_id uuid, _price numeric, _qty numeric)
RETURNS TABLE(order_id uuid, filled_qty numeric, avg_price numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sym text;
  o public.orders;
  r record;
BEGIN
  SELECT x.symbol INTO _sym FROM public.orders x WHERE x.id = _order_id AND x.user_id = _user_id;
  IF _user_id IS NULL OR _sym IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_OPEN'; END IF;

  PERFORM pg_advisory_xact_lock(4242, hashtext(_user_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

  SELECT * INTO o FROM public.orders x WHERE x.id = _order_id AND x.user_id = _user_id FOR UPDATE;
  IF NOT FOUND OR o.status NOT IN ('open', 'partial') OR o.type <> 'limit' THEN
    RAISE EXCEPTION 'ORDER_NOT_OPEN';
  END IF;

  UPDATE public.orders x SET status = 'cancelled', updated_at = clock_timestamp() WHERE x.id = o.id;

  SELECT m.order_id, m.filled_qty, m.avg_price, m.status INTO r
    FROM public.match_order(_user_id, o.symbol, o.asset_class, o.side, 'limit', _qty, _price) m;

  INSERT INTO public.orders_audit
    (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by,
     previous_status, new_status, related_order_id)
  VALUES (o.id, 'modify', o.qty, o.price, _qty, _price, _user_id, o.status, 'cancelled', r.order_id);

  RETURN QUERY SELECT r.order_id, r.filled_qty, r.avg_price, r.status;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_order(uuid, uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_order(uuid, uuid, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.restore_order(_user_id uuid, _order_id uuid)
RETURNS TABLE(order_id uuid, filled_qty numeric, avg_price numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sym text;
  o public.orders;
  _remaining numeric;
  r record;
BEGIN
  SELECT x.symbol INTO _sym FROM public.orders x WHERE x.id = _order_id AND x.user_id = _user_id;
  IF _user_id IS NULL OR _sym IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_OPEN'; END IF;

  PERFORM pg_advisory_xact_lock(4242, hashtext(_user_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

  SELECT * INTO o FROM public.orders x WHERE x.id = _order_id AND x.user_id = _user_id FOR UPDATE;
  IF NOT FOUND OR o.status <> 'cancelled' THEN RAISE EXCEPTION 'ORDER_NOT_OPEN'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders_audit a
     WHERE a.order_id = o.id AND a.action IN ('modify', 'restore') AND a.related_order_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ORDER_NOT_OPEN';
  END IF;

  _remaining := o.qty - COALESCE(o.filled_qty, 0);
  IF _remaining <= 0 THEN RAISE EXCEPTION 'ORDER_NOT_OPEN'; END IF;

  SELECT m.order_id, m.filled_qty, m.avg_price, m.status INTO r
    FROM public.match_order(_user_id, o.symbol, o.asset_class, o.side, o.type, _remaining,
                            CASE WHEN o.type = 'limit' THEN o.price ELSE NULL END) m;

  INSERT INTO public.orders_audit
    (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by,
     previous_status, new_status, related_order_id)
  VALUES (o.id, 'restore', o.qty, o.price, _remaining, o.price, _user_id, 'cancelled', 'cancelled', r.order_id);

  RETURN QUERY SELECT r.order_id, r.filled_qty, r.avg_price, r.status;
END;
$$;
REVOKE ALL ON FUNCTION public.restore_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_order(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Deactivate an investor: revoke 'trader' and cancel every open/partial
--    order of theirs in one transaction. Returns the number of orders
--    cancelled. Platform admins only (checked here and by the server).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deactivate_trader(_user_id uuid, _actor_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s text;
  o record;
  n integer := 0;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;

  -- Same lock order as match_order: user, then symbols (sorted).
  PERFORM pg_advisory_xact_lock(4242, hashtext(_user_id::text));

  DELETE FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.role = 'trader';

  FOR s IN
    SELECT DISTINCT x.symbol FROM public.orders x
     WHERE x.user_id = _user_id AND x.status IN ('open', 'partial')
     ORDER BY x.symbol
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('match:' || s));
    FOR o IN
      SELECT x.id FROM public.orders x
       WHERE x.user_id = _user_id AND x.symbol = s AND x.status IN ('open', 'partial')
    LOOP
      PERFORM public.engine_cancel_order(o.id, 'deactivate_cancel', _actor_id);
      n := n + 1;
    END LOOP;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.deactivate_trader(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_trader(uuid, uuid) TO service_role;


-- ============================================================================
-- >>> 20260924100800_governance_and_listing_fixes.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Governance and listing fixes (launch audit, fixer round 1).
--
--   1) user_roles is the privilege gate (platform_admin, trader, ...). No
--      application code writes it with a user session (investor activation
--      runs on the server with the service role), so authenticated keeps
--      SELECT only and every write policy is dropped, whatever its name, as
--      for the financial tables. A drifted self-insert policy can then no
--      longer let a user grant themselves a role.
--   2) product_submissions: a reviewer may only move a PENDING submission to
--      approved or rejected, and 'approved' requires the published brand the
--      server lists first (brands.source_submission_id). Decided rows are
--      frozen for API users.
--   3) Primary issuance of brand units: unit_issuances (append-only record)
--      and issue_units(), the only way units enter the market besides
--      trading. Platform admins only, through the server.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) user_roles: read-only for API users.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.policyname FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'user_roles' AND p.cmd <> 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.user_roles', r.policyname);
  END LOOP;
END $$;

-- Platform admins keep reading every role row (the FOR ALL policy that used
-- to allow it is gone).
DROP POLICY IF EXISTS "user_roles_admin_read" ON public.user_roles;
CREATE POLICY "user_roles_admin_read" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'platform_admin'));

-- ---------------------------------------------------------------------------
-- 2) product_submissions: pending -> approved | rejected only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.reviewer_id := NULL;
    NEW.review_reason := NULL;
    NEW.reviewed_at := NULL;
    NEW.submitted_at := now();
    NEW.created_at := now();
    NEW.updated_at := now();
    IF auth.uid() IS NOT NULL THEN
      NEW.submitted_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    -- A decision is final for API users; only a pending submission changes.
    IF OLD.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'SUBMISSION_NOT_PENDING';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'SUBMISSION_NOT_PENDING';
      END IF;
      -- Approval means "listed": the server publishes the brand first.
      IF NEW.status = 'approved' AND NOT EXISTS (
        SELECT 1 FROM public.brands b
         WHERE b.source_submission_id = NEW.id AND b.company_id = NEW.company_id AND b.published
      ) THEN
        RAISE EXCEPTION 'BRAND_NOT_LISTED';
      END IF;
      NEW.reviewed_at := now();
    ELSE
      NEW.reviewed_at := OLD.reviewed_at;
    END IF;
    NEW.reviewer_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.product_submissions_guard() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Primary issuance of brand units.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.unit_issuances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  user_id uuid NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0 AND qty = trunc(qty)),
  price numeric NOT NULL CHECK (price > 0 AND price = round(price, 2)),
  note text CHECK (note IS NULL OR char_length(note) <= 280),
  issued_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_unit_issuances_symbol ON public.unit_issuances (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unit_issuances_user ON public.unit_issuances (user_id, created_at DESC);

ALTER TABLE public.unit_issuances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.unit_issuances FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.unit_issuances TO service_role;
GRANT SELECT ON public.unit_issuances TO authenticated;

DROP POLICY IF EXISTS "unit_issuances_read_own" ON public.unit_issuances;
CREATE POLICY "unit_issuances_read_own" ON public.unit_issuances
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "unit_issuances_platform_admin_read" ON public.unit_issuances;
CREATE POLICY "unit_issuances_platform_admin_read" ON public.unit_issuances
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'platform_admin'));

-- Credits _qty units of a published brand to _user_id at the issue price
-- (the holder's cost basis). Payment for primary allocations is settled
-- outside the order book. Returns the issuance id.
CREATE OR REPLACE FUNCTION public.issue_units(
  _actor_id uuid, _user_id uuid, _symbol text, _qty numeric, _price numeric, _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _brand public.brands;
  _id uuid;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;
  IF _qty IS NULL OR _qty = 'NaN'::numeric OR _qty <= 0 OR _qty > 10000000 OR _qty <> trunc(_qty) THEN
    RAISE EXCEPTION 'INVALID_QTY';
  END IF;
  IF _price IS NULL OR _price = 'NaN'::numeric OR _price <= 0 OR _price > 1000000000
     OR _price <> round(_price, 2) THEN
    RAISE EXCEPTION 'INVALID_PRICE';
  END IF;
  IF _note IS NOT NULL AND char_length(_note) > 280 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF _user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  SELECT * INTO _brand FROM public.brands b WHERE b.symbol = upper(btrim(_symbol)) AND b.published;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- Same lock order as the order paths: user, then symbol.
  PERFORM pg_advisory_xact_lock(4242, hashtext(_user_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _brand.symbol));

  PERFORM public.apply_trade_position(_user_id, _brand.symbol, _brand.asset_class, 'buy', _qty, _price);

  INSERT INTO public.unit_issuances (symbol, user_id, qty, price, note, issued_by)
  VALUES (_brand.symbol, _user_id, _qty, _price, NULLIF(btrim(COALESCE(_note, '')), ''), _actor_id)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_units(uuid, uuid, text, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_units(uuid, uuid, text, numeric, numeric, text) TO service_role;


-- ============================================================================
-- >>> 20260924100900_legacy_state_cleanup.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Legacy state cleanup before launch (launch audit, fixer round 1).
--
-- Before 20260924100100 users could write orders, positions and portfolios
-- directly (backdated or fractional resting orders, bids at 10x the price,
-- minted units, self-set cash). The lockdown stops new writes; this
-- migration deals with rows that already exist.
--
--   1) Every order still resting (open/partial) when this migration runs was
--      accepted under the old rules (it ships in the same release as the
--      hardened engine, 20260924100200). It is closed as 'cancelled' with an
--      orders_audit 'legacy_close' row. Nothing else changes: no cash or
--      units move. Owners can restore such an order, which re-places it as a
--      NEW order through every engine check (whole units, tick, band,
--      Shariah, buying power, holdings).
--   2) Accounts whose balances cannot be explained are put on hold for a
--      manual review instead of being silently legitimized:
--        * cash: the 'opening balance reconciliation' booked by
--          20260924100300 exceeds what was credited outside the ledger by
--          the platform itself: 100,000.00 (the old column default) plus the
--          result of the pre-engine fills whose cash placeOrder wrote
--          straight to the balance before 2026-08-12 (valued as the old app
--          filled them; sales count only when the units reconcile);
--        * units: a position is larger than issuances + units bought -
--          units sold + legacy fills that predate the trades table.
--        A legacy fill counts only if the old app could have written it
--        (positive quantity and price); a fabricated row explains nothing.
--      A held account loses the 'trader' role (it can no longer trade; its
--      resting orders were closed above) and gets a row in
--      launch_review_holds (service role only). Balances are NOT changed. A
--      platform admin reviews the row and re-activates the investor (or
--      corrects the balance) afterwards.
-- Idempotent: re-running it closes nothing new and adds no duplicate hold.
-- ============================================================================

-- 1) Close legacy resting orders.
WITH legacy AS (
  SELECT o.id, o.qty, o.price, o.status
    FROM public.orders o
   WHERE o.status IN ('open', 'partial')
   FOR UPDATE
), upd AS (
  UPDATE public.orders o
     SET status = 'cancelled', updated_at = clock_timestamp()
    FROM legacy
   WHERE o.id = legacy.id
  RETURNING o.id
)
INSERT INTO public.orders_audit
  (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by, previous_status, new_status)
SELECT legacy.id, 'legacy_close', legacy.qty, legacy.price, legacy.qty, legacy.price, NULL, legacy.status, 'cancelled'
  FROM legacy JOIN upd ON upd.id = legacy.id;

-- 2) Review holds.
CREATE TABLE IF NOT EXISTS public.launch_review_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('unexplained_cash', 'unexplained_units')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  had_trader_role boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  UNIQUE (user_id, reason)
);
ALTER TABLE public.launch_review_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.launch_review_holds FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.launch_review_holds TO service_role;

-- One statement: the candidates, the hold rows and the role revocation all
-- see the same snapshot (had_trader_role is the state before this run), and
-- only holds inserted now revoke a role, so a re-run never undoes an admin's
-- re-activation after review.
WITH fills AS (
  -- Fills of the pre-engine placeOrder (until 2026-08-20): marked filled at
  -- once at the investor's own price, with no trade row. Only rows that app
  -- could have written explain anything: buy or sell, 0 < qty <= 1,000,000,
  -- filled_qty 0 (the column came later) or at most qty, a positive fill
  -- price. Investors could write orders directly, so a fabricated negative,
  -- zero or NaN quantity or price (NaN compares greater than any number and
  -- poisons every sum it enters) would otherwise explain self-set cash or
  -- minted units; such a row explains nothing, as if it did not exist.
  SELECT o.id, o.user_id, o.symbol,
         CASE WHEN o.side = 'buy' THEN 1 ELSE -1 END
         * CASE WHEN o.filled_qty > 0 THEN o.filled_qty ELSE o.qty END AS units,
         COALESCE(o.filled_price, o.price) AS price
    FROM public.orders o
   WHERE o.status = 'filled'
     AND o.side IN ('buy', 'sell')
     AND o.qty > 0 AND o.qty <= 1000000
     AND o.filled_qty >= 0 AND o.filled_qty <= o.qty
     AND COALESCE(o.filled_price, o.price) > 0
     AND COALESCE(o.filled_price, o.price) < 'Infinity'::numeric
     AND NOT EXISTS (SELECT 1 FROM public.trades t WHERE t.buy_order_id = o.id OR t.sell_order_id = o.id)
), moves AS (
  -- Units nobody issued or sold to the holder.
  SELECT i.user_id, i.symbol, i.qty FROM public.unit_issuances i
  UNION ALL SELECT t.buyer_id, t.symbol, t.qty FROM public.trades t
  UNION ALL SELECT t.seller_id, t.symbol, -t.qty FROM public.trades t
  UNION ALL SELECT f.user_id, f.symbol, f.units FROM fills f
), explained AS (
  SELECT m.user_id, m.symbol, sum(m.qty) AS qty FROM moves m GROUP BY m.user_id, m.symbol
), backed AS (
  -- Symbols whose units reconcile exactly: a pre-engine sale there sold
  -- units the investor really held.
  SELECT e.user_id, e.symbol
    FROM explained e
    LEFT JOIN public.positions p ON p.user_id = e.user_id AND p.symbol = e.symbol
   WHERE e.qty >= 0 AND e.qty = COALESCE(p.qty, 0)
), fill_cash AS (
  -- Cash of pre-engine fills that never reached the ledger: before
  -- 2026-08-12 placeOrder wrote portfolios.cash_balance directly, so that
  -- profit or loss is part of the opening balance reconciliation (later
  -- fills posted a ledger row referencing the order). Purchases always
  -- count; sales only on backed symbols, so a fabricated sale cannot
  -- explain self-set cash. Tolerance: the old app rounded each balance write
  -- to the cent and priced on the unrounded limit (orders keep 4 decimals).
  SELECT f.user_id,
         sum(-f.units * f.price) AS amount,
         sum(0.01 + 0.00005 * abs(f.units)) AS tolerance
    FROM fills f
   WHERE NOT EXISTS (SELECT 1 FROM public.cash_ledger l WHERE l.ref_order_id = f.id)
     AND (f.units > 0 OR EXISTS (SELECT 1 FROM backed b WHERE b.user_id = f.user_id AND b.symbol = f.symbol))
   GROUP BY f.user_id
), cash_holds AS (
  -- Cash credited outside the ledger beyond the old 100,000 default plus
  -- the result of the unledgered pre-engine fills (with a cent per ledger
  -- row: ledger amounts were not rounded to the cent before 20260924100300).
  SELECT r.user_id, 'unexplained_cash'::text AS reason,
         jsonb_build_object('reconciliation_amount', r.amount,
                            'explained_amount', round(100000 + COALESCE(fc.amount, 0), 2)) AS detail
    FROM (SELECT l.user_id, sum(l.amount) AS amount
            FROM public.cash_ledger l
           WHERE l.note = 'opening balance reconciliation' AND l.kind = 'adjustment'
           GROUP BY l.user_id) r
    LEFT JOIN fill_cash fc ON fc.user_id = r.user_id
   WHERE r.amount > 100000 + COALESCE(fc.amount, 0) + COALESCE(fc.tolerance, 0)
                    + 0.01 * (SELECT count(*) FROM public.cash_ledger l WHERE l.user_id = r.user_id)
), unit_holds AS (
  SELECT p.user_id, 'unexplained_units'::text AS reason,
         jsonb_object_agg(p.symbol, jsonb_build_object('held', p.qty, 'explained', COALESCE(e.qty, 0))) AS detail
    FROM public.positions p
    LEFT JOIN explained e ON e.user_id = p.user_id AND e.symbol = p.symbol
   WHERE p.qty > COALESCE(e.qty, 0)
   GROUP BY p.user_id
), held AS (
  INSERT INTO public.launch_review_holds (user_id, reason, detail, had_trader_role)
  SELECT c.user_id, c.reason, c.detail, public.has_role(c.user_id, 'trader')
    FROM (SELECT * FROM cash_holds UNION ALL SELECT * FROM unit_holds) c
  ON CONFLICT (user_id, reason) DO NOTHING
  RETURNING user_id
)
-- Suspend trading for the accounts put on hold by this run.
DELETE FROM public.user_roles ur
 WHERE ur.role = 'trader'
   AND ur.user_id IN (SELECT h.user_id FROM held h);


-- ============================================================================
-- >>> 20260925100000_public_market_data.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Public market data (phase 2: a truthful market).
--
-- Read-only functions behind the public market pages (callable with the
-- publishable key, i.e. as anon, and by signed-in users). Every number comes
-- from executed trades (public.trades, written only by the matching engine)
-- and from published instruments (public.brands.published). They return
-- aggregates and instrument data only: never a user id, order id, trade id,
-- issuance holder or reviewer identity. Every result is capped.
--
--   public_market_overview(_company_id)   one row per published instrument
--   public_market_summary()               listed count, 24h trades/value, last trade
--   public_instrument(_slug)              one instrument (slug or symbol) with
--                                         today's open/high/low and the engine's band
--   public_candles(_symbol, _interval, _limit)  OHLCV buckets that have trades
--   public_recent_trades(_symbol, _limit) the trade tape (price, qty, time)
--   public_shariah_rulings()              ruling in force per published instrument
--   public_company_profile(_id)           a company linked to a published instrument
--
-- Definitions shared with the engine:
--   * last price: the most recent trade (created_at, id);
--   * 24h change: last price vs the last trade at least 24h old, else the
--     first trade inside the window (as get_symbol_market_stats);
--   * volume: each trade counted once (units = sum(qty), value = sum(qty*price));
--   * trading day: Asia/Riyadh calendar day (as band_reference_price);
--   * band: band_reference_price() ± 20%, edges on the 0.01 tick inside the
--     band, exactly the limit prices match_order accepts;
--   * Shariah status: current_shariah_status() (the ruling in force).
--
-- Also:
--   * get_order_book / get_symbol_last_trade (anon market data) now answer
--     for published instruments only;
--   * anon keeps reading shariah_decisions for the public rulings list, but
--     no longer the reviewer_id / updated_by columns (user ids).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Internal: one row of market data per published instrument, optionally of
-- one company or one instrument. SECURITY INVOKER and not executable by API
-- roles: only the SECURITY DEFINER wrappers below (running as the owner)
-- and the service role call it.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.market_instrument_rows(uuid, uuid);
CREATE FUNCTION public.market_instrument_rows(_company_id uuid DEFAULT NULL, _brand_id uuid DEFAULT NULL)
RETURNS TABLE (
  brand_id uuid,
  symbol text,
  slug text,
  name_ar text,
  name_en text,
  sector text,
  asset_class text,
  company_id uuid,
  company_name_ar text,
  company_name_en text,
  reference_price numeric,
  last_price numeric,
  change_24h_pct numeric,
  volume_24h_units numeric,
  volume_24h_value numeric,
  trades_24h bigint,
  last_trade_at timestamptz,
  shariah_status text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT b.id, b.symbol, b.slug, b.name_ar, b.name_en, b.sector, b.asset_class,
         b.company_id, c.name_ar, c.name_en,
         b.reference_price,
         lt.price,
         CASE WHEN lt.price IS NOT NULL AND base.price IS NOT NULL AND base.price <> 0
              THEN round(((lt.price - base.price) / base.price) * 100, 2) END,
         COALESCE(w.units, 0),
         COALESCE(w.value, 0),
         COALESCE(w.cnt, 0),
         lt.created_at,
         public.current_shariah_status(b.symbol)
    FROM public.brands b
    LEFT JOIN public.companies c ON c.id = b.company_id
    LEFT JOIN LATERAL (
      SELECT t.price, t.created_at
        FROM public.trades t
       WHERE t.symbol = b.symbol
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 1
    ) lt ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        (SELECT t.price FROM public.trades t
          WHERE t.symbol = b.symbol AND t.created_at <= now() - interval '24 hours'
          ORDER BY t.created_at DESC, t.id DESC LIMIT 1),
        (SELECT t.price FROM public.trades t
          WHERE t.symbol = b.symbol AND t.created_at > now() - interval '24 hours'
          ORDER BY t.created_at ASC, t.id ASC LIMIT 1)
      ) AS price
    ) base ON true
    LEFT JOIN LATERAL (
      SELECT sum(t.qty) AS units, round(sum(t.qty * t.price), 2) AS value, count(*) AS cnt
        FROM public.trades t
       WHERE t.symbol = b.symbol AND t.created_at > now() - interval '24 hours'
    ) w ON true
   WHERE b.published
     AND (_company_id IS NULL OR b.company_id = _company_id)
     AND (_brand_id IS NULL OR b.id = _brand_id)
   ORDER BY b.symbol
   LIMIT 1000;
$$;

-- ---------------------------------------------------------------------------
-- Market board: every published instrument (at most 1000), by symbol.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_market_overview(uuid);
CREATE FUNCTION public.public_market_overview(_company_id uuid DEFAULT NULL)
RETURNS TABLE (
  symbol text,
  slug text,
  name_ar text,
  name_en text,
  sector text,
  asset_class text,
  company_id uuid,
  company_name_ar text,
  company_name_en text,
  reference_price numeric,
  last_price numeric,
  change_24h_pct numeric,
  volume_24h_units numeric,
  volume_24h_value numeric,
  trades_24h bigint,
  last_trade_at timestamptz,
  shariah_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.symbol, r.slug, r.name_ar, r.name_en, r.sector, r.asset_class,
         r.company_id, r.company_name_ar, r.company_name_en,
         r.reference_price, r.last_price, r.change_24h_pct,
         r.volume_24h_units, r.volume_24h_value, r.trades_24h, r.last_trade_at,
         r.shariah_status
    FROM public.market_instrument_rows(_company_id, NULL) r
   ORDER BY r.symbol;
$$;

-- ---------------------------------------------------------------------------
-- Market summary over published instruments.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_market_summary();
CREATE FUNCTION public.public_market_summary()
RETURNS TABLE (
  listed_count bigint,
  trades_24h bigint,
  volume_24h_value numeric,
  last_trade_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM public.brands b WHERE b.published),
    (SELECT count(*)
       FROM public.trades t JOIN public.brands b ON b.symbol = t.symbol AND b.published
      WHERE t.created_at > now() - interval '24 hours'),
    (SELECT COALESCE(round(sum(t.qty * t.price), 2), 0)
       FROM public.trades t JOIN public.brands b ON b.symbol = t.symbol AND b.published
      WHERE t.created_at > now() - interval '24 hours'),
    (SELECT max(lt.created_at)
       FROM public.brands b
       CROSS JOIN LATERAL (
         SELECT t.created_at FROM public.trades t
          WHERE t.symbol = b.symbol
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT 1
       ) lt
      WHERE b.published);
$$;

-- ---------------------------------------------------------------------------
-- One published instrument by slug or symbol (case-insensitive; a slug
-- match wins, as in getInstrument), with today's (Asia/Riyadh) open, high
-- and low and the price band the engine enforces right now.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_instrument(text);
CREATE FUNCTION public.public_instrument(_slug text)
RETURNS TABLE (
  symbol text,
  slug text,
  name_ar text,
  name_en text,
  sector text,
  asset_class text,
  company_id uuid,
  company_name_ar text,
  company_name_en text,
  reference_price numeric,
  last_price numeric,
  change_24h_pct numeric,
  volume_24h_units numeric,
  volume_24h_value numeric,
  trades_24h bigint,
  last_trade_at timestamptz,
  shariah_status text,
  day_open numeric,
  day_high numeric,
  day_low numeric,
  band_reference numeric,
  band_low numeric,
  band_high numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH target AS (
    SELECT b.id, b.symbol
      FROM public.brands b
     WHERE b.published
       AND char_length(btrim(COALESCE(_slug, ''))) BETWEEN 1 AND 64
       AND (lower(b.slug) = lower(btrim(_slug)) OR b.symbol = upper(btrim(_slug)))
     ORDER BY (lower(b.slug) = lower(btrim(_slug))) DESC, b.symbol
     LIMIT 1
  ), ref AS (
    -- The engine's anchor: previous close, else the listing reference price.
    SELECT public.band_reference_price(t.symbol) AS price FROM target t
  ), day AS (
    SELECT (array_agg(tr.price ORDER BY tr.created_at ASC, tr.id ASC))[1] AS open_price,
           max(tr.price) AS high_price,
           min(tr.price) AS low_price
      FROM public.trades tr
      JOIN target t ON t.symbol = tr.symbol
     WHERE tr.created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh')
  )
  SELECT r.symbol, r.slug, r.name_ar, r.name_en, r.sector, r.asset_class,
         r.company_id, r.company_name_ar, r.company_name_en,
         r.reference_price, r.last_price, r.change_24h_pct,
         r.volume_24h_units, r.volume_24h_value, r.trades_24h, r.last_trade_at,
         r.shariah_status,
         day.open_price, day.high_price, day.low_price,
         ref.price,
         -- match_order: low = ref * (1 - 0.2), high = ref * (1 + 0.2); a limit
         -- price outside [low, high] is refused, so on the 0.01 tick the
         -- accepted range is [ceil(low), floor(high)].
         CASE WHEN ref.price > 0 THEN round(ceil(ref.price * (1 - 0.2) * 100) / 100, 2) END,
         CASE WHEN ref.price > 0 THEN round(floor(ref.price * (1 + 0.2) * 100) / 100, 2) END
    FROM target t
    CROSS JOIN LATERAL public.market_instrument_rows(NULL, t.id) r
    CROSS JOIN ref
    CROSS JOIN day;
$$;

-- ---------------------------------------------------------------------------
-- Candles: OHLCV per bucket that has trades, oldest first. '1h' buckets
-- are clock hours (UTC; Asia/Riyadh is a whole-hour offset without DST),
-- '1d' buckets are Asia/Riyadh days. The most recent _limit buckets
-- (default 200, at most 500). Any other interval returns nothing.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_candles(text, text, integer);
CREATE FUNCTION public.public_candles(_symbol text, _interval text DEFAULT '1d', _limit integer DEFAULT 200)
RETURNS TABLE (
  bucket_start timestamptz,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  close_price numeric,
  volume_units numeric,
  trade_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH target AS (
    SELECT b.symbol
      FROM public.brands b
     WHERE b.published
       AND _interval IN ('1h', '1d')
       AND char_length(btrim(COALESCE(_symbol, ''))) BETWEEN 1 AND 64
       AND b.symbol = upper(btrim(_symbol))
  ), bucketed AS (
    SELECT CASE WHEN _interval = '1h'
                THEN date_trunc('hour', t.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                ELSE date_trunc('day', t.created_at AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'
           END AS bucket,
           t.price, t.qty, t.created_at, t.id
      FROM public.trades t
      JOIN target ON target.symbol = t.symbol
  ), agg AS (
    SELECT bk.bucket,
           (array_agg(bk.price ORDER BY bk.created_at ASC, bk.id ASC))[1] AS open_price,
           max(bk.price) AS high_price,
           min(bk.price) AS low_price,
           (array_agg(bk.price ORDER BY bk.created_at DESC, bk.id DESC))[1] AS close_price,
           sum(bk.qty) AS volume_units,
           count(*) AS trade_count
      FROM bucketed bk
     GROUP BY bk.bucket
     ORDER BY bk.bucket DESC
     LIMIT LEAST(GREATEST(COALESCE(_limit, 200), 1), 500)
  )
  SELECT a.bucket, a.open_price, a.high_price, a.low_price, a.close_price, a.volume_units, a.trade_count
    FROM agg a
   ORDER BY a.bucket ASC;
$$;

-- ---------------------------------------------------------------------------
-- Trade tape: newest first, price / quantity / time only (default 20, at
-- most 50).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_recent_trades(text, integer);
CREATE FUNCTION public.public_recent_trades(_symbol text, _limit integer DEFAULT 20)
RETURNS TABLE (
  price numeric,
  qty numeric,
  traded_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.price, t.qty, t.created_at
    FROM public.trades t
    JOIN public.brands b ON b.symbol = t.symbol AND b.published
   WHERE char_length(btrim(COALESCE(_symbol, ''))) BETWEEN 1 AND 64
     AND b.symbol = upper(btrim(_symbol))
   ORDER BY t.created_at DESC, t.id DESC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- The ruling in force for every published instrument that has one: the
-- same row current_shariah_status() picks (most recent change: effective_at,
-- then created_at, then id). No reviewer identity.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_shariah_rulings();
CREATE FUNCTION public.public_shariah_rulings()
RETURNS TABLE (
  symbol text,
  slug text,
  name_ar text,
  name_en text,
  status text,
  reason text,
  effective_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.symbol, b.slug, b.name_ar, b.name_en, d.status, d.reason, d.effective_at
    FROM public.brands b
    CROSS JOIN LATERAL (
      SELECT x.status, x.reason, x.effective_at
        FROM public.shariah_decisions x
       WHERE x.symbol = upper(btrim(b.symbol))
       ORDER BY x.effective_at DESC, x.created_at DESC, x.id DESC
       LIMIT 1
    ) d
   WHERE b.published
   ORDER BY b.symbol
   LIMIT 1000;
$$;

-- ---------------------------------------------------------------------------
-- Public company card: only a company linked to at least one published
-- instrument (its instruments come from public_market_overview(_id)).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_company_profile(uuid);
CREATE FUNCTION public.public_company_profile(_id uuid)
RETURNS TABLE (
  id uuid,
  name_ar text,
  name_en text,
  sector text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.name_ar, c.name_en, c.sector
    FROM public.companies c
   WHERE c.id = _id
     AND EXISTS (SELECT 1 FROM public.brands b WHERE b.company_id = c.id AND b.published);
$$;

-- ---------------------------------------------------------------------------
-- Existing anon market data: published instruments only. Same signatures
-- and result columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_symbol_last_trade(_symbol text)
RETURNS TABLE(last_price numeric, traded_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.price, t.created_at
    FROM public.trades t
   WHERE t.symbol = _symbol
     AND EXISTS (SELECT 1 FROM public.brands b WHERE b.symbol = t.symbol AND b.published)
   ORDER BY t.created_at DESC, t.id DESC
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_order_book(_symbol text, _depth integer DEFAULT 12)
RETURNS TABLE(side text, price numeric, qty numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  (SELECT o.side, o.price, sum(o.qty - o.filled_qty) AS qty
     FROM public.orders o
    WHERE o.symbol = _symbol AND o.side = 'buy' AND o.status IN ('open','partial') AND o.price IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.brands b WHERE b.symbol = o.symbol AND b.published)
    GROUP BY o.side, o.price HAVING sum(o.qty - o.filled_qty) > 0
    ORDER BY o.price DESC LIMIT LEAST(GREATEST(COALESCE(_depth, 12), 1), 50))
  UNION ALL
  (SELECT o.side, o.price, sum(o.qty - o.filled_qty) AS qty
     FROM public.orders o
    WHERE o.symbol = _symbol AND o.side = 'sell' AND o.status IN ('open','partial') AND o.price IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.brands b WHERE b.symbol = o.symbol AND b.published)
    GROUP BY o.side, o.price HAVING sum(o.qty - o.filled_qty) > 0
    ORDER BY o.price ASC LIMIT LEAST(GREATEST(COALESCE(_depth, 12), 1), 50));
$$;

-- ---------------------------------------------------------------------------
-- shariah_decisions: anon reads the public columns only (the rulings list
-- of the public site), never reviewer_id / updated_by (user ids).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.shariah_decisions') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.shariah_decisions FROM anon;
    GRANT SELECT (id, symbol, status, reason, created_at, updated_at, effective_at)
      ON public.shariah_decisions TO anon;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- EXECUTE allow list (pattern of 20260924100600_function_execute_audit.sql).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    'public.market_instrument_rows(uuid, uuid)'
  ];
  public_read text[] := ARRAY[
    'public.public_market_overview(uuid)',
    'public.public_market_summary()',
    'public.public_instrument(text)',
    'public.public_candles(text, text, integer)',
    'public.public_recent_trades(text, integer)',
    'public.public_shariah_rulings()',
    'public.public_company_profile(uuid)',
    'public.get_symbol_last_trade(text)',
    'public.get_order_book(text, integer)'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only || public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', fn);
  END LOOP;
END $$;


-- ============================================================================
-- >>> 20260925100100_instrument_publish_control.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Listing control: publish / unpublish an instrument (platform admins,
-- through the server).
--
--   1) close_instrument_orders(symbol, action, actor): closes every resting
--      (open/partial) order of an instrument as 'cancelled' with an
--      orders_audit row, under the engine's per-symbol lock. No cash or
--      units move (resting orders hold no funds; buying power is computed
--      from open orders). Service role only.
--   2) set_instrument_published(symbol, published, actor): the admin switch.
--      Publishing needs a positive reference price (it anchors the band).
--      Unpublishing takes the instrument off the market and closes its
--      resting orders (orders_audit action 'delisted') in the same
--      transaction. Positions, cash and trades are never touched: holders
--      keep their units and their history. Service role only; the server
--      checks platform_admin first and this function checks it again.
--   3) A resting order can only exist on a published instrument: an order
--      inserted open/partial for an unpublished symbol is refused
--      (INSTRUMENT_NOT_FOUND). This closes the window where match_order read
--      the instrument just before it was unpublished.
--   4) A published instrument always has a reference price in
--      (0, 1,000,000,000], so the band shown to users always exists.
--      Published rows that break it are unpublished first (and their orders
--      closed) so the constraint can be validated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Close an instrument's resting orders.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_instrument_orders(_symbol text, _action text, _actor uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sym text := upper(btrim(COALESCE(_symbol, '')));
  n integer;
BEGIN
  IF _sym = '' THEN RETURN 0; END IF;
  IF _action IS NULL OR _action !~ '^[a-z_]{1,40}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  -- Same per-symbol lock as match_order / cancel_order / the Shariah
  -- trigger: no fill runs on this symbol while its book is closed.
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

  WITH closing AS (
    SELECT o.id, o.qty, o.price, o.status
      FROM public.orders o
     WHERE upper(o.symbol) = _sym AND o.status IN ('open', 'partial')
     ORDER BY o.id
       FOR UPDATE
  ), upd AS (
    UPDATE public.orders o
       SET status = 'cancelled', updated_at = clock_timestamp()
      FROM closing
     WHERE o.id = closing.id
    RETURNING o.id
  )
  INSERT INTO public.orders_audit
    (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by, previous_status, new_status)
  SELECT closing.id, _action, closing.qty, closing.price, closing.qty, closing.price, _actor, closing.status, 'cancelled'
    FROM closing JOIN upd ON upd.id = closing.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Publish / unpublish.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_instrument_published(text, boolean, uuid);
CREATE FUNCTION public.set_instrument_published(_symbol text, _published boolean, _actor_id uuid)
RETURNS TABLE(brand_id uuid, company_id uuid, symbol text, published boolean, changed boolean, cancelled_orders integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sym text := upper(btrim(COALESCE(_symbol, '')));
  _brand public.brands;
  _n integer := 0;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;
  IF _published IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF _sym !~ '^[A-Z0-9._-]{1,32}$' THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- Symbol lock first (as every order path), then the rows.
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

  SELECT * INTO _brand FROM public.brands b WHERE b.symbol = _sym FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  IF _published AND NOT (_brand.reference_price > 0 AND _brand.reference_price <= 1000000000) THEN
    RAISE EXCEPTION 'INVALID_PRICE';
  END IF;

  IF _brand.published IS DISTINCT FROM _published THEN
    UPDATE public.brands b SET published = _published WHERE b.id = _brand.id;
  END IF;

  IF NOT _published THEN
    _n := public.close_instrument_orders(_brand.symbol, 'delisted', _actor_id);
  END IF;

  RETURN QUERY SELECT _brand.id, _brand.company_id, _brand.symbol, _published,
    (_brand.published IS DISTINCT FROM _published), _n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Resting orders only on published instruments.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_require_published_instrument()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('open', 'partial') AND NOT EXISTS (
    SELECT 1 FROM public.brands b WHERE b.symbol = upper(btrim(NEW.symbol)) AND b.published
  ) THEN
    RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_require_published ON public.orders;
CREATE TRIGGER trg_orders_require_published BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_require_published_instrument();

-- ---------------------------------------------------------------------------
-- 4) Published => usable reference price.
-- ---------------------------------------------------------------------------
DO $$
DECLARE s text;
BEGIN
  FOR s IN
    SELECT b.symbol FROM public.brands b
     WHERE b.published AND NOT (b.reference_price > 0 AND b.reference_price <= 1000000000)
     ORDER BY b.symbol
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('match:' || s));
    UPDATE public.brands b SET published = false WHERE b.symbol = s;
    PERFORM public.close_instrument_orders(s, 'delisted', NULL);
  END LOOP;
END $$;

ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_published_reference_price;
ALTER TABLE public.brands ADD CONSTRAINT brands_published_reference_price
  CHECK (NOT published OR (reference_price > 0 AND reference_price <= 1000000000));

-- ---------------------------------------------------------------------------
-- EXECUTE allow list (pattern of 20260924100600_function_execute_audit.sql).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    'public.close_instrument_orders(text, text, uuid)',
    'public.set_instrument_published(text, boolean, uuid)',
    'public.orders_require_published_instrument()'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;


-- ============================================================================
-- >>> 20260925100200_delist_demo_instruments.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Take the seeded demo instruments off the market (phase 2: a truthful
-- market).
--
-- The early builds seeded public.brands with demo listings: real listed
-- issuers (Saudi Aramco 2222, Al Rajhi 1120, STC 7010, SABIC 2010, EMAAR,
-- ADCB, sovereign sukuk KSA-30, ...) and synthetic brands (NOO001, ...),
-- all published with made-up reference prices. Showing real issuers with
-- invented prices is misleading, and synthetic listings are fake data, so
-- the launch market lists only instruments that came through the listing
-- process.
--
-- Criterion: a brand with no source submission (source_submission_id IS
-- NULL) AND no company (company_id IS NULL) is a demo seed. Anything that
-- came from an approved product submission or is attached to a company
-- stays as it is.
--
-- For each such brand, under the engine's per-symbol lock:
--   * published = false (the rows are NOT deleted: symbols, names, history
--     and any holder's position stay intact);
--   * every resting (open/partial) order on it is closed as 'cancelled' with
--     an orders_audit row, action 'delisted' (close_instrument_orders, the
--     same routine the admin unpublish uses).
-- Positions, cash (portfolios / cash_ledger) and trades are not touched.
--
-- A platform admin can republish an instrument later from the admin screen
-- (/admin/investors, setInstrumentPublished -> set_instrument_published),
-- which requires a positive reference price.
--
-- Idempotent: a re-run finds no published demo brand and no resting order
-- on one, and changes nothing.
-- ============================================================================
DO $$
DECLARE
  s text;
BEGIN
  FOR s IN
    SELECT b.symbol
      FROM public.brands b
     WHERE b.source_submission_id IS NULL
       AND b.company_id IS NULL
       AND (b.published
            OR EXISTS (SELECT 1 FROM public.orders o
                        WHERE upper(o.symbol) = b.symbol AND o.status IN ('open', 'partial')))
     ORDER BY b.symbol
  LOOP
    -- Sorted symbol locks, the order deactivate_trader uses.
    PERFORM pg_advisory_xact_lock(hashtext('match:' || s));
    UPDATE public.brands b SET published = false WHERE b.symbol = s AND b.published;
    PERFORM public.close_instrument_orders(s, 'delisted', NULL);
  END LOOP;
END $$;


-- ============================================================================
-- >>> 20260925110000_listing_control_and_public_reads.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Listing control and public reads (phase 2, fixer round 1).
--
--   1) Only set_instrument_published lists or delists an instrument.
--      brands_guard refuses, for every API caller (anon, authenticated
--      including platform admins, service_role), an INSERT of a published
--      brand and any change of brands.published, unless the
--      transaction-local flag app.listing_control is 'on'. Only
--      set_instrument_published sets it (API callers cannot run
--      set_config). Migrations and the SQL editor (no API role) are not
--      affected. So approving a submission, or a direct REST update, can no
--      longer list, relist or delist an instrument, and delisting always
--      closes the resting orders.
--   2) A reference price of 0 means "not set". The column default was 100,
--      a made-up price that the approval path used; it is now 0, so a new
--      instrument cannot be published (INVALID_PRICE) until a platform
--      admin sets its reference price.
--   3) set_instrument_published: publishing also needs a Shariah ruling in
--      force (SHARIAH_RULING_REQUIRED), so every listed instrument carries
--      one; the audit_log row (brand.publish / brand.unpublish) is written
--      in the same transaction as the change and the closed orders.
--   4) product_submissions: approval requires the brand the server created
--      for the submission (source_submission_id, same company), no longer
--      a published one. The server creates it unpublished with no
--      reference price and records the approving reviewer's ruling.
--   5) shariah_decisions reads: anon reads nothing (the public pages use
--      public_shariah_rulings()); signed-in users read the rulings of
--      published instruments only, and never reviewer_id / updated_by;
--      Shariah board members and platform admins read every ruling. The
--      audit-trail policy that compared reviewer_id / updated_by now calls
--      a SECURITY DEFINER helper that answers for the caller only.
--   6) public_candles walks the buckets newest first, one index probe on
--      idx_trades_symbol_time per bucket, and aggregates only the trades
--      inside the buckets it returns, instead of grouping the symbol's whole
--      trade history on every call. Same signature, same results.
--
-- Data clean-up of existing rows is in the next migration
-- (20260925110100_unlist_unconfirmed_instruments.sql).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) brands_guard: published changes only through set_instrument_published.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brands_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- PostgREST switches every request to one of these roles; migrations and
  -- the SQL editor run as the owner with no role set.
  _api boolean := COALESCE(current_setting('role', true), 'none') IN ('anon', 'authenticated', 'service_role');
BEGIN
  -- Symbols are stored upper-case (Shariah rulings and orders match on them).
  IF TG_OP = 'INSERT' THEN
    NEW.symbol := upper(btrim(NEW.symbol));
    -- A new instrument starts off the market; set_instrument_published
    -- lists it once it has a reference price and a ruling.
    IF _api AND NEW.published THEN
      RAISE EXCEPTION 'FORBIDDEN_BRAND_FIELD';
    END IF;
    RETURN NEW;
  END IF;
  -- Listing and delisting: set_instrument_published only (it closes the
  -- resting orders and writes the audit row in the same transaction).
  IF _api AND NEW.published IS DISTINCT FROM OLD.published
     AND COALESCE(current_setting('app.listing_control', true), '') <> 'on' THEN
    RAISE EXCEPTION 'FORBIDDEN_BRAND_FIELD';
  END IF;
  -- No end-user identity: service role (server) or a migration.
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'platform_admin') THEN
    IF NEW.symbol IS DISTINCT FROM OLD.symbol THEN
      NEW.symbol := upper(btrim(NEW.symbol));
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.symbol IS DISTINCT FROM OLD.symbol
     OR NEW.slug IS DISTINCT FROM OLD.slug
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.published IS DISTINCT FROM OLD.published
     OR NEW.reference_price IS DISTINCT FROM OLD.reference_price
     OR NEW.asset_class IS DISTINCT FROM OLD.asset_class
     OR NEW.source_submission_id IS DISTINCT FROM OLD.source_submission_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'FORBIDDEN_BRAND_FIELD';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) No made-up default reference price.
-- ---------------------------------------------------------------------------
ALTER TABLE public.brands ALTER COLUMN reference_price SET DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3) Publish / unpublish: ruling required, audited atomically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_instrument_published(_symbol text, _published boolean, _actor_id uuid)
RETURNS TABLE(brand_id uuid, company_id uuid, symbol text, published boolean, changed boolean, cancelled_orders integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sym text := upper(btrim(COALESCE(_symbol, '')));
  _brand public.brands;
  _n integer := 0;
  _changed boolean;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;
  IF _published IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF _sym !~ '^[A-Z0-9._-]{1,32}$' THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- Symbol lock first (as every order path), then the rows.
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

  SELECT * INTO _brand FROM public.brands b WHERE b.symbol = _sym FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  IF _published THEN
    -- The reference price anchors the band; 0 means no admin has set one.
    IF NOT (_brand.reference_price > 0 AND _brand.reference_price <= 1000000000) THEN
      RAISE EXCEPTION 'INVALID_PRICE';
    END IF;
    -- Every listed instrument carries a ruling in force.
    IF public.current_shariah_status(_brand.symbol) IS NULL THEN
      RAISE EXCEPTION 'SHARIAH_RULING_REQUIRED';
    END IF;
  END IF;

  _changed := _brand.published IS DISTINCT FROM _published;
  IF _changed THEN
    PERFORM set_config('app.listing_control', 'on', true);
    UPDATE public.brands b SET published = _published WHERE b.id = _brand.id;
    PERFORM set_config('app.listing_control', 'off', true);
  END IF;

  IF NOT _published THEN
    _n := public.close_instrument_orders(_brand.symbol, 'delisted', _actor_id);
  END IF;

  INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
  VALUES (
    _actor_id, _brand.company_id,
    CASE WHEN _published THEN 'brand.publish' ELSE 'brand.unpublish' END,
    'brands', _brand.id::text,
    jsonb_build_object('symbol', _brand.symbol, 'changed', _changed, 'cancelledOrders', _n)
  );

  RETURN QUERY SELECT _brand.id, _brand.company_id, _brand.symbol, _published, _changed, _n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) product_submissions: approval needs the submission's brand (created
--    unpublished by the server), not a published one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.reviewer_id := NULL;
    NEW.review_reason := NULL;
    NEW.reviewed_at := NULL;
    NEW.submitted_at := now();
    NEW.created_at := now();
    NEW.updated_at := now();
    IF auth.uid() IS NOT NULL THEN
      NEW.submitted_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    -- A decision is final for API users; only a pending submission changes.
    IF OLD.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'SUBMISSION_NOT_PENDING';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'SUBMISSION_NOT_PENDING';
      END IF;
      -- Approval: the server has created the submission's instrument
      -- first (off the market; a platform admin lists it later).
      IF NEW.status = 'approved' AND NOT EXISTS (
        SELECT 1 FROM public.brands b
         WHERE b.source_submission_id = NEW.id AND b.company_id = NEW.company_id
      ) THEN
        RAISE EXCEPTION 'BRAND_NOT_LISTED';
      END IF;
      NEW.reviewed_at := now();
    ELSE
      NEW.reviewed_at := OLD.reviewed_at;
    END IF;
    NEW.reviewer_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) shariah_decisions reads.
-- ---------------------------------------------------------------------------
-- True when the caller recorded or last changed the decision. Answers for
-- auth.uid() only, so it reveals nothing about other users.
CREATE OR REPLACE FUNCTION public.shariah_decision_is_mine(_decision_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.shariah_decisions d
     WHERE d.id = _decision_id
       AND (d.reviewer_id = auth.uid() OR d.updated_by = auth.uid())
  );
$$;

DO $$
BEGIN
  IF to_regclass('public.shariah_decisions') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.shariah_decisions FROM anon;
    -- Table-level SELECT goes (with it every column grant), then the
    -- public columns come back: never reviewer_id / updated_by.
    REVOKE SELECT ON TABLE public.shariah_decisions FROM authenticated;
    GRANT SELECT (id, symbol, status, reason, created_at, updated_at, effective_at)
      ON public.shariah_decisions TO authenticated;

    DROP POLICY IF EXISTS "shariah_read_all" ON public.shariah_decisions;
    DROP POLICY IF EXISTS "shariah_read_published_or_reviewer" ON public.shariah_decisions;
    CREATE POLICY "shariah_read_published_or_reviewer" ON public.shariah_decisions
      FOR SELECT TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.brands b WHERE b.symbol = shariah_decisions.symbol AND b.published)
        OR public.has_role(auth.uid(), 'shariah_board')
        OR public.has_role(auth.uid(), 'platform_admin')
      );
  END IF;

  IF to_regclass('public.shariah_decision_audit') IS NOT NULL THEN
    DROP POLICY IF EXISTS "audit_read_scoped_shariah_board" ON public.shariah_decision_audit;
    CREATE POLICY "audit_read_scoped_shariah_board" ON public.shariah_decision_audit
      FOR SELECT TO authenticated
      USING (
        public.has_role(auth.uid(), 'shariah_board')
        AND (changed_by = auth.uid() OR public.shariah_decision_is_mine(decision_id))
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Candles without a full-history scan.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_candles(_symbol text, _interval text DEFAULT '1d', _limit integer DEFAULT 200)
RETURNS TABLE (
  bucket_start timestamptz,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  close_price numeric,
  volume_units numeric,
  trade_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE target AS (
    SELECT b.symbol,
           -- Asia/Riyadh has no DST: a trading day is exactly 24 hours.
           CASE WHEN _interval = '1h' THEN interval '1 hour' ELSE interval '24 hours' END AS step,
           LEAST(GREATEST(COALESCE(_limit, 200), 1), 500) AS cap
      FROM public.brands b
     WHERE b.published
       AND _interval IN ('1h', '1d')
       AND char_length(btrim(COALESCE(_symbol, ''))) BETWEEN 1 AND 64
       AND b.symbol = upper(btrim(_symbol))
  ), buckets AS (
    -- The newest bucket that has a trade, then each older one: one probe
    -- of idx_trades_symbol_time per bucket, at most `cap` buckets.
    SELECT nb.bucket, 1 AS n
      FROM target
      CROSS JOIN LATERAL (
        SELECT t.created_at FROM public.trades t
         WHERE t.symbol = target.symbol
         ORDER BY t.created_at DESC
         LIMIT 1
      ) latest
      CROSS JOIN LATERAL (
        SELECT CASE WHEN _interval = '1h'
                    THEN date_trunc('hour', latest.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                    ELSE date_trunc('day', latest.created_at AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'
               END AS bucket
      ) nb
    UNION ALL
    SELECT nb.bucket, bk.n + 1
      FROM buckets bk
      CROSS JOIN target
      CROSS JOIN LATERAL (
        SELECT t.created_at FROM public.trades t
         WHERE t.symbol = target.symbol AND t.created_at < bk.bucket
         ORDER BY t.created_at DESC
         LIMIT 1
      ) prev
      CROSS JOIN LATERAL (
        SELECT CASE WHEN _interval = '1h'
                    THEN date_trunc('hour', prev.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                    ELSE date_trunc('day', prev.created_at AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'
               END AS bucket
      ) nb
     WHERE bk.n < target.cap
  )
  SELECT bk.bucket, a.open_price, a.high_price, a.low_price, a.close_price, a.volume_units, a.trade_count
    FROM buckets bk
    CROSS JOIN target
    CROSS JOIN LATERAL (
      -- Only the trades of this bucket (index range scan).
      SELECT (array_agg(t.price ORDER BY t.created_at ASC, t.id ASC))[1] AS open_price,
             max(t.price) AS high_price,
             min(t.price) AS low_price,
             (array_agg(t.price ORDER BY t.created_at DESC, t.id DESC))[1] AS close_price,
             sum(t.qty) AS volume_units,
             count(*) AS trade_count
        FROM public.trades t
       WHERE t.symbol = target.symbol
         AND t.created_at >= bk.bucket
         AND t.created_at < bk.bucket + target.step
    ) a
   ORDER BY bk.bucket ASC;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE allow list (pattern of 20260924100600_function_execute_audit.sql).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    'public.brands_guard()',
    'public.product_submissions_guard()',
    'public.set_instrument_published(text, boolean, uuid)'
  ];
  signed_in text[] := ARRAY[
    'public.shariah_decision_is_mine(uuid)'
  ];
  public_read text[] := ARRAY[
    'public.public_candles(text, text, integer)'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only || signed_in || public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY signed_in || public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
  FOREACH fn IN ARRAY public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', fn);
  END LOOP;
END $$;


-- ============================================================================
-- >>> 20260925110100_unlist_unconfirmed_instruments.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Only confirmed listings stay on the market (phase 2, fixer round 1).
--
-- Before phase 2, approving a product submission published the instrument
-- straight away: new symbols got the old column default of 100 as their
-- reference price, and approving a submission for a seeded symbol kept the
-- seed's invented price (and attached the seed to the company, so the demo
-- delisting migration does not recognise it). The seeded demo instruments,
-- now off the market, still carry invented prices that one click would
-- republish. A price "set by a platform admin" is one whose most recent
-- audit_log row (action 'brand.reference_price', written by the admin
-- screen) has the instrument's current price as its new value.
--
--   a) No Shariah ruling is created here. (An earlier draft of this
--      migration, never applied to production, recorded a 'halal' ruling in
--      the approving reviewer's name for every legacy approval that had
--      none. Nobody recorded those rulings, and a legacy approval may be a
--      test approval of a real issuer, so they are not invented.) A legacy
--      approval without a ruling therefore leaves the market under (b): a
--      Shariah reviewer rules on it from the review console (which lists
--      unpublished instruments too) and a platform admin lists it again.
--   b) A published instrument whose reference price no platform admin set,
--      or that has no Shariah ruling in force, is taken off the market
--      under the engine's per-symbol lock; its resting orders are closed
--      ('cancelled', orders_audit 'delisted'), exactly as an admin
--      unpublish does. Positions, cash and trades are not touched.
--   c) An instrument off the market whose reference price no platform
--      admin set gets reference_price 0 ("not set"): publishing it then
--      needs a real price from the admin screen first (INVALID_PRICE).
--
-- Idempotent: a second run finds nothing to change.
-- ============================================================================

-- b) and c)
DO $$
DECLARE
  s text;
BEGIN
  CREATE TEMP TABLE _admin_priced ON COMMIT DROP AS
  SELECT b.id
    FROM public.brands b
    CROSS JOIN LATERAL (
      SELECT a.metadata->>'to' AS to_price
        FROM public.audit_log a
       WHERE a.action = 'brand.reference_price' AND a.entity = 'brands' AND a.entity_id = b.id::text
       ORDER BY a.created_at DESC
       LIMIT 1
    ) last_set
   WHERE CASE WHEN last_set.to_price ~ '^[0-9]{1,10}(\.[0-9]{1,8})?$'
              THEN last_set.to_price::numeric = b.reference_price
              ELSE false END;

  FOR s IN
    SELECT b.symbol
      FROM public.brands b
     WHERE b.published
       AND (NOT EXISTS (SELECT 1 FROM _admin_priced p WHERE p.id = b.id)
            OR public.current_shariah_status(b.symbol) IS NULL)
     ORDER BY b.symbol
  LOOP
    -- Sorted symbol locks, the order deactivate_trader uses.
    PERFORM pg_advisory_xact_lock(hashtext('match:' || s));
    UPDATE public.brands b SET published = false WHERE b.symbol = s AND b.published;
    PERFORM public.close_instrument_orders(s, 'delisted', NULL);
  END LOOP;

  UPDATE public.brands b
     SET reference_price = 0
   WHERE NOT b.published
     AND b.reference_price <> 0
     AND NOT EXISTS (SELECT 1 FROM _admin_priced p WHERE p.id = b.id);
END $$;


-- ============================================================================
-- >>> 20260926100000_invitation_lifecycle.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
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

-- Addresses are stored lower-case and trimmed (the server matches them
-- exactly). A pending row whose trimmed address collides with another
-- pending invitation of the same company could never be accepted (its
-- address matched no account): it is marked expired instead.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT ci.id FROM public.company_invitations ci WHERE ci.email <> lower(btrim(ci.email)) LOOP
    BEGIN
      UPDATE public.company_invitations SET email = lower(btrim(email)) WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.company_invitations SET status = 'expired', email = lower(btrim(email)) WHERE id = r.id;
    END;
  END LOOP;
END $$;

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
  IF account_email IS NULL OR account_email <> caller_email THEN
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

-- ---------------------------------------------------------------------------
-- EXECUTE privileges, set here as well as in 20260926100200 so there is no
-- window (between the two files) in which Supabase's default privileges
-- would let anon/authenticated call a function that trusts _actor_id.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.company_invitations_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_has_member_email(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_company_invitation(uuid, text, public.company_role, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_company_invitation(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_company_invitation(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invitation_preview(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_companies_public(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_company_by_slug_public(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_invitations_guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.company_has_member_email(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_company_invitation(uuid, text, public.company_role, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_company_invitation(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_company_invitation(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.invitation_preview(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_companies_public(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_company_by_slug_public(text) TO service_role;


-- ============================================================================
-- >>> 20260926100100_investor_access_requests.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
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
--    Accounts holding the trader role are never listed. on_hold flags an
--    unresolved launch review hold (activating resolves it, so the admin
--    reviews those accounts in the investor panel first).
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
  pending_company_invitations integer,
  on_hold boolean
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
           WHERE lower(ci.email) = r.addr AND ci.status = 'pending' AND ci.expires_at > now()),
         (r.uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.launch_review_holds h
                                         WHERE h.user_id = r.uid AND h.resolved_at IS NULL))
    FROM cand r
   ORDER BY COALESCE(r.rat, r.u_created) DESC NULLS LAST, r.addr
   LIMIT GREATEST(1, LEAST(COALESCE(_limit, 200), 500));
END;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE privileges (also in 20260926100200): service_role only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.access_request_reference() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_access_request_status_ref(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_access_request(uuid, uuid, public.company_role, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_pending_activations(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.access_request_reference() TO service_role;
GRANT EXECUTE ON FUNCTION public.check_access_request_status_ref(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_access_request(uuid, uuid, public.company_role, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_pending_activations(uuid, integer) TO service_role;


-- ============================================================================
-- >>> 20260926100200_onboarding_execute_allowlist.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
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


-- ============================================================================
-- >>> 20260926100300_company_members_invitation_only.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
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


-- ============================================================================
-- >>> 20260926100500_exact_cost_basis.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Exact cost basis for positions (phase 3, money correctness M1/M2).
--
-- Until now a position kept only avg_price numeric(18,4) and every buy
-- rebuilt the average from the ROUNDED stored average, so the cost implied
-- by the position (qty * avg_price) drifted from the cash actually paid:
-- buying 100,000 @ 10.01 then 200,000 @ 10.00 costs 3,001,000.00 in the
-- ledger, but qty * avg_price (avg 10.0033) says 3,000,990.00.
--
--   1) positions.cost_basis numeric(24,2): the exact cost, in cents, of the
--      units held (average-cost method). avg_price is now derived from it
--      (round(cost_basis / qty, 4)) and is for display only.
--   2) apply_trade_position (same signature) maintains it:
--        buy : cost_basis += round(qty * price, 2)   (= the ledger debit)
--        sell: cost_basis -= round(cost_basis * sold / held, 2)
--              (pro rata of the remaining cost, rounded half away from
--              zero on the cent; selling the whole position removes the
--              whole remaining cost). src/lib/trading/realized.ts replays
--              the same arithmetic, so for any history
--                realized P/L + (market value - cost_basis)
--                  = sell proceeds - buy costs + market value
--              to the cent.
--   3) Existing rows: replayed exactly from unit_issuances + trades when that
--      history explains the position's quantity; otherwise (pre-engine
--      fills) round(qty * avg_price, 2), never negative.
--   4) unit_issuances.created_at is stamped with clock_timestamp() at insert
--      when it takes the column default (issue_units inserts the row after
--      applying the position, under the user and symbol locks; trades are
--      already stamped with clock_timestamp()), so ordering issuances and
--      trades by time replays them in the order the engine applied them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Exact money helpers (pure, IMMUTABLE). Amounts carry at most 2 decimals,
-- quantities at most 4 (positions.qty is numeric(18,4)); both are scaled to
-- integers so the division is exact before the single rounding step.
-- ---------------------------------------------------------------------------

-- round(_amount * _part / _whole, 2), half away from zero, computed exactly.
CREATE OR REPLACE FUNCTION public.money_prorata(_amount numeric, _part numeric, _whole numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  a numeric := round(_amount * 100);     -- cents
  p numeric := round(_part * 10000);     -- 1/10000 units
  w numeric := round(_whole * 10000);
  n numeric;
  q numeric;
BEGIN
  IF _amount IS NULL OR _part IS NULL OR _whole IS NULL OR w = 0 THEN
    RETURN NULL;
  END IF;
  n := a * p;
  -- |n / w| rounded half away from zero: floor((2|n| + |w|) / (2|w|)).
  q := div(2 * abs(n) + abs(w), 2 * abs(w));
  IF sign(n) * sign(w) < 0 THEN q := -q; END IF;
  RETURN round(q / 100, 2);
END;
$$;
REVOKE ALL ON FUNCTION public.money_prorata(numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.money_prorata(numeric, numeric, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 1) positions.cost_basis
-- ---------------------------------------------------------------------------
ALTER TABLE public.positions ADD COLUMN IF NOT EXISTS cost_basis numeric(24,2);

COMMENT ON COLUMN public.positions.cost_basis IS
  'Exact cost of the units held (average-cost method), in the trading currency, to the cent. Buys add round(qty*price,2); sells remove round(cost_basis*sold/held,2); avg_price = round(cost_basis/qty,4) is derived from it.';

-- 3) Backfill existing rows (only rows not filled yet, so re-running is a
-- no-op).
DO $$
DECLARE
  pos record;
  ev record;
  q numeric;
  c numeric;
  ok boolean;
BEGIN
  FOR pos IN
    SELECT p.id, p.user_id, upper(p.symbol) AS symbol, p.qty, p.avg_price
      FROM public.positions p
     WHERE p.cost_basis IS NULL
  LOOP
    q := 0; c := 0; ok := true;
    FOR ev IN
      SELECT e.side, e.qty, e.price
        FROM (
          SELECT i.created_at, 0 AS rank, i.id, 'buy'::text AS side, i.qty, i.price
            FROM public.unit_issuances i
           WHERE i.user_id = pos.user_id AND i.symbol = pos.symbol
          UNION ALL
          SELECT t.created_at, 1, t.id, 'buy', t.qty, t.price
            FROM public.trades t
           WHERE t.buyer_id = pos.user_id AND t.symbol = pos.symbol
          UNION ALL
          SELECT t.created_at, 2, t.id, 'sell', t.qty, t.price
            FROM public.trades t
           WHERE t.seller_id = pos.user_id AND t.symbol = pos.symbol
        ) e
       ORDER BY e.created_at, e.rank, e.id
    LOOP
      IF ev.qty IS NULL OR ev.price IS NULL OR ev.qty <= 0 OR ev.price <= 0 THEN
        ok := false; EXIT;
      END IF;
      IF ev.side = 'buy' THEN
        q := q + ev.qty;
        c := c + round(ev.qty * ev.price, 2);
      ELSE
        IF ev.qty > q THEN ok := false; EXIT; END IF;
        IF ev.qty = q THEN
          c := 0;
        ELSE
          c := c - public.money_prorata(c, ev.qty, q);
        END IF;
        q := q - ev.qty;
      END IF;
    END LOOP;

    IF ok AND q = pos.qty AND q > 0 THEN
      UPDATE public.positions SET cost_basis = c WHERE id = pos.id;
    ELSE
      UPDATE public.positions
         SET cost_basis = GREATEST(round(COALESCE(pos.qty, 0) * COALESCE(pos.avg_price, 0), 2), 0)
       WHERE id = pos.id;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.positions ALTER COLUMN cost_basis SET NOT NULL;
ALTER TABLE public.positions DROP CONSTRAINT IF EXISTS positions_cost_basis_nonnegative;
ALTER TABLE public.positions ADD CONSTRAINT positions_cost_basis_nonnegative CHECK (cost_basis >= 0);

-- A row inserted without a cost basis (fixtures, manual repairs by the
-- owner) gets qty * avg_price, like the legacy backfill.
CREATE OR REPLACE FUNCTION public.positions_cost_basis_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.cost_basis IS NULL THEN
    NEW.cost_basis := GREATEST(round(COALESCE(NEW.qty, 0) * COALESCE(NEW.avg_price, 0), 2), 0);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.positions_cost_basis_default() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_positions_cost_basis_default ON public.positions;
CREATE TRIGGER trg_positions_cost_basis_default BEFORE INSERT ON public.positions
  FOR EACH ROW EXECUTE FUNCTION public.positions_cost_basis_default();

-- ---------------------------------------------------------------------------
-- 2) apply_trade_position: same signature and callers (match_order,
--    issue_units); maintains cost_basis exactly and derives avg_price.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_trade_position(
  _user_id uuid, _symbol text, _asset_class text, _side text, _qty numeric, _price numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur_qty numeric;
  cur_cost numeric;
  new_qty numeric;
  new_cost numeric;
BEGIN
  IF _qty IS NULL OR _qty = 'NaN'::numeric OR _qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  IF _price IS NULL OR _price = 'NaN'::numeric OR _price <= 0 THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;

  SELECT p.qty, p.cost_basis INTO cur_qty, cur_cost
    FROM public.positions p
   WHERE p.user_id = _user_id AND p.symbol = _symbol
     FOR UPDATE;
  cur_qty := COALESCE(cur_qty, 0);
  cur_cost := COALESCE(cur_cost, 0);

  IF _side = 'buy' THEN
    new_qty := cur_qty + _qty;
    -- Exactly what the ledger debits for this fill.
    new_cost := cur_cost + round(_qty * _price, 2);
  ELSIF _side = 'sell' THEN
    new_qty := cur_qty - _qty;
    IF new_qty < 0 THEN RAISE EXCEPTION 'INSUFFICIENT_QTY'; END IF;
    IF new_qty = 0 THEN
      new_cost := 0;
    ELSE
      new_cost := cur_cost - public.money_prorata(cur_cost, _qty, cur_qty);
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_SIDE';
  END IF;

  IF new_qty = 0 THEN
    DELETE FROM public.positions p WHERE p.user_id = _user_id AND p.symbol = _symbol;
  ELSE
    INSERT INTO public.positions (user_id, symbol, asset_class, qty, avg_price, cost_basis)
    VALUES (_user_id, _symbol, _asset_class, new_qty, round(new_cost / new_qty, 4), new_cost)
    ON CONFLICT (user_id, symbol)
    DO UPDATE SET qty = EXCLUDED.qty,
                  avg_price = EXCLUDED.avg_price,
                  cost_basis = EXCLUDED.cost_basis,
                  updated_at = now();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_trade_position(uuid, text, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_trade_position(uuid, text, text, text, numeric, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Issuance time = the moment the units were credited.
-- ---------------------------------------------------------------------------
-- Only a row that takes the column default (now(), the transaction start)
-- is re-stamped; a row inserted with an explicit historical time (e.g. the
-- owner restoring the go-live archive) keeps it.
CREATE OR REPLACE FUNCTION public.unit_issuances_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.created_at IS NULL OR NEW.created_at = now() THEN
    NEW.created_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.unit_issuances_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_unit_issuances_stamp ON public.unit_issuances;
CREATE TRIGGER trg_unit_issuances_stamp BEFORE INSERT ON public.unit_issuances
  FOR EACH ROW EXECUTE FUNCTION public.unit_issuances_stamp();


-- ============================================================================
-- >>> 20260926100600_engine_money_fixes.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Engine money fixes (phase 3, M3, M4, L1).
--
--   1) open_buy_reserve(user) / buying_power(user): one definition of the
--      cash an investor's resting buy orders promise, used by match_order,
--      post_cash_movement and the server (trade page, portfolio, account
--      status). buying_power = cash_balance - open buy reserve, floored to
--      the cent: the largest amount a new buy can commit.
--   2) match_order: a market order is measured at the band edge ON THE TICK
--      (_high_tick / _low_tick) everywhere: the cash reserved for a market
--      buy (qty * _high_tick, the worst price it can fill at), the
--      5,000,000 size check, the self-trade check and the candidates it may
--      cross. Before, the unrounded band edge (ref * 1.2) was used, which
--      over-reserved when it was off the tick (ref 10.01: 12.012 instead of
--      12.01).
--   3) orders.filled_notional: the exact sum of an order's fill amounts.
--      A resting order's filled_price is now filled_notional / filled_qty
--      (rounded once to 4 decimals) instead of a running average of an
--      already rounded average, which drifted in the 4th decimal.
--   4) post_cash_movement: the sign is enforced per kind in SQL (deposit
--      > 0, withdrawal < 0, adjustment non-zero, order_buy < 0,
--      order_sell > 0) and a withdrawal or negative adjustment cannot take
--      the balance below what the investor's resting buy orders reserve
--      (CASH_RESERVED): otherwise the book would show bids the investor can
--      no longer pay for. It takes the engine's per-user lock first, so it
--      is serialized with that investor's order placements.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Reserve and buying power.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_buy_reserve(_user_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(sum((o.qty - o.filled_qty) * o.price), 0)
    FROM public.orders o
   WHERE o.user_id = _user_id
     AND o.side = 'buy'
     AND o.status IN ('open', 'partial')
     AND o.price IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.open_buy_reserve(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_buy_reserve(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.buying_power(_user_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT round(floor((COALESCE((SELECT p.cash_balance FROM public.portfolios p WHERE p.user_id = _user_id), 0)
                      - public.open_buy_reserve(_user_id)) * 100) / 100, 2);
$$;
REVOKE ALL ON FUNCTION public.buying_power(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buying_power(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) orders.filled_notional, backfilled from the executions.
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS filled_notional numeric(24,2);

COMMENT ON COLUMN public.orders.filled_notional IS
  'Sum of round(qty*price,2) over the order''s executions (what the ledger moved for it). filled_price = round(filled_notional / filled_qty, 4).';

DO $$
BEGIN
  -- Orders whose fills are all recorded as trades: exact.
  WITH fills AS (
    SELECT x.order_id, sum(x.qty) AS qty, sum(round(x.qty * x.price, 2)) AS notional
      FROM (
        SELECT t.buy_order_id AS order_id, t.qty, t.price FROM public.trades t WHERE t.buy_order_id IS NOT NULL
        UNION ALL
        SELECT t.sell_order_id, t.qty, t.price FROM public.trades t WHERE t.sell_order_id IS NOT NULL
      ) x
     GROUP BY x.order_id
  )
  UPDATE public.orders o
     SET filled_notional = f.notional
    FROM fills f
   WHERE f.order_id = o.id
     AND o.filled_notional IS NULL
     AND f.qty = COALESCE(o.filled_qty, 0);

  -- Pre-engine fills (no trade rows) and anything inconsistent: from the
  -- recorded average.
  UPDATE public.orders o
     SET filled_notional = round(COALESCE(o.filled_qty, 0) * COALESCE(o.filled_price, 0), 2)
   WHERE o.filled_notional IS NULL
     AND COALESCE(o.filled_qty, 0) > 0
     AND o.filled_price IS NOT NULL
     AND o.filled_price <> 'NaN'::numeric
     AND o.filled_qty <> 'NaN'::numeric;

  UPDATE public.orders o SET filled_notional = 0 WHERE o.filled_notional IS NULL;
END $$;

ALTER TABLE public.orders ALTER COLUMN filled_notional SET DEFAULT 0;
ALTER TABLE public.orders ALTER COLUMN filled_notional SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Matching engine. Same signature and result columns; changes are
--    marked "phase 3".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_order(
  _user_id uuid, _symbol text, _asset_class text, _side text, _type text,
  _qty numeric, _limit_price numeric DEFAULT NULL
) RETURNS TABLE(order_id uuid, filled_qty numeric, avg_price numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  c_max_qty constant numeric := 10000000;
  c_max_notional constant numeric := 5000000;
  c_band constant numeric := 0.2;
  _brand public.brands;
  _opposite text;
  _price numeric;
  _ref numeric;
  _low numeric;
  _high numeric;
  _low_tick numeric;
  _high_tick numeric;
  _order_notional numeric;
  _cash numeric;
  _held numeric;
  _open numeric;
  _parties uuid[];
  my_order public.orders;
  cand public.orders;
  remaining numeric;
  trade_qty numeric;
  trade_price numeric;
  notional numeric;
  total_qty numeric := 0;
  total_cost numeric := 0;
  buyer uuid;
  seller uuid;
  buyer_cash numeric;
  seller_qty numeric;
  final_status text;
BEGIN
  -- Input validation (K1).
  IF _side IS NULL OR _side NOT IN ('buy', 'sell') THEN RAISE EXCEPTION 'INVALID_SIDE'; END IF;
  IF _type IS NULL OR _type NOT IN ('limit', 'market') THEN RAISE EXCEPTION 'INVALID_TYPE'; END IF;
  IF _qty IS NULL OR _qty = 'NaN'::numeric OR _qty <= 0 OR _qty > c_max_qty OR _qty <> trunc(_qty) THEN
    RAISE EXCEPTION 'INVALID_QTY';
  END IF;
  IF _type = 'limit' THEN
    IF _limit_price IS NULL OR _limit_price = 'NaN'::numeric OR _limit_price <= 0
       OR _limit_price > 1000000000 OR _limit_price <> round(_limit_price, 2) THEN
      RAISE EXCEPTION 'INVALID_PRICE';
    END IF;
    _price := _limit_price;
  ELSE
    _price := NULL;
  END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN_TRADER_REQUIRED'; END IF;

  -- One order path per trader at a time (placement, modify, restore,
  -- deactivation, withdrawals), taken before the symbol lock everywhere:
  -- the buying-power and holdings checks below then see the trader's other
  -- orders and cash movements.
  PERFORM pg_advisory_xact_lock(4242, hashtext(_user_id::text));

  IF NOT public.has_role(_user_id, 'trader') THEN
    RAISE EXCEPTION 'FORBIDDEN_TRADER_REQUIRED';
  END IF;

  SELECT * INTO _brand FROM public.brands b WHERE b.symbol = _symbol AND b.published;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- One matcher per symbol at a time (shared with cancel/replace/restore and
  -- the Shariah trigger).
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _brand.symbol));

  IF public.current_shariah_status(_brand.symbol) = 'non_halal' AND _side = 'buy' THEN
    RAISE EXCEPTION 'SHARIAH_BLOCKED';
  END IF;

  -- Reference price (previous close, else the listing reference) and the
  -- protection band. Trades of the current day do not move it.
  _ref := public.band_reference_price(_brand.symbol);
  IF _ref IS NULL OR _ref <= 0 THEN RAISE EXCEPTION 'PRICE_OUT_OF_BAND'; END IF;
  _low := _ref * (1 - c_band);
  _high := _ref * (1 + c_band);
  -- Band edges on the 0.01 tick, inside the band.
  _low_tick := ceil(_low * 100) / 100;
  _high_tick := floor(_high * 100) / 100;
  -- phase 3: a band with no valid tick cannot trade.
  IF _high_tick <= 0 OR _high_tick < _low_tick THEN RAISE EXCEPTION 'PRICE_OUT_OF_BAND'; END IF;
  IF _type = 'limit' AND (_price < _low OR _price > _high) THEN
    RAISE EXCEPTION 'PRICE_OUT_OF_BAND';
  END IF;

  -- Size limit and cash reserve: a market order is measured at the top of
  -- the band on the tick (phase 3), the worst price a market buy can fill
  -- at; a limit order at its limit.
  _order_notional := _qty * COALESCE(_price, _high_tick);
  IF _order_notional > c_max_notional THEN RAISE EXCEPTION 'ORDER_TOO_LARGE'; END IF;

  _opposite := CASE WHEN _side = 'buy' THEN 'sell' ELSE 'buy' END;

  -- Self-trade prevention: an order that would cross the trader's own
  -- resting order is refused (it would otherwise rest on a crossed book).
  IF EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.user_id = _user_id AND o.symbol = _brand.symbol AND o.side = _opposite
       AND o.status IN ('open', 'partial') AND o.price IS NOT NULL AND o.qty > o.filled_qty
       AND ((_side = 'buy' AND o.price <= COALESCE(_price, _high_tick))
         OR (_side = 'sell' AND o.price >= COALESCE(_price, _low_tick)))
  ) THEN
    RAISE EXCEPTION 'SELF_TRADE';
  END IF;

  -- The trader's own side must be covered, including what their other
  -- resting orders already promise (no spoofed depth).
  INSERT INTO public.portfolios (user_id, cash_balance) VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  IF _side = 'buy' THEN
    SELECT p.cash_balance INTO _cash FROM public.portfolios p WHERE p.user_id = _user_id;
    _open := public.open_buy_reserve(_user_id);
    IF COALESCE(_cash, 0) < _order_notional + _open THEN RAISE EXCEPTION 'INSUFFICIENT_CASH'; END IF;
  ELSE
    SELECT ps.qty INTO _held FROM public.positions ps
     WHERE ps.user_id = _user_id AND ps.symbol = _brand.symbol;
    SELECT COALESCE(sum(o.qty - o.filled_qty), 0) INTO _open
      FROM public.orders o
     WHERE o.user_id = _user_id AND o.symbol = _brand.symbol AND o.side = 'sell'
       AND o.status IN ('open', 'partial');
    IF COALESCE(_held, 0) < _qty + _open THEN RAISE EXCEPTION 'INSUFFICIENT_QTY'; END IF;
  END IF;

  -- Defensive: resting buys on a non_halal symbol must never fill.
  IF public.current_shariah_status(_brand.symbol) = 'non_halal' THEN
    PERFORM public.cancel_shariah_blocked_buys(_brand.symbol, NULL);
  END IF;

  -- created_at is taken after the locks, so time priority follows the real
  -- arrival order.
  INSERT INTO public.orders
    (user_id, symbol, asset_class, side, type, qty, price, status, filled_qty, filled_notional, created_at, updated_at)
  VALUES
    (_user_id, _brand.symbol, _brand.asset_class, _side, _type, _qty, _price, 'open', 0, 0,
     clock_timestamp(), clock_timestamp())
  RETURNING * INTO my_order;

  -- Lock every portfolio this order may touch, in user_id order, before any
  -- cash moves: two matchers on different symbols with overlapping traders
  -- then always lock in the same order and cannot deadlock.
  SELECT array_agg(DISTINCT o.user_id) INTO _parties
    FROM public.orders o
   WHERE o.symbol = _brand.symbol AND o.side = _opposite
     AND o.status IN ('open', 'partial') AND o.user_id <> _user_id
     AND o.price IS NOT NULL AND o.qty > o.filled_qty
     AND ((_side = 'buy' AND o.price <= COALESCE(_price, _high_tick))
       OR (_side = 'sell' AND o.price >= COALESCE(_price, _low_tick)));
  _parties := array_append(COALESCE(_parties, ARRAY[]::uuid[]), _user_id);
  INSERT INTO public.portfolios (user_id, cash_balance)
  SELECT u, 0 FROM unnest(_parties) AS u
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.portfolios p
   WHERE p.user_id = ANY(_parties)
   ORDER BY p.user_id
     FOR UPDATE;

  remaining := _qty;
  FOR cand IN
    SELECT * FROM public.orders o
     WHERE o.symbol = _brand.symbol AND o.side = _opposite
       AND o.status IN ('open', 'partial') AND o.user_id <> _user_id
       AND o.price IS NOT NULL AND o.qty > o.filled_qty
       AND ((_side = 'buy' AND o.price <= COALESCE(_price, _high_tick))
         OR (_side = 'sell' AND o.price >= COALESCE(_price, _low_tick)))
     ORDER BY CASE WHEN _side = 'buy' THEN o.price ELSE -o.price END ASC,
              o.created_at ASC, o.id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;

    -- Legacy rows that break K1 (fractional remaining units, off-tick price)
    -- are taken off the book, never filled.
    IF (cand.qty - cand.filled_qty) <> trunc(cand.qty - cand.filled_qty)
       OR cand.price <> round(cand.price, 2) THEN
      PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_invalid_order', NULL);
      CONTINUE;
    END IF;

    -- An investor whose trading access was withdrawn cannot trade, not even
    -- as the passive side.
    IF NOT public.has_role(cand.user_id, 'trader') THEN
      PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_inactive_trader', NULL);
      CONTINUE;
    END IF;

    trade_qty := LEAST(remaining, cand.qty - cand.filled_qty);
    CONTINUE WHEN trade_qty <= 0;
    -- Resting price, kept inside the band. A resting ask below the band
    -- trades at the band floor, a resting bid above it at the band ceiling:
    -- never worse than the resting order's limit, never outside the band.
    -- Both are on the 0.01 tick; scale 2 keeps trades.price and the ledger
    -- notes readable ('@ 360.00', not the division's 16 decimals).
    trade_price := round(CASE WHEN _side = 'buy' THEN GREATEST(cand.price, _low_tick)
                              ELSE LEAST(cand.price, _high_tick) END, 2);
    -- One rounded amount, debited and credited identically.
    notional := round(trade_qty * trade_price, 2);

    IF _side = 'buy' THEN
      buyer := _user_id; seller := cand.user_id;
    ELSE
      buyer := cand.user_id; seller := _user_id;
    END IF;

    SELECT p.cash_balance INTO buyer_cash FROM public.portfolios p WHERE p.user_id = buyer FOR UPDATE;
    IF COALESCE(buyer_cash, 0) < notional THEN
      IF buyer = cand.user_id THEN
        PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_insufficient_cash', NULL);
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'INSUFFICIENT_CASH';
    END IF;

    SELECT ps.qty INTO seller_qty FROM public.positions ps
     WHERE ps.user_id = seller AND ps.symbol = _brand.symbol FOR UPDATE;
    IF COALESCE(seller_qty, 0) < trade_qty THEN
      IF seller = cand.user_id THEN
        PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_insufficient_qty', NULL);
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'INSUFFICIENT_QTY';
    END IF;

    INSERT INTO public.trades
      (symbol, asset_class, qty, price, buy_order_id, sell_order_id, buyer_id, seller_id, created_at)
    VALUES
      (_brand.symbol, _brand.asset_class, trade_qty, trade_price,
       CASE WHEN _side = 'buy' THEN my_order.id ELSE cand.id END,
       CASE WHEN _side = 'buy' THEN cand.id ELSE my_order.id END,
       buyer, seller, clock_timestamp());

    PERFORM public.apply_trade_position(buyer, _brand.symbol, _brand.asset_class, 'buy', trade_qty, trade_price);
    PERFORM public.apply_trade_position(seller, _brand.symbol, _brand.asset_class, 'sell', trade_qty, trade_price);

    PERFORM public.post_cash_movement(buyer, 'order_buy', -notional,
      CASE WHEN _side = 'buy' THEN my_order.id ELSE cand.id END,
      'buy ' || trade_qty || ' ' || _brand.symbol || ' @ ' || trade_price, buyer);
    PERFORM public.post_cash_movement(seller, 'order_sell', notional,
      CASE WHEN _side = 'buy' THEN cand.id ELSE my_order.id END,
      'sell ' || trade_qty || ' ' || _brand.symbol || ' @ ' || trade_price, seller);

    -- phase 3: filled_price is the resting order's exact average fill
    -- price, from the sum of its fill amounts (no running re-rounding).
    UPDATE public.orders o
       SET filled_qty = cand.filled_qty + trade_qty,
           filled_notional = cand.filled_notional + notional,
           filled_price = round((cand.filled_notional + notional) / (cand.filled_qty + trade_qty), 4),
           status = CASE WHEN cand.filled_qty + trade_qty >= cand.qty THEN 'filled' ELSE 'partial' END,
           filled_at = clock_timestamp(),
           updated_at = clock_timestamp()
     WHERE o.id = cand.id;

    remaining := remaining - trade_qty;
    total_qty := total_qty + trade_qty;
    total_cost := total_cost + notional;
  END LOOP;

  IF remaining <= 0 THEN
    final_status := 'filled';
  ELSIF _type = 'market' THEN
    -- K3: a market order never rests; the unfilled remainder is cancelled.
    final_status := 'cancelled';
  ELSIF total_qty > 0 THEN
    final_status := 'partial';
  ELSE
    final_status := 'open';
  END IF;

  UPDATE public.orders o
     SET filled_qty = total_qty,
         filled_notional = total_cost,
         status = final_status,
         filled_price = CASE WHEN total_qty > 0 THEN round(total_cost / total_qty, 4) ELSE NULL END,
         filled_at = CASE WHEN total_qty > 0 THEN clock_timestamp() ELSE NULL END,
         updated_at = clock_timestamp()
   WHERE o.id = my_order.id;

  IF final_status = 'cancelled' THEN
    INSERT INTO public.orders_audit
      (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by, previous_status, new_status)
    VALUES (my_order.id, 'market_unfilled', _qty, NULL, total_qty, NULL, NULL, 'open', 'cancelled');
  END IF;

  RETURN QUERY SELECT my_order.id, total_qty,
    CASE WHEN total_qty > 0 THEN round(total_cost / total_qty, 4) ELSE NULL::numeric END,
    final_status;
END;
$$;
REVOKE ALL ON FUNCTION public.match_order(uuid, text, text, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_order(uuid, text, text, text, text, numeric, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Cash movements: sign per kind, reserved cash stays.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_cash_movement(
  _user_id uuid,
  _kind text,
  _amount numeric,
  _ref_order_id uuid DEFAULT NULL,
  _note text DEFAULT NULL,
  _actor_id uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _balance numeric;
BEGIN
  IF _kind IS NULL OR _kind NOT IN ('deposit','withdrawal','order_buy','order_sell','adjustment') THEN
    RAISE EXCEPTION 'INVALID_KIND';
  END IF;
  IF _user_id IS NULL OR _amount IS NULL OR _amount = 'NaN'::numeric OR _amount <> round(_amount, 2) THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;
  -- The sign carries the direction; each kind has exactly one.
  IF (_kind IN ('deposit', 'order_sell') AND _amount <= 0)
     OR (_kind IN ('withdrawal', 'order_buy') AND _amount >= 0)
     OR (_kind = 'adjustment' AND _amount = 0) THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  -- Money leaving outside a trade: serialized with the investor's order
  -- placements (same per-user lock as match_order, taken before the row
  -- lock), so the reserve read below cannot miss an order being placed.
  IF _kind IN ('withdrawal', 'adjustment') AND _amount < 0 THEN
    PERFORM pg_advisory_xact_lock(4242, hashtext(_user_id::text));
  END IF;

  INSERT INTO public.portfolios (user_id, cash_balance)
  VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT cash_balance INTO _balance FROM public.portfolios WHERE user_id = _user_id FOR UPDATE;
  IF _balance IS NULL THEN
    RAISE EXCEPTION 'PORTFOLIO_UNAVAILABLE';
  END IF;

  _balance := _balance + _amount;
  IF _balance < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_CASH';
  END IF;

  -- Cash promised to resting buy orders cannot be withdrawn (it would leave
  -- bids on the book the investor can no longer pay for). Trade debits are
  -- exempt: they settle the very orders the reserve belongs to.
  IF _kind IN ('withdrawal', 'adjustment') AND _amount < 0
     AND _balance < public.open_buy_reserve(_user_id) THEN
    RAISE EXCEPTION 'CASH_RESERVED';
  END IF;

  INSERT INTO public.cash_ledger (user_id, kind, amount, balance_after, ref_order_id, note, created_by, created_at)
  VALUES (_user_id, _kind, _amount, _balance, _ref_order_id, _note, COALESCE(_actor_id, _user_id), clock_timestamp());

  UPDATE public.portfolios SET cash_balance = _balance, updated_at = now() WHERE user_id = _user_id;
  RETURN _balance;
END;
$$;
REVOKE ALL ON FUNCTION public.post_cash_movement(uuid, text, numeric, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_cash_movement(uuid, text, numeric, uuid, text, uuid) TO service_role;


-- ============================================================================
-- >>> 20260926100700_reference_price_rules.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Listing reference price rules in the database (phase 3).
--
-- The server validated the reference price, the database did not: a direct
-- update could store an off-tick price (10.005) or one so small that the
-- ±20% band collapses to a single tick (0.01 .. 0.04: ceil(0.8p) = floor(1.2p)
-- on the 0.01 tick, so the price can never move). A reference price is now:
--   * 0, meaning "not set" (only while the instrument is off the market; the
--     brands_published_reference_price CHECK already refuses 0 on a
--     published instrument), or
--   * on the 0.01 tick, at least 0.05 (the smallest price whose band has
--     more than one tick: 0.04 .. 0.06) and at most 1,000,000,000.
-- Checked when the price is set or changed and when an instrument is
-- listed; existing rows are not rewritten (a legacy published row with an
-- invalid price keeps trading until an admin sets a valid one, and cannot
-- be relisted with it). Raises INVALID_PRICE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.brands_reference_price_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- Inline (no helper call): the trigger runs with the privileges of the
  -- caller, e.g. a platform admin through the API.
  _valid boolean := NEW.reference_price IS NOT NULL
                    AND NEW.reference_price <> 'NaN'::numeric
                    AND NEW.reference_price >= 0.05
                    AND NEW.reference_price <= 1000000000
                    AND NEW.reference_price = round(NEW.reference_price, 2);
BEGIN
  -- A new or changed price: 0 (not set) or a valid price.
  IF (TG_OP = 'INSERT' OR NEW.reference_price IS DISTINCT FROM OLD.reference_price)
     AND COALESCE(NEW.reference_price, 0) <> 0
     AND NOT _valid THEN
    RAISE EXCEPTION 'INVALID_PRICE';
  END IF;
  -- Listing (or relisting) needs a valid price. A price of 0 is left to the
  -- brands_published_reference_price CHECK.
  IF NEW.published AND (TG_OP = 'INSERT' OR OLD.published IS DISTINCT FROM true)
     AND COALESCE(NEW.reference_price, 0) <> 0
     AND NOT _valid THEN
    RAISE EXCEPTION 'INVALID_PRICE';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.brands_reference_price_rules() FROM PUBLIC, anon, authenticated;

-- Named after trg_brands_guard, so the authorization check runs first.
DROP TRIGGER IF EXISTS trg_brands_reference_price ON public.brands;
CREATE TRIGGER trg_brands_reference_price BEFORE INSERT OR UPDATE OF reference_price, published ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.brands_reference_price_rules();


-- ============================================================================
-- >>> 20260926100800_portfolio_valuation.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Portfolio valuation read (phase 3, H1).
--
-- portfolio_positions(user): every position of one investor with what the
-- server needs to value it from real data, in one snapshot:
--   * qty, cost_basis (exact, see 20260926100500), avg_price (derived);
--   * reserved_qty: units promised to the investor's resting sell orders
--     (what match_order counts against holdings), so "available to sell"
--     = qty - reserved_qty;
--   * last_price / last_trade_at: the instrument's latest execution, listed
--     or not (the same "last price" as the public market board);
--   * band_reference: band_reference_price() (previous close, else the
--     listing reference price; 0 when an unlisted instrument has none);
--   * published, slug and names of the instrument, when it exists.
-- The server values a position at last_price, else band_reference (shown
-- as a reference price), else not at all (no market price); never at the
-- investor's own average cost.
-- SECURITY DEFINER, EXECUTE service_role only: the server calls it with the
-- verified user id of the caller.
-- ============================================================================

DROP FUNCTION IF EXISTS public.portfolio_positions(uuid);
CREATE FUNCTION public.portfolio_positions(_user_id uuid)
RETURNS TABLE (
  symbol text,
  asset_class text,
  qty numeric,
  cost_basis numeric,
  avg_price numeric,
  reserved_qty numeric,
  last_price numeric,
  last_trade_at timestamptz,
  band_reference numeric,
  published boolean,
  slug text,
  name_ar text,
  name_en text,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.symbol,
         p.asset_class,
         p.qty,
         p.cost_basis,
         p.avg_price,
         COALESCE((SELECT sum(o.qty - o.filled_qty)
                     FROM public.orders o
                    WHERE o.user_id = p.user_id
                      AND o.symbol = p.symbol
                      AND o.side = 'sell'
                      AND o.status IN ('open', 'partial')), 0),
         lt.price,
         lt.created_at,
         COALESCE(public.band_reference_price(p.symbol), 0),
         COALESCE(b.published, false),
         b.slug,
         b.name_ar,
         b.name_en,
         p.updated_at
    FROM public.positions p
    LEFT JOIN public.brands b ON b.symbol = upper(btrim(p.symbol))
    LEFT JOIN LATERAL (
      SELECT t.price, t.created_at
        FROM public.trades t
       WHERE t.symbol = upper(btrim(p.symbol))
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 1
    ) lt ON true
   WHERE p.user_id = _user_id
   ORDER BY p.symbol
   LIMIT 1000;
$$;
REVOKE ALL ON FUNCTION public.portfolio_positions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portfolio_positions(uuid) TO service_role;


-- ============================================================================
-- >>> 20260926100900_money_execute_allowlist.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- EXECUTE privileges for the phase 3 money functions, following the explicit
-- allow-list pattern of 20260924100600_function_execute_audit.sql:
-- Supabase's default privileges grant EXECUTE on every new public function
-- to anon and authenticated, so each one is revoked from PUBLIC, anon and
-- authenticated and granted to service_role only (trigger functions get no
-- grant at all). The server calls them with the verified user id of the
-- caller. Functions that do not exist on a given database are skipped.
-- ============================================================================
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    -- 20260926100500_exact_cost_basis.sql
    'public.money_prorata(numeric, numeric, numeric)',
    'public.apply_trade_position(uuid, text, text, text, numeric, numeric)',
    -- 20260926100600_engine_money_fixes.sql
    'public.open_buy_reserve(uuid)',
    'public.buying_power(uuid)',
    'public.match_order(uuid, text, text, text, text, numeric, numeric)',
    'public.post_cash_movement(uuid, text, numeric, uuid, text, uuid)',
    -- 20260926100800_portfolio_valuation.sql
    'public.portfolio_positions(uuid)'
  ];
  trigger_only text[] := ARRAY[
    'public.positions_cost_basis_default()',
    'public.unit_issuances_stamp()',
    'public.brands_reference_price_rules()'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY trigger_only LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;


-- ============================================================================
-- >>> 20260926101000_submission_lifecycle.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Submission to listing lifecycle, enforced in SQL (phase 3, agent D).
--
-- One path, four states, each transition owned by one role and done by one
-- SECURITY DEFINER function in one transaction:
--
--   pending   --review_submission (Shariah reviewer)-->  approved | rejected
--   approved  --approve_listing   (platform admin)---->  listed
--   approved  --decline_listing   (platform admin)---->  rejected
--
--   * pending:  the company (owner or finance) submitted it; nothing exists
--               on the market.
--   * approved: a Shariah reviewer approved it. In the SAME transaction the
--               instrument is created (or the company's own instrument is
--               updated) OFF the market with no reference price, and the
--               reviewer's 'halal' ruling is recorded, unless a 'halal'
--               ruling is already in force. An existing 'non_halal' or
--               'reviewing' ruling is never overridden silently: the
--               approval is refused (SHARIAH_RULING_CONFLICT) unless the
--               reviewer explicitly replaces it with a written reason.
--   * listed:   a platform admin set a real reference price, listed the
--               instrument (set_instrument_published: ruling + price
--               checks, audit, same transaction) and optionally allocated
--               the first units (issue_units) to a holder. Listing the
--               instrument from the admin listing screen also marks its
--               'approved' submission 'listed' (set_instrument_published).
--   * rejected: by the reviewer (with a reason the company can act on), or
--               by the admin at the listing step (with a reason).
--
-- API callers (anon, authenticated, service_role) can no longer change a
-- submission's status or decision fields directly: UPDATE is revoked from
-- authenticated, the reviewer UPDATE policy is dropped, and the guard
-- trigger refuses any decision change that does not come from these
-- functions (transaction-local flag app.submission_control, which API
-- callers cannot set). Allowed transitions are checked for every caller,
-- migrations included.
--
-- Existing data: an 'approved' submission whose instrument is already
-- published is marked 'listed' (it went through the old one-step path).
-- No Shariah ruling is created for legacy rows (see the edited
-- 20260925110100_unlist_unconfirmed_instruments.sql).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Columns and states.
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_submissions ADD COLUMN IF NOT EXISTS shariah_decision_id uuid;
ALTER TABLE public.product_submissions ADD COLUMN IF NOT EXISTS listing_decided_by uuid;
ALTER TABLE public.product_submissions ADD COLUMN IF NOT EXISTS listing_decided_at timestamptz;
ALTER TABLE public.product_submissions ADD COLUMN IF NOT EXISTS listing_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_submissions_shariah_decision_fk') THEN
    ALTER TABLE public.product_submissions
      ADD CONSTRAINT product_submissions_shariah_decision_fk
      FOREIGN KEY (shariah_decision_id) REFERENCES public.shariah_decisions(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_submissions_listing_decided_by_fk') THEN
    ALTER TABLE public.product_submissions
      ADD CONSTRAINT product_submissions_listing_decided_by_fk
      FOREIGN KEY (listing_decided_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.product_submissions DROP CONSTRAINT IF EXISTS product_submissions_status_check;
ALTER TABLE public.product_submissions
  ADD CONSTRAINT product_submissions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'listed'));

ALTER TABLE public.product_submissions DROP CONSTRAINT IF EXISTS product_submissions_listing_reason_len;
ALTER TABLE public.product_submissions
  ADD CONSTRAINT product_submissions_listing_reason_len
  CHECK (listing_reason IS NULL OR char_length(listing_reason) <= 600);

CREATE INDEX IF NOT EXISTS idx_product_submissions_status ON public.product_submissions (status, submitted_at DESC);

-- ---------------------------------------------------------------------------
-- 2) No direct decision writes through the API.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "submissions_update_reviewer" ON public.product_submissions;
REVOKE UPDATE ON TABLE public.product_submissions FROM PUBLIC, anon, authenticated;
REVOKE DELETE, TRUNCATE ON TABLE public.product_submissions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.product_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _api boolean := COALESCE(current_setting('role', true), 'none') IN ('anon', 'authenticated', 'service_role');
  _control boolean := COALESCE(current_setting('app.submission_control', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Symbols are stored as the market shows them (upper case, trimmed).
    NEW.symbol := upper(btrim(COALESCE(NEW.symbol, '')));
    IF NEW.symbol !~ '^[A-Z0-9._-]{1,32}$' THEN
      RAISE EXCEPTION 'INVALID_SYMBOL';
    END IF;
    NEW.status := 'pending';
    NEW.reviewer_id := NULL;
    NEW.review_reason := NULL;
    NEW.reviewed_at := NULL;
    NEW.shariah_decision_id := NULL;
    NEW.listing_decided_by := NULL;
    NEW.listing_decided_at := NULL;
    NEW.listing_reason := NULL;
    NEW.submitted_at := now();
    NEW.created_at := now();
    NEW.updated_at := now();
    IF auth.uid() IS NOT NULL THEN
      NEW.submitted_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  -- Decision fields change only through review_submission / approve_listing
  -- / decline_listing when the caller is an API role.
  IF _api AND NOT _control AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id
    OR NEW.review_reason IS DISTINCT FROM OLD.review_reason
    OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    OR NEW.shariah_decision_id IS DISTINCT FROM OLD.shariah_decision_id
    OR NEW.listing_decided_by IS DISTINCT FROM OLD.listing_decided_by
    OR NEW.listing_decided_at IS DISTINCT FROM OLD.listing_decided_at
    OR NEW.listing_reason IS DISTINCT FROM OLD.listing_reason
  ) THEN
    RAISE EXCEPTION 'SUBMISSION_TRANSITION_FORBIDDEN';
  END IF;

  -- The submitted content and ownership are frozen for API callers.
  IF _api AND (
       NEW.id IS DISTINCT FROM OLD.id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
    OR NEW.symbol IS DISTINCT FROM OLD.symbol
    OR NEW.asset_class IS DISTINCT FROM OLD.asset_class
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'SUBMISSION_TRANSITION_FORBIDDEN';
  END IF;

  -- Allowed transitions, for every caller (migrations included).
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'pending'  AND NEW.status IN ('approved', 'rejected'))
      OR (OLD.status = 'approved' AND NEW.status IN ('listed', 'rejected'))
    ) THEN
      RAISE EXCEPTION 'SUBMISSION_TRANSITION_FORBIDDEN';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_submissions_guard ON public.product_submissions;
CREATE TRIGGER trg_product_submissions_guard BEFORE INSERT OR UPDATE ON public.product_submissions
  FOR EACH ROW EXECUTE FUNCTION public.product_submissions_guard();

-- ---------------------------------------------------------------------------
-- 3) Shariah review: approve (instrument + ruling + status) or reject.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.review_submission(uuid, uuid, text, text, boolean);
CREATE FUNCTION public.review_submission(
  _submission_id uuid,
  _reviewer_id uuid,
  _decision text,
  _reason text DEFAULT NULL,
  _replace_ruling boolean DEFAULT false
)
RETURNS TABLE (
  submission_id uuid,
  status text,
  symbol text,
  brand_id uuid,
  ruling_id uuid,
  ruling_recorded boolean,
  previous_ruling text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sub public.product_submissions;
  _sym text;
  _why text := NULLIF(btrim(COALESCE(_reason, '')), '');
  _brand public.brands;
  _brand_id uuid;
  _current text;
  _ruling uuid;
  _recorded boolean := false;
BEGIN
  IF _reviewer_id IS NULL OR NOT public.has_role(_reviewer_id, 'shariah_board') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _decision IS NULL OR _decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF _why IS NOT NULL AND char_length(_why) > 600 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF _decision = 'rejected' AND char_length(COALESCE(_why, '')) < 10 THEN
    RAISE EXCEPTION 'REJECTION_REASON_REQUIRED';
  END IF;

  SELECT * INTO _sub FROM public.product_submissions s WHERE s.id = _submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBMISSION_NOT_FOUND'; END IF;
  IF _sub.status <> 'pending' THEN RAISE EXCEPTION 'SUBMISSION_NOT_PENDING'; END IF;

  _sym := upper(btrim(_sub.symbol));

  IF _decision = 'approved' THEN
    IF _sym !~ '^[A-Z0-9._-]{1,32}$' THEN RAISE EXCEPTION 'INVALID_SYMBOL'; END IF;
    -- The engine's per-symbol lock (the ruling trigger takes it too).
    PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

    SELECT * INTO _brand FROM public.brands b WHERE b.symbol = _sym FOR UPDATE;
    IF FOUND THEN
      -- Another company's (or an unowned seeded) instrument.
      IF _brand.company_id IS DISTINCT FROM _sub.company_id THEN
        RAISE EXCEPTION 'SYMBOL_TAKEN';
      END IF;
      -- Never the listing state or the reference price.
      UPDATE public.brands b
         SET name_ar = _sub.name_ar, name_en = _sub.name_en, sector = _sub.sector,
             asset_class = _sub.asset_class, source_submission_id = _sub.id
       WHERE b.id = _brand.id;
      _brand_id := _brand.id;
    ELSE
      IF EXISTS (SELECT 1 FROM public.brands b WHERE b.slug = lower(_sym)) THEN
        RAISE EXCEPTION 'SYMBOL_TAKEN';
      END IF;
      INSERT INTO public.brands (symbol, slug, name_ar, name_en, sector, asset_class, company_id,
                                 source_submission_id, published, reference_price)
      VALUES (_sym, lower(_sym), _sub.name_ar, _sub.name_en, _sub.sector, _sub.asset_class,
              _sub.company_id, _sub.id, false, 0)
      RETURNING id INTO _brand_id;
    END IF;

    -- The ruling in force is never overridden silently.
    _current := public.current_shariah_status(_sym);
    IF _current = 'halal' THEN
      SELECT d.id INTO _ruling FROM public.shariah_decisions d
       WHERE d.symbol = _sym
       ORDER BY d.effective_at DESC, d.created_at DESC, d.id DESC
       LIMIT 1;
    ELSE
      IF _current IS NOT NULL THEN
        IF NOT COALESCE(_replace_ruling, false) THEN
          RAISE EXCEPTION 'SHARIAH_RULING_CONFLICT'
            USING DETAIL = format('The ruling in force for %s is %s.', _sym, _current);
        END IF;
        IF char_length(COALESCE(_why, '')) < 10 THEN
          RAISE EXCEPTION 'RULING_CHANGE_REASON_REQUIRED';
        END IF;
      END IF;
      INSERT INTO public.shariah_decisions (symbol, status, reason, reviewer_id, updated_by)
      VALUES (_sym, 'halal', _why, _reviewer_id, _reviewer_id)
      RETURNING id INTO _ruling;
      _recorded := true;
    END IF;
  END IF;

  PERFORM set_config('app.submission_control', 'on', true);
  UPDATE public.product_submissions s
     SET status = _decision,
         reviewer_id = _reviewer_id,
         review_reason = _why,
         reviewed_at = now(),
         shariah_decision_id = _ruling
   WHERE s.id = _sub.id;
  PERFORM set_config('app.submission_control', 'off', true);

  INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
  VALUES (
    _reviewer_id, _sub.company_id,
    CASE WHEN _decision = 'approved' THEN 'submission.approve' ELSE 'submission.reject' END,
    'product_submissions', _sub.id::text,
    jsonb_build_object('symbol', _sym, 'rulingRecorded', _recorded, 'rulingId', _ruling,
                       'previousRuling', _current, 'brandId', _brand_id)
  );

  RETURN QUERY SELECT _sub.id, _decision, _sym, _brand_id, _ruling, _recorded, _current;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Listing: reference price + listing + optional first allocation.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.approve_listing(uuid, uuid, numeric, uuid, numeric, numeric, text);
CREATE FUNCTION public.approve_listing(
  _submission_id uuid,
  _actor_id uuid,
  _reference_price numeric,
  _holder_id uuid DEFAULT NULL,
  _qty numeric DEFAULT NULL,
  _issue_price numeric DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS TABLE (
  submission_id uuid,
  symbol text,
  brand_id uuid,
  reference_price numeric,
  published boolean,
  issuance_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sub public.product_submissions;
  _brand public.brands;
  _ruling text;
  _issuance uuid;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;
  IF _reference_price IS NULL OR _reference_price = 'NaN'::numeric THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;
  IF (_holder_id IS NULL) <> (_qty IS NULL) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  SELECT * INTO _sub FROM public.product_submissions s WHERE s.id = _submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBMISSION_NOT_FOUND'; END IF;
  IF _sub.status <> 'approved' THEN RAISE EXCEPTION 'SUBMISSION_NOT_APPROVED'; END IF;

  SELECT * INTO _brand FROM public.brands b
   WHERE b.source_submission_id = _sub.id AND b.company_id = _sub.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- Lock order of every engine path: the holder first, then the symbol.
  IF _holder_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(4242, hashtext(_holder_id::text));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _brand.symbol));
  SELECT * INTO _brand FROM public.brands b WHERE b.id = _brand.id FOR UPDATE;

  -- Listing needs the Shariah reviewer's 'halal' ruling in force.
  _ruling := public.current_shariah_status(_brand.symbol);
  IF _ruling IS NULL THEN RAISE EXCEPTION 'SHARIAH_RULING_REQUIRED'; END IF;
  IF _ruling <> 'halal' THEN RAISE EXCEPTION 'SHARIAH_NOT_HALAL'; END IF;

  -- The reference price (brands_reference_price_rules raises INVALID_PRICE
  -- for anything off the 0.01 tick or outside 0.05 .. 1,000,000,000).
  IF _brand.reference_price IS DISTINCT FROM _reference_price THEN
    UPDATE public.brands b SET reference_price = _reference_price WHERE b.id = _brand.id;
    INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
    VALUES (_actor_id, _brand.company_id, 'brand.reference_price', 'brands', _brand.id::text,
            jsonb_build_object('symbol', _brand.symbol, 'from', _brand.reference_price, 'to', _reference_price,
                               'submissionId', _sub.id));
  END IF;

  -- Listing (ruling and price checks, audit row, same transaction).
  PERFORM 1 FROM public.set_instrument_published(_brand.symbol, true, _actor_id);

  -- First allocation (primary issuance at the issue price, by default the
  -- reference price).
  IF _holder_id IS NOT NULL THEN
    _issuance := public.issue_units(_actor_id, _holder_id, _brand.symbol, _qty,
                                    COALESCE(_issue_price, _reference_price),
                                    COALESCE(NULLIF(btrim(COALESCE(_note, '')), ''), 'Initial allocation at listing'));
  END IF;

  PERFORM set_config('app.submission_control', 'on', true);
  UPDATE public.product_submissions s
     SET status = 'listed', listing_decided_by = _actor_id, listing_decided_at = now()
   WHERE s.id = _sub.id;
  PERFORM set_config('app.submission_control', 'off', true);

  INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
  VALUES (_actor_id, _sub.company_id, 'submission.list', 'product_submissions', _sub.id::text,
          jsonb_build_object('symbol', _brand.symbol, 'referencePrice', _reference_price,
                             'issuanceId', _issuance, 'holderId', _holder_id, 'qty', _qty));

  RETURN QUERY SELECT _sub.id, _brand.symbol, _brand.id, _reference_price, true, _issuance;
END;
$$;

DROP FUNCTION IF EXISTS public.decline_listing(uuid, uuid, text);
CREATE FUNCTION public.decline_listing(_submission_id uuid, _actor_id uuid, _reason text)
RETURNS TABLE (submission_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sub public.product_submissions;
  _why text := NULLIF(btrim(COALESCE(_reason, '')), '');
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;
  IF char_length(COALESCE(_why, '')) < 10 THEN RAISE EXCEPTION 'REJECTION_REASON_REQUIRED'; END IF;
  IF char_length(_why) > 600 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  SELECT * INTO _sub FROM public.product_submissions s WHERE s.id = _submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBMISSION_NOT_FOUND'; END IF;
  IF _sub.status <> 'approved' THEN RAISE EXCEPTION 'SUBMISSION_NOT_APPROVED'; END IF;

  -- The instrument stays off the market; the Shariah ruling stays on record.
  PERFORM set_config('app.submission_control', 'on', true);
  UPDATE public.product_submissions s
     SET status = 'rejected', listing_decided_by = _actor_id, listing_decided_at = now(), listing_reason = _why
   WHERE s.id = _sub.id;
  PERFORM set_config('app.submission_control', 'off', true);

  INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
  VALUES (_actor_id, _sub.company_id, 'submission.decline_listing', 'product_submissions', _sub.id::text,
          jsonb_build_object('symbol', upper(btrim(_sub.symbol))));

  RETURN QUERY SELECT _sub.id, 'rejected'::text;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4b) set_instrument_published (same signature and behaviour as
--     20260925110000) also completes the lifecycle when an admin lists a
--     Shariah-approved submission's instrument from the listing screen:
--     its submission becomes 'listed', so the two never disagree.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_instrument_published(_symbol text, _published boolean, _actor_id uuid)
RETURNS TABLE(brand_id uuid, company_id uuid, symbol text, published boolean, changed boolean, cancelled_orders integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sym text := upper(btrim(COALESCE(_symbol, '')));
  _brand public.brands;
  _n integer := 0;
  _changed boolean;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;
  IF _published IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF _sym !~ '^[A-Z0-9._-]{1,32}$' THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- Symbol lock first (as every order path), then the rows.
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

  SELECT * INTO _brand FROM public.brands b WHERE b.symbol = _sym FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  IF _published THEN
    -- The reference price anchors the band; 0 means no admin has set one.
    IF NOT (_brand.reference_price > 0 AND _brand.reference_price <= 1000000000) THEN
      RAISE EXCEPTION 'INVALID_PRICE';
    END IF;
    -- Every listed instrument carries a ruling in force.
    IF public.current_shariah_status(_brand.symbol) IS NULL THEN
      RAISE EXCEPTION 'SHARIAH_RULING_REQUIRED';
    END IF;
  END IF;

  _changed := _brand.published IS DISTINCT FROM _published;
  IF _changed THEN
    PERFORM set_config('app.listing_control', 'on', true);
    UPDATE public.brands b SET published = _published WHERE b.id = _brand.id;
    PERFORM set_config('app.listing_control', 'off', true);
  END IF;

  IF NOT _published THEN
    _n := public.close_instrument_orders(_brand.symbol, 'delisted', _actor_id);
  END IF;

  -- Lifecycle: listing a Shariah-approved submission's instrument lists it.
  IF _published AND _brand.source_submission_id IS NOT NULL THEN
    PERFORM set_config('app.submission_control', 'on', true);
    UPDATE public.product_submissions s
       SET status = 'listed', listing_decided_by = _actor_id, listing_decided_at = now()
     WHERE s.id = _brand.source_submission_id
       AND s.company_id IS NOT DISTINCT FROM _brand.company_id
       AND s.status = 'approved';
    PERFORM set_config('app.submission_control', 'off', true);
  END IF;

  INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
  VALUES (
    _actor_id, _brand.company_id,
    CASE WHEN _published THEN 'brand.publish' ELSE 'brand.unpublish' END,
    'brands', _brand.id::text,
    jsonb_build_object('symbol', _brand.symbol, 'changed', _changed, 'cancelledOrders', _n)
  );

  RETURN QUERY SELECT _brand.id, _brand.company_id, _brand.symbol, _published, _changed, _n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Instruments a Shariah reviewer rules on: every instrument, listed or
--    not, with the ruling in force (reviewers and platform admins).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reviewer_instruments(uuid);
CREATE FUNCTION public.reviewer_instruments(_actor_id uuid)
RETURNS TABLE (
  symbol text,
  slug text,
  name_ar text,
  name_en text,
  sector text,
  asset_class text,
  published boolean,
  has_company boolean,
  submission_status text,
  shariah_status text,
  ruling_effective_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _actor_id IS NULL OR NOT (public.has_role(_actor_id, 'shariah_board') OR public.has_role(_actor_id, 'platform_admin')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT b.symbol, b.slug, b.name_ar, b.name_en, b.sector, b.asset_class, b.published,
         b.company_id IS NOT NULL,
         s.status,
         r.status, r.effective_at
    FROM public.brands b
    LEFT JOIN public.product_submissions s ON s.id = b.source_submission_id
    LEFT JOIN LATERAL (
      SELECT d.status, d.effective_at FROM public.shariah_decisions d
       WHERE d.symbol = b.symbol
       ORDER BY d.effective_at DESC, d.created_at DESC, d.id DESC
       LIMIT 1
    ) r ON true
   ORDER BY b.symbol
   LIMIT 2000;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Legacy rows: an approval whose instrument is already listed is 'listed'.
-- ---------------------------------------------------------------------------
UPDATE public.product_submissions s
   SET status = 'listed'
  FROM public.brands b
 WHERE s.status = 'approved'
   AND b.source_submission_id = s.id
   AND b.company_id = s.company_id
   AND b.published;

-- ---------------------------------------------------------------------------
-- 7) EXECUTE allow list (pattern of 20260924100600): service role only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    'public.review_submission(uuid, uuid, text, text, boolean)',
    'public.approve_listing(uuid, uuid, numeric, uuid, numeric, numeric, text)',
    'public.decline_listing(uuid, uuid, text)',
    'public.reviewer_instruments(uuid)',
    'public.set_instrument_published(text, boolean, uuid)'
  ];
  trigger_only text[] := ARRAY[
    'public.product_submissions_guard()'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY trigger_only LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;


-- ============================================================================
-- >>> 20260926101100_public_candles_cost.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- public_candles: cheap small calls, bounded large ones (phase 3, agent D;
-- phase 2 leftover).
--
-- Measured on 1,000,000 trades of one published symbol, as anon:
--   * every call paid ~20-45 ms of JIT compilation: the planner's row
--     estimate for the per-bucket lateral scans (5,000 rows per bucket)
--     pushed the plan cost above jit_above_cost. The function now runs with
--     jit = off (the plans are index probes; JIT never pays off here);
--   * '1d' with a large limit aggregated every trade of the returned days
--     with two ordered array_agg sorts per bucket (open / close): 380 ms for
--     200 days, 680 ms for 500. Open and close are now one index probe each
--     (first / last trade of the bucket), and high / low / volume / count
--     come from an index-only scan of the covering index below, with no sort;
--   * '1d' is capped at 366 buckets (one year of trading days with trades),
--     '1h' stays capped at 500.
-- Same signature, same columns, same results (checked against a naive
-- GROUP BY in supabase/tests/extra/d_integrity.sh).
--
-- idx_trades_symbol_time_cover (symbol, created_at, id) INCLUDE (price, qty)
-- serves both directions of the old idx_trades_symbol_time (symbol,
-- created_at DESC), which is kept: other paths name it in their plans and
-- dropping it buys little.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_trades_symbol_time_cover
  ON public.trades (symbol, created_at, id) INCLUDE (price, qty);

CREATE OR REPLACE FUNCTION public.public_candles(_symbol text, _interval text DEFAULT '1d', _limit integer DEFAULT 200)
RETURNS TABLE (
  bucket_start timestamptz,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  close_price numeric,
  volume_units numeric,
  trade_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET jit = off
AS $$
  WITH RECURSIVE target AS (
    SELECT b.symbol,
           -- Asia/Riyadh has no DST: a trading day is exactly 24 hours.
           CASE WHEN _interval = '1h' THEN interval '1 hour' ELSE interval '24 hours' END AS step,
           LEAST(GREATEST(COALESCE(_limit, 200), 1), CASE WHEN _interval = '1h' THEN 500 ELSE 366 END) AS cap
      FROM public.brands b
     WHERE b.published
       AND _interval IN ('1h', '1d')
       AND char_length(btrim(COALESCE(_symbol, ''))) BETWEEN 1 AND 64
       AND b.symbol = upper(btrim(_symbol))
  ), buckets AS (
    -- The newest bucket that has a trade, then each older one: one probe
    -- per bucket, at most `cap` buckets.
    SELECT nb.bucket, 1 AS n
      FROM target
      CROSS JOIN LATERAL (
        SELECT t.created_at FROM public.trades t
         WHERE t.symbol = target.symbol
         ORDER BY t.created_at DESC
         LIMIT 1
      ) latest
      CROSS JOIN LATERAL (
        SELECT CASE WHEN _interval = '1h'
                    THEN date_trunc('hour', latest.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                    ELSE date_trunc('day', latest.created_at AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'
               END AS bucket
      ) nb
    UNION ALL
    SELECT nb.bucket, bk.n + 1
      FROM buckets bk
      CROSS JOIN target
      CROSS JOIN LATERAL (
        SELECT t.created_at FROM public.trades t
         WHERE t.symbol = target.symbol AND t.created_at < bk.bucket
         ORDER BY t.created_at DESC
         LIMIT 1
      ) prev
      CROSS JOIN LATERAL (
        SELECT CASE WHEN _interval = '1h'
                    THEN date_trunc('hour', prev.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                    ELSE date_trunc('day', prev.created_at AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'
               END AS bucket
      ) nb
     WHERE bk.n < target.cap
  )
  SELECT bk.bucket, o.price, a.high_price, a.low_price, c.price, a.volume_units, a.trade_count
    FROM buckets bk
    CROSS JOIN target
    CROSS JOIN LATERAL (
      -- First trade of the bucket (time, then id: the old tie-break).
      SELECT t.price FROM public.trades t
       WHERE t.symbol = target.symbol AND t.created_at >= bk.bucket AND t.created_at < bk.bucket + target.step
       ORDER BY t.created_at ASC, t.id ASC
       LIMIT 1
    ) o
    CROSS JOIN LATERAL (
      SELECT t.price FROM public.trades t
       WHERE t.symbol = target.symbol AND t.created_at >= bk.bucket AND t.created_at < bk.bucket + target.step
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 1
    ) c
    CROSS JOIN LATERAL (
      SELECT max(t.price) AS high_price,
             min(t.price) AS low_price,
             sum(t.qty) AS volume_units,
             count(*) AS trade_count
        FROM public.trades t
       WHERE t.symbol = target.symbol
         AND t.created_at >= bk.bucket
         AND t.created_at < bk.bucket + target.step
    ) a
   ORDER BY bk.bucket ASC;
$$;

-- Same audience as before (20260925110000): browser-visible market data.
DO $$
BEGIN
  IF to_regprocedure('public.public_candles(text, text, integer)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.public_candles(text, text, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.public_candles(text, text, integer) TO anon, authenticated, service_role;
  END IF;
END $$;


-- ============================================================================
-- >>> 20260926101200_integrity_report.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- integrity_report(): the ledger and market invariants as named checks
-- (phase 3, agent D). Read-only; service role only. The admin health page
-- (/admin/health, getPlatformHealth) shows it as a pass / fail list after
-- the server has checked platform_admin.
--
-- Each row: check_key (stable name), ok, violations (rows that break it)
-- and sample (at most 5 offending keys, for the operator to look up).
--
--   cash_matches_ledger        portfolios.cash_balance = sum(cash_ledger)
--                              per user (also users with ledger rows and
--                              no portfolio)
--   trade_cash_balanced        order_buy + order_sell ledger rows sum to 0
--   no_negative_cash           no portfolio below 0
--   units_match_history        per holder and symbol: position =
--                              issued + bought - sold
--   units_conserved_per_symbol per symbol: units held = units issued
--   no_negative_positions      no position below 0
--   orders_fill_within_qty     0 <= filled_qty <= qty
--   no_resting_on_unpublished  no open / partial order on an instrument
--                              that is not published
--   trades_reference_orders    every trade names its buy and sell orders,
--                              they exist, and their user and symbol match
--   published_ready            every published instrument has a reference
--                              price > 0 and a Shariah ruling in force
--   cost_basis_not_negative    positions.cost_basis >= 0 (when the column
--                              exists, 20260926100500)
-- ============================================================================

DROP FUNCTION IF EXISTS public.integrity_report();
CREATE FUNCTION public.integrity_report()
RETURNS TABLE (check_key text, ok boolean, violations bigint, sample jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
SET jit = off
AS $$
DECLARE
  _n bigint;
  _s jsonb;
BEGIN
  -- cash_matches_ledger
  WITH l AS (SELECT user_id, sum(amount) AS total FROM public.cash_ledger GROUP BY user_id),
  bad AS (
    SELECT COALESCE(p.user_id, l.user_id) AS user_id
      FROM public.portfolios p FULL JOIN l ON l.user_id = p.user_id
     WHERE COALESCE(p.cash_balance, 0) <> COALESCE(l.total, 0)
  )
  SELECT count(*), COALESCE((SELECT jsonb_agg(user_id) FROM (SELECT user_id FROM bad ORDER BY user_id LIMIT 5) x), '[]'::jsonb)
    INTO _n, _s FROM bad;
  RETURN QUERY SELECT 'cash_matches_ledger'::text, _n = 0, _n, _s;

  -- trade_cash_balanced
  SELECT COALESCE(sum(amount), 0) INTO _s FROM public.cash_ledger WHERE kind IN ('order_buy', 'order_sell');
  _n := CASE WHEN (_s #>> '{}')::numeric = 0 THEN 0 ELSE 1 END;
  RETURN QUERY SELECT 'trade_cash_balanced'::text, _n = 0, _n,
    CASE WHEN _n = 0 THEN '[]'::jsonb ELSE jsonb_build_array(_s) END;

  -- no_negative_cash
  SELECT count(*), COALESCE((SELECT jsonb_agg(user_id) FROM (SELECT user_id FROM public.portfolios WHERE cash_balance < 0 ORDER BY user_id LIMIT 5) x), '[]'::jsonb)
    INTO _n, _s FROM public.portfolios WHERE cash_balance < 0;
  RETURN QUERY SELECT 'no_negative_cash'::text, _n = 0, _n, _s;

  -- units_match_history
  WITH moves AS (
    SELECT user_id, upper(symbol) AS symbol, qty FROM public.unit_issuances
    UNION ALL SELECT buyer_id, upper(symbol), qty FROM public.trades
    UNION ALL SELECT seller_id, upper(symbol), -qty FROM public.trades
  ), expected AS (SELECT user_id, symbol, sum(qty) AS qty FROM moves GROUP BY 1, 2),
  held AS (SELECT user_id, upper(symbol) AS symbol, sum(qty) AS qty FROM public.positions GROUP BY 1, 2),
  bad AS (
    SELECT COALESCE(h.user_id, e.user_id) AS user_id, COALESCE(h.symbol, e.symbol) AS symbol
      FROM held h FULL JOIN expected e ON e.user_id = h.user_id AND e.symbol = h.symbol
     WHERE COALESCE(h.qty, 0) <> COALESCE(e.qty, 0)
  )
  SELECT count(*), COALESCE((SELECT jsonb_agg(jsonb_build_object('user', user_id, 'symbol', symbol))
                               FROM (SELECT * FROM bad ORDER BY symbol, user_id LIMIT 5) x), '[]'::jsonb)
    INTO _n, _s FROM bad;
  RETURN QUERY SELECT 'units_match_history'::text, _n = 0, _n, _s;

  -- units_conserved_per_symbol
  WITH issued AS (SELECT upper(symbol) AS symbol, sum(qty) AS qty FROM public.unit_issuances GROUP BY 1),
  held AS (SELECT upper(symbol) AS symbol, sum(qty) AS qty FROM public.positions GROUP BY 1),
  bad AS (
    SELECT COALESCE(h.symbol, i.symbol) AS symbol
      FROM held h FULL JOIN issued i ON i.symbol = h.symbol
     WHERE COALESCE(h.qty, 0) <> COALESCE(i.qty, 0)
  )
  SELECT count(*), COALESCE((SELECT jsonb_agg(symbol) FROM (SELECT symbol FROM bad ORDER BY symbol LIMIT 5) x), '[]'::jsonb)
    INTO _n, _s FROM bad;
  RETURN QUERY SELECT 'units_conserved_per_symbol'::text, _n = 0, _n, _s;

  -- no_negative_positions
  SELECT count(*), COALESCE((SELECT jsonb_agg(jsonb_build_object('user', user_id, 'symbol', symbol))
                               FROM (SELECT user_id, symbol FROM public.positions WHERE qty < 0 ORDER BY symbol, user_id LIMIT 5) x), '[]'::jsonb)
    INTO _n, _s FROM public.positions WHERE qty < 0;
  RETURN QUERY SELECT 'no_negative_positions'::text, _n = 0, _n, _s;

  -- orders_fill_within_qty
  SELECT count(*), COALESCE((SELECT jsonb_agg(id) FROM (SELECT id FROM public.orders WHERE filled_qty < 0 OR filled_qty > qty ORDER BY id LIMIT 5) x), '[]'::jsonb)
    INTO _n, _s FROM public.orders WHERE filled_qty < 0 OR filled_qty > qty;
  RETURN QUERY SELECT 'orders_fill_within_qty'::text, _n = 0, _n, _s;

  -- no_resting_on_unpublished
  WITH bad AS (
    SELECT o.id FROM public.orders o
     WHERE o.status IN ('open', 'partial')
       AND NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.symbol = upper(btrim(o.symbol)) AND b.published)
  )
  SELECT count(*), COALESCE((SELECT jsonb_agg(id) FROM (SELECT id FROM bad ORDER BY id LIMIT 5) x), '[]'::jsonb)
    INTO _n, _s FROM bad;
  RETURN QUERY SELECT 'no_resting_on_unpublished'::text, _n = 0, _n, _s;

  -- trades_reference_orders
  WITH bad AS (
    SELECT t.id FROM public.trades t
      LEFT JOIN public.orders bo ON bo.id = t.buy_order_id
      LEFT JOIN public.orders so ON so.id = t.sell_order_id
     WHERE bo.id IS NULL OR so.id IS NULL
        OR bo.user_id <> t.buyer_id OR so.user_id <> t.seller_id
        OR bo.side <> 'buy' OR so.side <> 'sell'
        OR upper(bo.symbol) <> upper(t.symbol) OR upper(so.symbol) <> upper(t.symbol)
  )
  SELECT count(*), COALESCE((SELECT jsonb_agg(id) FROM (SELECT id FROM bad ORDER BY id LIMIT 5) x), '[]'::jsonb)
    INTO _n, _s FROM bad;
  RETURN QUERY SELECT 'trades_reference_orders'::text, _n = 0, _n, _s;

  -- published_ready
  WITH bad AS (
    SELECT b.symbol FROM public.brands b
     WHERE b.published
       AND (NOT (b.reference_price > 0) OR public.current_shariah_status(b.symbol) IS NULL)
  )
  SELECT count(*), COALESCE((SELECT jsonb_agg(symbol) FROM (SELECT symbol FROM bad ORDER BY symbol LIMIT 5) x), '[]'::jsonb)
    INTO _n, _s FROM bad;
  RETURN QUERY SELECT 'published_ready'::text, _n = 0, _n, _s;

  -- cost_basis_not_negative (only when the column exists)
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'positions' AND column_name = 'cost_basis') THEN
    EXECUTE $q$
      SELECT count(*), COALESCE((SELECT jsonb_agg(jsonb_build_object('user', user_id, 'symbol', symbol))
                                   FROM (SELECT user_id, symbol FROM public.positions WHERE cost_basis < 0 ORDER BY symbol, user_id LIMIT 5) x), '[]'::jsonb)
        FROM public.positions WHERE cost_basis < 0
    $q$ INTO _n, _s;
    RETURN QUERY SELECT 'cost_basis_not_negative'::text, _n = 0, _n, _s;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.integrity_report() IS
  'Read-only ledger / market invariant checks for /admin/health. Service role only.';

-- EXECUTE allow list (pattern of 20260924100600): service role only.
DO $$
BEGIN
  IF to_regprocedure('public.integrity_report()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.integrity_report() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.integrity_report() TO service_role;
  END IF;
END $$;


-- ============================================================================
-- >>> 20260926101500_fixer_security_hardening.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Phase 3 fixer, round 1: security hardening.
--
--   1) Rate limits (check_rate_limit): the bucket start is computed with
--      floor() instead of a rounding ::bigint cast, so a window is one row,
--      not two (limits were about 2x looser), and old rows are cleaned up
--      per row after their own window has ended. Before, every row older
--      than one hour was deleted in the call that had just counted it, so a
--      window longer than one hour (the 3-per-day cap per address on
--      /request-access) was never enforced. The bucket arithmetic lives in
--      rate_limit_bucket() so it can be tested with fixed timestamps.
--   2) Watch lists and price alerts: a row can only be added for an
--      instrument listed on the market (brands.published), symbols are
--      stored upper-case (the notification lookups match them exactly), and
--      each user holds at most 100 watched symbols and 100 price alerts.
--      Before, any signed-in account could watch any symbol (including
--      unlisted, pre-listing instruments) and receive their Shariah ruling
--      e-mails, and insert thousands of rows in one request.
--   3) Instruments (brands) through the API: authenticated callers keep
--      UPDATE on the descriptive columns only (name_ar, name_en, sector;
--      company owners, through brands_company_owner_update and
--      brands_guard); INSERT and the platform-admin write policies are
--      gone. Reference prices change through set_reference_price(), which
--      writes its audit row in the same transaction. The symbol, and the
--      company it belongs to, can no longer change once the instrument has
--      orders, positions, trades or issuances (INSTRUMENT_HAS_HISTORY), for
--      every caller.
--   4) Names: company names at most 120 characters, instrument names at
--      most 160, sector at most 80 (the limits of the forms); renaming a
--      company or an instrument through the API writes an audit_log row.
--   5) Signed-in market stats: get_symbol_market_stats / get_market_snapshot
--      answered for unlisted instruments; nothing in the app calls them, so
--      they are service_role only now.
--   6) Shariah rulings: a ruling is changed only through
--      update_shariah_decision(), which requires a written change reason
--      and records it in shariah_decision_audit in the same transaction.
--      Direct UPDATE of shariah_decisions is revoked from authenticated.
--   7) Storage: the bucket for submission documents is private, with no
--      anon/authenticated policy on its objects (the server reads and
--      writes it with the service role and short-lived signed URLs).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Rate limits.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rate_limits ADD COLUMN IF NOT EXISTS window_seconds integer;

CREATE OR REPLACE FUNCTION public.rate_limit_bucket(_at timestamptz, _window_seconds integer)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- Fixed windows aligned on the Unix epoch: [k * w, (k + 1) * w).
  SELECT to_timestamp(
    (floor(extract(epoch FROM _at) / GREATEST(COALESCE(_window_seconds, 1), 1))
      * GREATEST(COALESCE(_window_seconds, 1), 1))::double precision
  );
$$;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _key text,
  _limit integer,
  _window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _w integer := GREATEST(COALESCE(_window_seconds, 1), 1);
  _bucket timestamptz := public.rate_limit_bucket(now(), GREATEST(COALESCE(_window_seconds, 1), 1));
  _current integer;
BEGIN
  INSERT INTO public.rate_limits (key, window_start, count, window_seconds)
  VALUES (_key, _bucket, 1, _w)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1,
                window_seconds = GREATEST(COALESCE(public.rate_limits.window_seconds, 0), EXCLUDED.window_seconds)
  RETURNING count INTO _current;

  -- Best-effort cleanup: a row goes once its own window has ended (rows
  -- written before this migration have no window and are kept one hour).
  DELETE FROM public.rate_limits r
   WHERE r.window_start < now() - interval '1 hour'
     AND r.window_start + make_interval(secs => COALESCE(r.window_seconds, 3600)) < now();

  RETURN _current <= _limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Watch lists and price alerts: listed instruments only, capped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_watch_rows_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_max constant integer := 100;
  _n integer;
BEGIN
  NEW.symbol := upper(btrim(COALESCE(NEW.symbol, '')));
  IF TG_OP = 'INSERT' THEN
    -- One writer per user and table at a time, so the cap holds under
    -- concurrent requests too.
    PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || ':' || NEW.user_id::text));
    EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id = $1', TG_TABLE_NAME)
      INTO _n USING NEW.user_id;
    IF _n >= c_max THEN
      RAISE EXCEPTION '%', CASE WHEN TG_TABLE_NAME = 'price_alerts' THEN 'ALERT_LIMIT_REACHED'
                                ELSE 'WATCHLIST_LIMIT_REACHED' END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.user_watch_rows_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_symbol_watchers_guard ON public.symbol_watchers;
CREATE TRIGGER trg_symbol_watchers_guard BEFORE INSERT OR UPDATE OF symbol ON public.symbol_watchers
  FOR EACH ROW EXECUTE FUNCTION public.user_watch_rows_guard();
DROP TRIGGER IF EXISTS trg_price_alerts_guard ON public.price_alerts;
CREATE TRIGGER trg_price_alerts_guard BEFORE INSERT OR UPDATE OF symbol ON public.price_alerts
  FOR EACH ROW EXECUTE FUNCTION public.user_watch_rows_guard();

-- The owner reads and deletes their rows; a new or changed row must name a
-- listed instrument (checked after the trigger has normalised the symbol).
DROP POLICY IF EXISTS "watchers_self" ON public.symbol_watchers;
DROP POLICY IF EXISTS "watchers_read_own" ON public.symbol_watchers;
DROP POLICY IF EXISTS "watchers_delete_own" ON public.symbol_watchers;
DROP POLICY IF EXISTS "watchers_insert_listed" ON public.symbol_watchers;
DROP POLICY IF EXISTS "watchers_update_listed" ON public.symbol_watchers;
CREATE POLICY "watchers_read_own" ON public.symbol_watchers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "watchers_delete_own" ON public.symbol_watchers
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "watchers_insert_listed" ON public.symbol_watchers
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id
              AND EXISTS (SELECT 1 FROM public.brands b
                           WHERE b.symbol = symbol_watchers.symbol AND b.published));
CREATE POLICY "watchers_update_listed" ON public.symbol_watchers
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id
              AND EXISTS (SELECT 1 FROM public.brands b
                           WHERE b.symbol = symbol_watchers.symbol AND b.published));

DROP POLICY IF EXISTS "alerts_self" ON public.price_alerts;
DROP POLICY IF EXISTS "alerts_read_own" ON public.price_alerts;
DROP POLICY IF EXISTS "alerts_delete_own" ON public.price_alerts;
DROP POLICY IF EXISTS "alerts_insert_listed" ON public.price_alerts;
DROP POLICY IF EXISTS "alerts_update_listed" ON public.price_alerts;
CREATE POLICY "alerts_read_own" ON public.price_alerts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "alerts_delete_own" ON public.price_alerts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "alerts_insert_listed" ON public.price_alerts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id
              AND EXISTS (SELECT 1 FROM public.brands b
                           WHERE b.symbol = price_alerts.symbol AND b.published));
CREATE POLICY "alerts_update_listed" ON public.price_alerts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id
              AND EXISTS (SELECT 1 FROM public.brands b
                           WHERE b.symbol = price_alerts.symbol AND b.published));

-- ---------------------------------------------------------------------------
-- 3) Instruments through the API.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "brands_platform_admin_insert" ON public.brands;
DROP POLICY IF EXISTS "brands_platform_admin_update" ON public.brands;
-- Revoking the table privilege also revokes the column privileges; the
-- descriptive columns are granted again right after.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.brands FROM PUBLIC, anon, authenticated;
GRANT UPDATE (name_ar, name_en, sector) ON public.brands TO authenticated;

CREATE OR REPLACE FUNCTION public.brands_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- PostgREST switches every request to one of these roles; migrations and
  -- the SQL editor run as the owner with no role set.
  _api boolean := COALESCE(current_setting('role', true), 'none') IN ('anon', 'authenticated', 'service_role');
BEGIN
  -- Symbols are stored upper-case (Shariah rulings and orders match on them).
  IF TG_OP = 'INSERT' THEN
    NEW.symbol := upper(btrim(NEW.symbol));
    -- A new instrument starts off the market; set_instrument_published
    -- lists it once it has a reference price and a ruling.
    IF _api AND NEW.published THEN
      RAISE EXCEPTION 'FORBIDDEN_BRAND_FIELD';
    END IF;
    RETURN NEW;
  END IF;
  -- Listing and delisting: set_instrument_published only (it closes the
  -- resting orders and writes the audit row in the same transaction).
  IF _api AND NEW.published IS DISTINCT FROM OLD.published
     AND COALESCE(current_setting('app.listing_control', true), '') <> 'on' THEN
    RAISE EXCEPTION 'FORBIDDEN_BRAND_FIELD';
  END IF;
  IF NEW.symbol IS DISTINCT FROM OLD.symbol THEN
    NEW.symbol := upper(btrim(NEW.symbol));
  END IF;
  -- Fixer (phase 3): the identity of an instrument with a market history
  -- is frozen for every caller. Orders, positions, trades and issuances
  -- refer to it by symbol; renaming the symbol or moving the instrument to
  -- another company would orphan them. (Detaching it, company_id -> NULL,
  -- stays possible: that is what deleting the company does.)
  IF (NEW.symbol IS DISTINCT FROM OLD.symbol
      OR (NEW.company_id IS DISTINCT FROM OLD.company_id AND NEW.company_id IS NOT NULL))
     AND (EXISTS (SELECT 1 FROM public.orders o WHERE upper(o.symbol) = OLD.symbol)
          OR EXISTS (SELECT 1 FROM public.positions p WHERE upper(p.symbol) = OLD.symbol)
          OR EXISTS (SELECT 1 FROM public.trades t WHERE upper(t.symbol) = OLD.symbol)
          OR EXISTS (SELECT 1 FROM public.unit_issuances u WHERE upper(u.symbol) = OLD.symbol)) THEN
    RAISE EXCEPTION 'INSTRUMENT_HAS_HISTORY';
  END IF;
  -- No end-user identity: service role (server) or a migration.
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'platform_admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.symbol IS DISTINCT FROM OLD.symbol
     OR NEW.slug IS DISTINCT FROM OLD.slug
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.published IS DISTINCT FROM OLD.published
     OR NEW.reference_price IS DISTINCT FROM OLD.reference_price
     OR NEW.asset_class IS DISTINCT FROM OLD.asset_class
     OR NEW.source_submission_id IS DISTINCT FROM OLD.source_submission_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'FORBIDDEN_BRAND_FIELD';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.brands_guard() FROM PUBLIC, anon, authenticated;

-- Reference price: platform admins, through the server (service role), with
-- the audit row in the same transaction. brands_reference_price_rules
-- enforces the price rules (INVALID_PRICE).
DROP FUNCTION IF EXISTS public.set_reference_price(text, numeric, uuid);
CREATE FUNCTION public.set_reference_price(_symbol text, _price numeric, _actor_id uuid)
RETURNS TABLE(brand_id uuid, symbol text, previous_price numeric, reference_price numeric, changed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sym text := upper(btrim(COALESCE(_symbol, '')));
  _brand public.brands;
  _changed boolean;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;
  IF _price IS NULL OR _price = 'NaN'::numeric OR _price <= 0 THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;
  IF _sym !~ '^[A-Z0-9._-]{1,32}$' THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- The engine's per-symbol lock: no order is priced against a half-moved band.
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));
  SELECT * INTO _brand FROM public.brands b WHERE b.symbol = _sym FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  _changed := _brand.reference_price IS DISTINCT FROM _price;
  IF _changed THEN
    UPDATE public.brands b SET reference_price = _price WHERE b.id = _brand.id;
  END IF;

  INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
  VALUES (_actor_id, _brand.company_id, 'brand.reference_price', 'brands', _brand.id::text,
          jsonb_build_object('symbol', _brand.symbol, 'from', _brand.reference_price, 'to', _price,
                             'changed', _changed));

  RETURN QUERY SELECT _brand.id, _brand.symbol, _brand.reference_price, _price, _changed;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Name lengths and rename audit.
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_name_length;
ALTER TABLE public.companies ADD CONSTRAINT companies_name_length
  CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 120 AND char_length(btrim(name_en)) BETWEEN 1 AND 120) NOT VALID;
ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_name_length;
ALTER TABLE public.brands ADD CONSTRAINT brands_name_length
  CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 160 AND char_length(btrim(name_en)) BETWEEN 1 AND 160
         AND (sector IS NULL OR char_length(sector) <= 80)) NOT VALID;
DO $$ BEGIN
  ALTER TABLE public.companies VALIDATE CONSTRAINT companies_name_length;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'companies has legacy names outside 1..120 characters; check left NOT VALID (new writes are checked)';
END $$;
DO $$ BEGIN
  ALTER TABLE public.brands VALIDATE CONSTRAINT brands_name_length;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'brands has legacy names or sectors outside the limits; check left NOT VALID (new writes are checked)';
END $$;

CREATE OR REPLACE FUNCTION public.audit_name_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- End users only: the server's own changes write their own audit rows.
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'brands' THEN
    IF NEW.name_ar IS DISTINCT FROM OLD.name_ar OR NEW.name_en IS DISTINCT FROM OLD.name_en
       OR NEW.sector IS DISTINCT FROM OLD.sector THEN
      INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
      VALUES (auth.uid(), NEW.company_id, 'brand.rename', 'brands', NEW.id::text,
              jsonb_build_object('symbol', NEW.symbol,
                                 'from', jsonb_build_object('name_ar', OLD.name_ar, 'name_en', OLD.name_en, 'sector', OLD.sector),
                                 'to', jsonb_build_object('name_ar', NEW.name_ar, 'name_en', NEW.name_en, 'sector', NEW.sector)));
    END IF;
  ELSIF NEW.name_ar IS DISTINCT FROM OLD.name_ar OR NEW.name_en IS DISTINCT FROM OLD.name_en THEN
    INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
    VALUES (auth.uid(), NEW.id, 'company.rename', 'companies', NEW.id::text,
            jsonb_build_object('from', jsonb_build_object('name_ar', OLD.name_ar, 'name_en', OLD.name_en),
                               'to', jsonb_build_object('name_ar', NEW.name_ar, 'name_en', NEW.name_en)));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_name_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_brands_audit_rename ON public.brands;
CREATE TRIGGER trg_brands_audit_rename AFTER UPDATE OF name_ar, name_en, sector ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.audit_name_change();
DROP TRIGGER IF EXISTS trg_companies_audit_rename ON public.companies;
CREATE TRIGGER trg_companies_audit_rename AFTER UPDATE OF name_ar, name_en ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.audit_name_change();

-- ---------------------------------------------------------------------------
-- 5) Signed-in market stats that ignored the listing state: server only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.get_symbol_market_stats(text)', 'public.get_market_snapshot(text[])'] LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Shariah rulings change with a written reason, through the server.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "shariah_update_board" ON public.shariah_decisions;
REVOKE UPDATE ON TABLE public.shariah_decisions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_shariah_decision_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    INSERT INTO public.shariah_decision_audit
      (decision_id, previous_status, new_status, previous_reason, new_reason, changed_by, change_reason)
    VALUES (NEW.id, OLD.status, NEW.status, OLD.reason, NEW.reason,
            COALESCE(auth.uid(), NEW.updated_by),
            NULLIF(current_setting('app.shariah_change_reason', true), ''));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.log_shariah_decision_update() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.update_shariah_decision(uuid, uuid, text, text, text);
CREATE FUNCTION public.update_shariah_decision(
  _decision_id uuid,
  _actor_id uuid,
  _status text,
  _reason text,
  _change_reason text
)
RETURNS TABLE(decision_id uuid, symbol text, status text, previous_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _d public.shariah_decisions;
  _why text := NULLIF(btrim(COALESCE(_change_reason, '')), '');
  _text text := NULLIF(btrim(COALESCE(_reason, '')), '');
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'shariah_board') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _status IS NULL OR _status NOT IN ('halal', 'non_halal', 'reviewing') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF _why IS NULL THEN RAISE EXCEPTION 'RULING_CHANGE_REASON_REQUIRED'; END IF;
  IF char_length(_why) > 600 OR char_length(COALESCE(_text, '')) > 600 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT * INTO _d FROM public.shariah_decisions d WHERE d.id = _decision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DECISION_NOT_FOUND'; END IF;
  -- The engine's per-symbol lock (a non_halal ruling cancels resting buys).
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _d.symbol));
  SELECT * INTO _d FROM public.shariah_decisions d WHERE d.id = _decision_id FOR UPDATE;

  PERFORM set_config('app.shariah_change_reason', _why, true);
  -- updated_by: the stamp trigger keeps it when there is no session user.
  UPDATE public.shariah_decisions d
     SET status = _status, reason = _text, updated_by = _actor_id
   WHERE d.id = _d.id;
  PERFORM set_config('app.shariah_change_reason', '', true);

  RETURN QUERY SELECT _d.id, _d.symbol, _status, _d.status;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) Storage: the submission documents bucket is private.
-- ---------------------------------------------------------------------------
-- The storage schema belongs to the storage service: if the migration role
-- may not change it, the migration goes on (one-transaction launch bundle)
-- and says so; the bucket is then checked by hand (Storage settings:
-- "submission-docs", public off, no policies).
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    BEGIN
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('submission-docs', 'submission-docs', false)
      ON CONFLICT (id) DO UPDATE SET public = false;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'STORAGE_BUCKET_NOT_CHECKED: make sure the bucket submission-docs is private';
    END;
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    -- No client policy may open this bucket: the server uses the service
    -- role (which bypasses RLS) and hands out 120-second signed URLs.
    FOR r IN
      SELECT pol.polname
        FROM pg_policy pol
       WHERE pol.polrelid = 'storage.objects'::regclass
         AND (COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') ILIKE '%submission-docs%'
              OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ILIKE '%submission-docs%')
    LOOP
      BEGIN
        EXECUTE format('DROP POLICY %I ON storage.objects', r.polname);
        RAISE NOTICE 'dropped storage policy % (submission-docs is server-only)', r.polname;
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE WARNING 'STORAGE_POLICY_NOT_DROPPED: remove the storage policy % by hand', r.polname;
      END;
    END LOOP;
  END IF;
END $$;


-- ============================================================================
-- >>> 20260926101600_fixer_market_rules.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Phase 3 fixer, round 1: market rules.
--
--   1) Price band: the ±20% band around the anchor (previous close, else
--      the listing reference price) always keeps at least one 0.01 tick on
--      each side of the anchor. The listing reference price is at least
--      0.05, but a band built on 0.05 lets a trade print at 0.04, and a band
--      anchored on a 0.04 close was [0.04, 0.04] (ceil(0.032) = floor(0.048)),
--      so the price could never move again. band_tick_edges() is the one
--      definition, used by match_order and by public_instrument (the band
--      the trade page shows). For every anchor >= 0.05 the edges are
--      unchanged.
--   2) Submissions: the market lists brand units only (Terms of use); a
--      submission of any other asset class is refused
--      (ASSET_CLASS_NOT_SUPPORTED), and so is listing one
--      (set_instrument_published, which approve_listing calls).
--   3) The 30-brand cap per company counts the company's roster
--      (company_brands) together with the instruments it owns
--      (brands.company_id): the company workspace shows the same figure,
--      and a new submission is refused at the cap (BRAND_CAP_REACHED).
--   4) admin_pending_activations: an account with no role that never
--      signed in gets its own source, 'no_role_never_signed_in'.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1a) Band edges on the tick.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.band_tick_edges(_ref numeric, OUT low_tick numeric, OUT high_tick numeric)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- low:  ceil(ref x 0.8) on the tick, but at most one tick below the
  --       anchor, and never below 0.01;
  -- high: floor(ref x 1.2) on the tick, but at least one tick above it.
  SELECT round(GREATEST(0.01, LEAST(ceil(_ref * 0.8 * 100) / 100, ceil(_ref * 100) / 100 - 0.01)), 2),
         round(GREATEST(floor(_ref * 1.2 * 100) / 100, floor(_ref * 100) / 100 + 0.01), 2)
   WHERE _ref IS NOT NULL AND _ref > 0 AND _ref <> 'NaN'::numeric;
$$;

-- ---------------------------------------------------------------------------
-- 3) Brand cap: roster and owned instruments together.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.company_brand_count(_company_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer FROM (
    SELECT upper(btrim(cb.brand_symbol)) FROM public.company_brands cb WHERE cb.company_id = _company_id
    UNION
    SELECT b.symbol FROM public.brands b WHERE b.company_id = _company_id
  ) s;
$$;

CREATE OR REPLACE FUNCTION public.enforce_brand_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- An instrument the company already owns is counted already.
  IF NOT EXISTS (SELECT 1 FROM public.brands b
                  WHERE b.company_id = NEW.company_id AND b.symbol = upper(btrim(NEW.brand_symbol)))
     AND public.company_brand_count(NEW.company_id) >= 30 THEN
    RAISE EXCEPTION 'BRAND_CAP_REACHED';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_brand_cap() FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 1b) match_order (same signature and results as 20260926100600; only the
--     band edges change: band_tick_edges).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_order(
  _user_id uuid, _symbol text, _asset_class text, _side text, _type text,
  _qty numeric, _limit_price numeric DEFAULT NULL
) RETURNS TABLE(order_id uuid, filled_qty numeric, avg_price numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  c_max_qty constant numeric := 10000000;
  c_max_notional constant numeric := 5000000;
  c_band constant numeric := 0.2;
  _brand public.brands;
  _opposite text;
  _price numeric;
  _ref numeric;
  _low numeric;
  _high numeric;
  _low_tick numeric;
  _high_tick numeric;
  _order_notional numeric;
  _cash numeric;
  _held numeric;
  _open numeric;
  _parties uuid[];
  my_order public.orders;
  cand public.orders;
  remaining numeric;
  trade_qty numeric;
  trade_price numeric;
  notional numeric;
  total_qty numeric := 0;
  total_cost numeric := 0;
  buyer uuid;
  seller uuid;
  buyer_cash numeric;
  seller_qty numeric;
  final_status text;
BEGIN
  -- Input validation (K1).
  IF _side IS NULL OR _side NOT IN ('buy', 'sell') THEN RAISE EXCEPTION 'INVALID_SIDE'; END IF;
  IF _type IS NULL OR _type NOT IN ('limit', 'market') THEN RAISE EXCEPTION 'INVALID_TYPE'; END IF;
  IF _qty IS NULL OR _qty = 'NaN'::numeric OR _qty <= 0 OR _qty > c_max_qty OR _qty <> trunc(_qty) THEN
    RAISE EXCEPTION 'INVALID_QTY';
  END IF;
  IF _type = 'limit' THEN
    IF _limit_price IS NULL OR _limit_price = 'NaN'::numeric OR _limit_price <= 0
       OR _limit_price > 1000000000 OR _limit_price <> round(_limit_price, 2) THEN
      RAISE EXCEPTION 'INVALID_PRICE';
    END IF;
    _price := _limit_price;
  ELSE
    _price := NULL;
  END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN_TRADER_REQUIRED'; END IF;

  -- One order path per trader at a time (placement, modify, restore,
  -- deactivation, withdrawals), taken before the symbol lock everywhere:
  -- the buying-power and holdings checks below then see the trader's other
  -- orders and cash movements.
  PERFORM pg_advisory_xact_lock(4242, hashtext(_user_id::text));

  IF NOT public.has_role(_user_id, 'trader') THEN
    RAISE EXCEPTION 'FORBIDDEN_TRADER_REQUIRED';
  END IF;

  SELECT * INTO _brand FROM public.brands b WHERE b.symbol = _symbol AND b.published;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- One matcher per symbol at a time (shared with cancel/replace/restore and
  -- the Shariah trigger).
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _brand.symbol));

  IF public.current_shariah_status(_brand.symbol) = 'non_halal' AND _side = 'buy' THEN
    RAISE EXCEPTION 'SHARIAH_BLOCKED';
  END IF;

  -- Reference price (previous close, else the listing reference) and the
  -- protection band. Trades of the current day do not move it.
  _ref := public.band_reference_price(_brand.symbol);
  IF _ref IS NULL OR _ref <= 0 THEN RAISE EXCEPTION 'PRICE_OUT_OF_BAND'; END IF;
  -- Band edges on the 0.01 tick (band_tick_edges): ±20% of the anchor,
  -- and never less than one tick either side of it (fixer, phase 3: a
  -- previous close of 0.04 no longer freezes the band at [0.04, 0.04]).
  SELECT e.low_tick, e.high_tick INTO _low_tick, _high_tick FROM public.band_tick_edges(_ref) e;
  IF _low_tick IS NULL OR _high_tick IS NULL OR _high_tick <= 0 OR _high_tick < _low_tick THEN
    RAISE EXCEPTION 'PRICE_OUT_OF_BAND';
  END IF;
  -- Limit prices are on the tick, so this is the band on the tick.
  IF _type = 'limit' AND (_price < _low_tick OR _price > _high_tick) THEN
    RAISE EXCEPTION 'PRICE_OUT_OF_BAND';
  END IF;

  -- Size limit and cash reserve: a market order is measured at the top of
  -- the band on the tick (phase 3), the worst price a market buy can fill
  -- at; a limit order at its limit.
  _order_notional := _qty * COALESCE(_price, _high_tick);
  IF _order_notional > c_max_notional THEN RAISE EXCEPTION 'ORDER_TOO_LARGE'; END IF;

  _opposite := CASE WHEN _side = 'buy' THEN 'sell' ELSE 'buy' END;

  -- Self-trade prevention: an order that would cross the trader's own
  -- resting order is refused (it would otherwise rest on a crossed book).
  IF EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.user_id = _user_id AND o.symbol = _brand.symbol AND o.side = _opposite
       AND o.status IN ('open', 'partial') AND o.price IS NOT NULL AND o.qty > o.filled_qty
       AND ((_side = 'buy' AND o.price <= COALESCE(_price, _high_tick))
         OR (_side = 'sell' AND o.price >= COALESCE(_price, _low_tick)))
  ) THEN
    RAISE EXCEPTION 'SELF_TRADE';
  END IF;

  -- The trader's own side must be covered, including what their other
  -- resting orders already promise (no spoofed depth).
  INSERT INTO public.portfolios (user_id, cash_balance) VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  IF _side = 'buy' THEN
    SELECT p.cash_balance INTO _cash FROM public.portfolios p WHERE p.user_id = _user_id;
    _open := public.open_buy_reserve(_user_id);
    IF COALESCE(_cash, 0) < _order_notional + _open THEN RAISE EXCEPTION 'INSUFFICIENT_CASH'; END IF;
  ELSE
    SELECT ps.qty INTO _held FROM public.positions ps
     WHERE ps.user_id = _user_id AND ps.symbol = _brand.symbol;
    SELECT COALESCE(sum(o.qty - o.filled_qty), 0) INTO _open
      FROM public.orders o
     WHERE o.user_id = _user_id AND o.symbol = _brand.symbol AND o.side = 'sell'
       AND o.status IN ('open', 'partial');
    IF COALESCE(_held, 0) < _qty + _open THEN RAISE EXCEPTION 'INSUFFICIENT_QTY'; END IF;
  END IF;

  -- Defensive: resting buys on a non_halal symbol must never fill.
  IF public.current_shariah_status(_brand.symbol) = 'non_halal' THEN
    PERFORM public.cancel_shariah_blocked_buys(_brand.symbol, NULL);
  END IF;

  -- created_at is taken after the locks, so time priority follows the real
  -- arrival order.
  INSERT INTO public.orders
    (user_id, symbol, asset_class, side, type, qty, price, status, filled_qty, filled_notional, created_at, updated_at)
  VALUES
    (_user_id, _brand.symbol, _brand.asset_class, _side, _type, _qty, _price, 'open', 0, 0,
     clock_timestamp(), clock_timestamp())
  RETURNING * INTO my_order;

  -- Lock every portfolio this order may touch, in user_id order, before any
  -- cash moves: two matchers on different symbols with overlapping traders
  -- then always lock in the same order and cannot deadlock.
  SELECT array_agg(DISTINCT o.user_id) INTO _parties
    FROM public.orders o
   WHERE o.symbol = _brand.symbol AND o.side = _opposite
     AND o.status IN ('open', 'partial') AND o.user_id <> _user_id
     AND o.price IS NOT NULL AND o.qty > o.filled_qty
     AND ((_side = 'buy' AND o.price <= COALESCE(_price, _high_tick))
       OR (_side = 'sell' AND o.price >= COALESCE(_price, _low_tick)));
  _parties := array_append(COALESCE(_parties, ARRAY[]::uuid[]), _user_id);
  INSERT INTO public.portfolios (user_id, cash_balance)
  SELECT u, 0 FROM unnest(_parties) AS u
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.portfolios p
   WHERE p.user_id = ANY(_parties)
   ORDER BY p.user_id
     FOR UPDATE;

  remaining := _qty;
  FOR cand IN
    SELECT * FROM public.orders o
     WHERE o.symbol = _brand.symbol AND o.side = _opposite
       AND o.status IN ('open', 'partial') AND o.user_id <> _user_id
       AND o.price IS NOT NULL AND o.qty > o.filled_qty
       AND ((_side = 'buy' AND o.price <= COALESCE(_price, _high_tick))
         OR (_side = 'sell' AND o.price >= COALESCE(_price, _low_tick)))
     ORDER BY CASE WHEN _side = 'buy' THEN o.price ELSE -o.price END ASC,
              o.created_at ASC, o.id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;

    -- Legacy rows that break K1 (fractional remaining units, off-tick price)
    -- are taken off the book, never filled.
    IF (cand.qty - cand.filled_qty) <> trunc(cand.qty - cand.filled_qty)
       OR cand.price <> round(cand.price, 2) THEN
      PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_invalid_order', NULL);
      CONTINUE;
    END IF;

    -- An investor whose trading access was withdrawn cannot trade, not even
    -- as the passive side.
    IF NOT public.has_role(cand.user_id, 'trader') THEN
      PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_inactive_trader', NULL);
      CONTINUE;
    END IF;

    trade_qty := LEAST(remaining, cand.qty - cand.filled_qty);
    CONTINUE WHEN trade_qty <= 0;
    -- Resting price, kept inside the band. A resting ask below the band
    -- trades at the band floor, a resting bid above it at the band ceiling:
    -- never worse than the resting order's limit, never outside the band.
    -- Both are on the 0.01 tick; scale 2 keeps trades.price and the ledger
    -- notes readable ('@ 360.00', not the division's 16 decimals).
    trade_price := round(CASE WHEN _side = 'buy' THEN GREATEST(cand.price, _low_tick)
                              ELSE LEAST(cand.price, _high_tick) END, 2);
    -- One rounded amount, debited and credited identically.
    notional := round(trade_qty * trade_price, 2);

    IF _side = 'buy' THEN
      buyer := _user_id; seller := cand.user_id;
    ELSE
      buyer := cand.user_id; seller := _user_id;
    END IF;

    SELECT p.cash_balance INTO buyer_cash FROM public.portfolios p WHERE p.user_id = buyer FOR UPDATE;
    IF COALESCE(buyer_cash, 0) < notional THEN
      IF buyer = cand.user_id THEN
        PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_insufficient_cash', NULL);
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'INSUFFICIENT_CASH';
    END IF;

    SELECT ps.qty INTO seller_qty FROM public.positions ps
     WHERE ps.user_id = seller AND ps.symbol = _brand.symbol FOR UPDATE;
    IF COALESCE(seller_qty, 0) < trade_qty THEN
      IF seller = cand.user_id THEN
        PERFORM public.engine_cancel_order(cand.id, 'engine_cancel_insufficient_qty', NULL);
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'INSUFFICIENT_QTY';
    END IF;

    INSERT INTO public.trades
      (symbol, asset_class, qty, price, buy_order_id, sell_order_id, buyer_id, seller_id, created_at)
    VALUES
      (_brand.symbol, _brand.asset_class, trade_qty, trade_price,
       CASE WHEN _side = 'buy' THEN my_order.id ELSE cand.id END,
       CASE WHEN _side = 'buy' THEN cand.id ELSE my_order.id END,
       buyer, seller, clock_timestamp());

    PERFORM public.apply_trade_position(buyer, _brand.symbol, _brand.asset_class, 'buy', trade_qty, trade_price);
    PERFORM public.apply_trade_position(seller, _brand.symbol, _brand.asset_class, 'sell', trade_qty, trade_price);

    PERFORM public.post_cash_movement(buyer, 'order_buy', -notional,
      CASE WHEN _side = 'buy' THEN my_order.id ELSE cand.id END,
      'buy ' || trade_qty || ' ' || _brand.symbol || ' @ ' || trade_price, buyer);
    PERFORM public.post_cash_movement(seller, 'order_sell', notional,
      CASE WHEN _side = 'buy' THEN cand.id ELSE my_order.id END,
      'sell ' || trade_qty || ' ' || _brand.symbol || ' @ ' || trade_price, seller);

    -- phase 3: filled_price is the resting order's exact average fill
    -- price, from the sum of its fill amounts (no running re-rounding).
    UPDATE public.orders o
       SET filled_qty = cand.filled_qty + trade_qty,
           filled_notional = cand.filled_notional + notional,
           filled_price = round((cand.filled_notional + notional) / (cand.filled_qty + trade_qty), 4),
           status = CASE WHEN cand.filled_qty + trade_qty >= cand.qty THEN 'filled' ELSE 'partial' END,
           filled_at = clock_timestamp(),
           updated_at = clock_timestamp()
     WHERE o.id = cand.id;

    remaining := remaining - trade_qty;
    total_qty := total_qty + trade_qty;
    total_cost := total_cost + notional;
  END LOOP;

  IF remaining <= 0 THEN
    final_status := 'filled';
  ELSIF _type = 'market' THEN
    -- K3: a market order never rests; the unfilled remainder is cancelled.
    final_status := 'cancelled';
  ELSIF total_qty > 0 THEN
    final_status := 'partial';
  ELSE
    final_status := 'open';
  END IF;

  UPDATE public.orders o
     SET filled_qty = total_qty,
         filled_notional = total_cost,
         status = final_status,
         filled_price = CASE WHEN total_qty > 0 THEN round(total_cost / total_qty, 4) ELSE NULL END,
         filled_at = CASE WHEN total_qty > 0 THEN clock_timestamp() ELSE NULL END,
         updated_at = clock_timestamp()
   WHERE o.id = my_order.id;

  IF final_status = 'cancelled' THEN
    INSERT INTO public.orders_audit
      (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by, previous_status, new_status)
    VALUES (my_order.id, 'market_unfilled', _qty, NULL, total_qty, NULL, NULL, 'open', 'cancelled');
  END IF;

  RETURN QUERY SELECT my_order.id, total_qty,
    CASE WHEN total_qty > 0 THEN round(total_cost / total_qty, 4) ELSE NULL::numeric END,
    final_status;
END;
$$;
REVOKE ALL ON FUNCTION public.match_order(uuid, text, text, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_order(uuid, text, text, text, text, numeric, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 1c) public_instrument: the band it shows is the engine's (same signature).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_instrument(_slug text)
RETURNS TABLE (
  symbol text,
  slug text,
  name_ar text,
  name_en text,
  sector text,
  asset_class text,
  company_id uuid,
  company_name_ar text,
  company_name_en text,
  reference_price numeric,
  last_price numeric,
  change_24h_pct numeric,
  volume_24h_units numeric,
  volume_24h_value numeric,
  trades_24h bigint,
  last_trade_at timestamptz,
  shariah_status text,
  day_open numeric,
  day_high numeric,
  day_low numeric,
  band_reference numeric,
  band_low numeric,
  band_high numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH target AS (
    SELECT b.id, b.symbol
      FROM public.brands b
     WHERE b.published
       AND char_length(btrim(COALESCE(_slug, ''))) BETWEEN 1 AND 64
       AND (lower(b.slug) = lower(btrim(_slug)) OR b.symbol = upper(btrim(_slug)))
     ORDER BY (lower(b.slug) = lower(btrim(_slug))) DESC, b.symbol
     LIMIT 1
  ), ref AS (
    -- The engine's anchor: previous close, else the listing reference price.
    SELECT public.band_reference_price(t.symbol) AS price FROM target t
  ), day AS (
    SELECT (array_agg(tr.price ORDER BY tr.created_at ASC, tr.id ASC))[1] AS open_price,
           max(tr.price) AS high_price,
           min(tr.price) AS low_price
      FROM public.trades tr
      JOIN target t ON t.symbol = tr.symbol
     WHERE tr.created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh')
  )
  SELECT r.symbol, r.slug, r.name_ar, r.name_en, r.sector, r.asset_class,
         r.company_id, r.company_name_ar, r.company_name_en,
         r.reference_price, r.last_price, r.change_24h_pct,
         r.volume_24h_units, r.volume_24h_value, r.trades_24h, r.last_trade_at,
         r.shariah_status,
         day.open_price, day.high_price, day.low_price,
         ref.price,
         -- Exactly the limit prices match_order accepts (band_tick_edges).
         CASE WHEN ref.price > 0 THEN (public.band_tick_edges(ref.price)).low_tick END,
         CASE WHEN ref.price > 0 THEN (public.band_tick_edges(ref.price)).high_tick END
    FROM target t
    CROSS JOIN LATERAL public.market_instrument_rows(NULL, t.id) r
    CROSS JOIN ref
    CROSS JOIN day;
$$;

-- ---------------------------------------------------------------------------
-- 2) Submissions: brand units only; the brand cap (same trigger as
--    20260926101000 plus these two checks on INSERT).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _api boolean := COALESCE(current_setting('role', true), 'none') IN ('anon', 'authenticated', 'service_role');
  _control boolean := COALESCE(current_setting('app.submission_control', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Symbols are stored as the market shows them (upper case, trimmed).
    NEW.symbol := upper(btrim(COALESCE(NEW.symbol, '')));
    IF NEW.symbol !~ '^[A-Z0-9._-]{1,32}$' THEN
      RAISE EXCEPTION 'INVALID_SYMBOL';
    END IF;
    -- Fixer (phase 3): the market lists brand units only (Terms of use).
    NEW.asset_class := COALESCE(NULLIF(btrim(NEW.asset_class), ''), 'brand');
    IF NEW.asset_class <> 'brand' THEN
      RAISE EXCEPTION 'ASSET_CLASS_NOT_SUPPORTED';
    END IF;
    -- The 30-brand cap per company (enforce_brand_cap) covers submissions
    -- of a symbol the company does not hold yet.
    IF NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.symbol = NEW.symbol AND b.company_id = NEW.company_id)
       AND public.company_brand_count(NEW.company_id) >= 30 THEN
      RAISE EXCEPTION 'BRAND_CAP_REACHED';
    END IF;
    NEW.status := 'pending';
    NEW.reviewer_id := NULL;
    NEW.review_reason := NULL;
    NEW.reviewed_at := NULL;
    NEW.shariah_decision_id := NULL;
    NEW.listing_decided_by := NULL;
    NEW.listing_decided_at := NULL;
    NEW.listing_reason := NULL;
    NEW.submitted_at := now();
    NEW.created_at := now();
    NEW.updated_at := now();
    IF auth.uid() IS NOT NULL THEN
      NEW.submitted_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  -- Decision fields change only through review_submission / approve_listing
  -- / decline_listing when the caller is an API role.
  IF _api AND NOT _control AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id
    OR NEW.review_reason IS DISTINCT FROM OLD.review_reason
    OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    OR NEW.shariah_decision_id IS DISTINCT FROM OLD.shariah_decision_id
    OR NEW.listing_decided_by IS DISTINCT FROM OLD.listing_decided_by
    OR NEW.listing_decided_at IS DISTINCT FROM OLD.listing_decided_at
    OR NEW.listing_reason IS DISTINCT FROM OLD.listing_reason
  ) THEN
    RAISE EXCEPTION 'SUBMISSION_TRANSITION_FORBIDDEN';
  END IF;

  -- The submitted content and ownership are frozen for API callers.
  IF _api AND (
       NEW.id IS DISTINCT FROM OLD.id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
    OR NEW.symbol IS DISTINCT FROM OLD.symbol
    OR NEW.asset_class IS DISTINCT FROM OLD.asset_class
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'SUBMISSION_TRANSITION_FORBIDDEN';
  END IF;

  -- Allowed transitions, for every caller (migrations included).
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'pending'  AND NEW.status IN ('approved', 'rejected'))
      OR (OLD.status = 'approved' AND NEW.status IN ('listed', 'rejected'))
    ) THEN
      RAISE EXCEPTION 'SUBMISSION_TRANSITION_FORBIDDEN';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) set_instrument_published (same as 20260926101000 plus the asset class).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_instrument_published(_symbol text, _published boolean, _actor_id uuid)
RETURNS TABLE(brand_id uuid, company_id uuid, symbol text, published boolean, changed boolean, cancelled_orders integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sym text := upper(btrim(COALESCE(_symbol, '')));
  _brand public.brands;
  _n integer := 0;
  _changed boolean;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;
  IF _published IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF _sym !~ '^[A-Z0-9._-]{1,32}$' THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- Symbol lock first (as every order path), then the rows.
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

  SELECT * INTO _brand FROM public.brands b WHERE b.symbol = _sym FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  IF _published THEN
    -- The reference price anchors the band; 0 means no admin has set one.
    IF NOT (_brand.reference_price > 0 AND _brand.reference_price <= 1000000000) THEN
      RAISE EXCEPTION 'INVALID_PRICE';
    END IF;
    -- Every listed instrument carries a ruling in force.
    IF public.current_shariah_status(_brand.symbol) IS NULL THEN
      RAISE EXCEPTION 'SHARIAH_RULING_REQUIRED';
    END IF;
    -- Fixer (phase 3): only brand units are listed (approve_listing lists
    -- through this function too).
    IF _brand.asset_class IS DISTINCT FROM 'brand' THEN
      RAISE EXCEPTION 'ASSET_CLASS_NOT_SUPPORTED';
    END IF;
  END IF;

  _changed := _brand.published IS DISTINCT FROM _published;
  IF _changed THEN
    PERFORM set_config('app.listing_control', 'on', true);
    UPDATE public.brands b SET published = _published WHERE b.id = _brand.id;
    PERFORM set_config('app.listing_control', 'off', true);
  END IF;

  IF NOT _published THEN
    _n := public.close_instrument_orders(_brand.symbol, 'delisted', _actor_id);
  END IF;

  -- Lifecycle: listing a Shariah-approved submission's instrument lists it.
  IF _published AND _brand.source_submission_id IS NOT NULL THEN
    PERFORM set_config('app.submission_control', 'on', true);
    UPDATE public.product_submissions s
       SET status = 'listed', listing_decided_by = _actor_id, listing_decided_at = now()
     WHERE s.id = _brand.source_submission_id
       AND s.company_id IS NOT DISTINCT FROM _brand.company_id
       AND s.status = 'approved';
    PERFORM set_config('app.submission_control', 'off', true);
  END IF;

  INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
  VALUES (
    _actor_id, _brand.company_id,
    CASE WHEN _published THEN 'brand.publish' ELSE 'brand.unpublish' END,
    'brands', _brand.id::text,
    jsonb_build_object('symbol', _brand.symbol, 'changed', _changed, 'cancelledOrders', _n)
  );

  RETURN QUERY SELECT _brand.id, _brand.company_id, _brand.symbol, _published, _changed, _n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) admin_pending_activations (same signature as 20260926100100): an
--    account with no role that never signed in is labelled as such
--    ('no_role_never_signed_in'), not as "signed in without a role".
-- ---------------------------------------------------------------------------
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
  pending_company_invitations integer,
  on_hold boolean
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
    SELECT u.id AS uid, lower(u.email) AS addr, u.created_at AS u_created, u.email_confirmed_at IS NOT NULL AS confirmed,
           -- auth.users.last_sign_in_at (read through jsonb: absent on stripped-down auth schemas).
           (to_jsonb(u) ->> 'last_sign_in_at') IS NOT NULL AS signed_in
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
           CASE WHEN a.signed_in THEN 'no_role' ELSE 'no_role_never_signed_in' END,
           NULL::uuid, NULL::text, NULL::timestamptz
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
           WHERE lower(ci.email) = r.addr AND ci.status = 'pending' AND ci.expires_at > now()),
         (r.uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.launch_review_holds h
                                         WHERE h.user_id = r.uid AND h.resolved_at IS NULL))
    FROM cand r
   ORDER BY COALESCE(r.rat, r.u_created) DESC NULLS LAST, r.addr
   LIMIT GREATEST(1, LEAST(COALESCE(_limit, 200), 500));
END;
$$;

-- EXECUTE privileges of the functions above: see
-- 20260926101700_fixer_execute_allowlist.sql.


-- ============================================================================
-- >>> 20260926101650_fixer_access_request_siblings.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- Phase 3 fixer, round 1: duplicate access requests.
--
-- The same person can submit the request form more than once (the per-address
-- limit is 3 a day). Each submission gets its own reference code, and the
-- applicant may keep any of them, so a submission is never refused or merged
-- (answering "you already applied" would tell anyone who types an address
-- whether that person applied). Instead, when a request is decided (approved
-- or rejected), every other PENDING request for the same thing from the same
-- address takes the same decision in the same transaction:
--   - investor requests: same address;
--   - requests to join a company (search / link): same address and company;
--   - requests for a new company: same address and the same company names.
-- Before, the duplicates stayed in the review queue after the decision, and
-- approving one later sent a second decision e-mail.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.access_requests_close_siblings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The sibling UPDATE below fires this trigger again: nothing left to do.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('approved', 'rejected') THEN
    RETURN NULL;
  END IF;

  UPDATE public.access_requests s
     SET status = NEW.status,
         reviewed_by = NEW.reviewed_by,
         reviewed_at = NEW.reviewed_at,
         rejection_reason = NEW.rejection_reason,
         resulting_invitation_id = NEW.resulting_invitation_id
   WHERE s.id <> NEW.id
     AND s.status = 'pending'
     AND lower(btrim(s.email)) = lower(btrim(NEW.email))
     AND CASE
           WHEN NEW.join_method = 'investor' THEN s.join_method = 'investor'
           WHEN NEW.join_method IN ('search', 'link') THEN
             s.join_method IN ('search', 'link') AND s.requested_company_id = NEW.requested_company_id
           WHEN NEW.join_method = 'new_company' THEN
             s.join_method = 'new_company'
             AND lower(btrim(s.new_company_name_ar)) = lower(btrim(NEW.new_company_name_ar))
             AND lower(btrim(s.new_company_name_en)) = lower(btrim(NEW.new_company_name_en))
           ELSE false
         END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.access_requests_close_siblings() FROM PUBLIC, anon, authenticated;

-- The trigger is (re)created after the backfill below, which must not close
-- requests submitted after a decision.
DROP TRIGGER IF EXISTS trg_access_requests_close_siblings ON public.access_requests;

-- Requests decided before this migration: close the pending duplicates of an
-- already decided request the same way (oldest decision first).
DO $$
DECLARE
  r public.access_requests;
  n integer := 0;
  k integer;
BEGIN
  FOR r IN
    SELECT * FROM public.access_requests d
     WHERE d.status IN ('approved', 'rejected')
     ORDER BY d.reviewed_at NULLS FIRST, d.created_at
  LOOP
    UPDATE public.access_requests s
       SET status = r.status,
           reviewed_by = r.reviewed_by,
           reviewed_at = r.reviewed_at,
           rejection_reason = r.rejection_reason,
           resulting_invitation_id = r.resulting_invitation_id
     WHERE s.id <> r.id
       AND s.status = 'pending'
       AND s.created_at <= COALESCE(r.reviewed_at, r.created_at)
       AND lower(btrim(s.email)) = lower(btrim(r.email))
       AND CASE
             WHEN r.join_method = 'investor' THEN s.join_method = 'investor'
             WHEN r.join_method IN ('search', 'link') THEN
               s.join_method IN ('search', 'link') AND s.requested_company_id = r.requested_company_id
             WHEN r.join_method = 'new_company' THEN
               s.join_method = 'new_company'
               AND lower(btrim(s.new_company_name_ar)) = lower(btrim(r.new_company_name_ar))
               AND lower(btrim(s.new_company_name_en)) = lower(btrim(r.new_company_name_en))
             ELSE false
           END;
    GET DIAGNOSTICS k = ROW_COUNT;
    n := n + k;
  END LOOP;
  IF n > 0 THEN
    RAISE NOTICE 'closed % pending duplicate access request(s) of already decided requests', n;
  END IF;
END $$;

CREATE TRIGGER trg_access_requests_close_siblings
  AFTER UPDATE OF status ON public.access_requests
  FOR EACH ROW EXECUTE FUNCTION public.access_requests_close_siblings();


-- ============================================================================
-- >>> 20260926101700_fixer_execute_allowlist.sql
-- ============================================================================
SET LOCAL search_path = public, extensions;
-- ============================================================================
-- EXECUTE privileges for the functions of the phase 3 fixer migrations
-- (20260926101500, 20260926101600, 20260926101650), following the explicit allow-list
-- pattern of 20260924100600_function_execute_audit.sql: Supabase's default
-- privileges grant EXECUTE on every new public function to anon and
-- authenticated, so each one is revoked from PUBLIC, anon and authenticated.
-- Server functions get service_role; trigger functions get no grant at all.
-- Functions that do not exist on a given database are skipped.
-- ============================================================================
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    -- 20260926101500_fixer_security_hardening.sql
    'public.rate_limit_bucket(timestamptz, integer)',
    'public.check_rate_limit(text, integer, integer)',
    'public.set_reference_price(text, numeric, uuid)',
    'public.update_shariah_decision(uuid, uuid, text, text, text)',
    'public.get_symbol_market_stats(text)',
    'public.get_market_snapshot(text[])',
    -- 20260926101600_fixer_market_rules.sql
    'public.band_tick_edges(numeric)',
    'public.company_brand_count(uuid)',
    'public.match_order(uuid, text, text, text, text, numeric, numeric)',
    'public.set_instrument_published(text, boolean, uuid)',
    'public.admin_pending_activations(uuid, integer)'
  ];
  trigger_only text[] := ARRAY[
    'public.user_watch_rows_guard()',
    'public.brands_guard()',
    'public.audit_name_change()',
    'public.log_shariah_decision_update()',
    'public.product_submissions_guard()',
    'public.enforce_brand_cap()',
    -- 20260926101650_fixer_access_request_siblings.sql
    'public.access_requests_close_siblings()'
  ];
  -- Browser-visible market data (anon + authenticated), unchanged audience.
  public_read text[] := ARRAY[
    'public.public_instrument(text)'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY trigger_only LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
  FOREACH fn IN ARRAY public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', fn);
  END LOOP;
END $$;


-- ============================================================================
-- Record the versions in the migration history (when the table exists) and
-- report.
-- ============================================================================
SET LOCAL search_path = public, extensions;
DO $launch_bundle_post$
DECLARE
  _has_name boolean;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
                      AND column_name = 'name') INTO _has_name;
    IF _has_name THEN
      INSERT INTO supabase_migrations.schema_migrations (version, name)
      SELECT v.version, v.name FROM (VALUES
    ('20260924100000', 'rls_helper_grants'),
    ('20260924100100', 'lock_down_table_privileges'),
    ('20260924100200', 'trading_engine_hardening'),
    ('20260924100300', 'cash_opening_balance'),
    ('20260924100400', 'governance_lockdown'),
    ('20260924100500', 'fix_approve_access_request'),
    ('20260924100600', 'function_execute_audit'),
    ('20260924100700', 'market_integrity_fixes'),
    ('20260924100800', 'governance_and_listing_fixes'),
    ('20260924100900', 'legacy_state_cleanup'),
    ('20260925100000', 'public_market_data'),
    ('20260925100100', 'instrument_publish_control'),
    ('20260925100200', 'delist_demo_instruments'),
    ('20260925110000', 'listing_control_and_public_reads'),
    ('20260925110100', 'unlist_unconfirmed_instruments'),
    ('20260926100000', 'invitation_lifecycle'),
    ('20260926100100', 'investor_access_requests'),
    ('20260926100200', 'onboarding_execute_allowlist'),
    ('20260926100300', 'company_members_invitation_only'),
    ('20260926100500', 'exact_cost_basis'),
    ('20260926100600', 'engine_money_fixes'),
    ('20260926100700', 'reference_price_rules'),
    ('20260926100800', 'portfolio_valuation'),
    ('20260926100900', 'money_execute_allowlist'),
    ('20260926101000', 'submission_lifecycle'),
    ('20260926101100', 'public_candles_cost'),
    ('20260926101200', 'integrity_report'),
    ('20260926101500', 'fixer_security_hardening'),
    ('20260926101600', 'fixer_market_rules'),
    ('20260926101650', 'fixer_access_request_siblings'),
    ('20260926101700', 'fixer_execute_allowlist')
      ) AS v(version, name)
      ON CONFLICT (version) DO NOTHING;
    ELSE
      INSERT INTO supabase_migrations.schema_migrations (version)
      SELECT v.version FROM (VALUES
    ('20260924100000', 'rls_helper_grants'),
    ('20260924100100', 'lock_down_table_privileges'),
    ('20260924100200', 'trading_engine_hardening'),
    ('20260924100300', 'cash_opening_balance'),
    ('20260924100400', 'governance_lockdown'),
    ('20260924100500', 'fix_approve_access_request'),
    ('20260924100600', 'function_execute_audit'),
    ('20260924100700', 'market_integrity_fixes'),
    ('20260924100800', 'governance_and_listing_fixes'),
    ('20260924100900', 'legacy_state_cleanup'),
    ('20260925100000', 'public_market_data'),
    ('20260925100100', 'instrument_publish_control'),
    ('20260925100200', 'delist_demo_instruments'),
    ('20260925110000', 'listing_control_and_public_reads'),
    ('20260925110100', 'unlist_unconfirmed_instruments'),
    ('20260926100000', 'invitation_lifecycle'),
    ('20260926100100', 'investor_access_requests'),
    ('20260926100200', 'onboarding_execute_allowlist'),
    ('20260926100300', 'company_members_invitation_only'),
    ('20260926100500', 'exact_cost_basis'),
    ('20260926100600', 'engine_money_fixes'),
    ('20260926100700', 'reference_price_rules'),
    ('20260926100800', 'portfolio_valuation'),
    ('20260926100900', 'money_execute_allowlist'),
    ('20260926101000', 'submission_lifecycle'),
    ('20260926101100', 'public_candles_cost'),
    ('20260926101200', 'integrity_report'),
    ('20260926101500', 'fixer_security_hardening'),
    ('20260926101600', 'fixer_market_rules'),
    ('20260926101650', 'fixer_access_request_siblings'),
    ('20260926101700', 'fixer_execute_allowlist')
      ) AS v(version, name)
      ON CONFLICT (version) DO NOTHING;
    END IF;
  END IF;
  RAISE NOTICE 'LAUNCH_BUNDLE_DONE files=31 first=20260924100000 last=20260926101700';
END
$launch_bundle_post$;

COMMIT;
