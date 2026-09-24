-- ============================================================================
-- Value Unit (وحدة القيمة): GO-LIVE TRADING RESET
--
-- NOT A MIGRATION. Do not copy this file into supabase/migrations.
-- The owner runs it ONCE, by hand, in the Lovable Cloud SQL editor, right
-- before the first real investor is invited (see supabase/ops/README.md).
--
-- WHAT IT DOES (one statement, so it is all or nothing)
--   1. Refuses to run when it has already run: if any table
--      go_live_archive.archive_20260925_* exists it stops with
--      GO_LIVE_RESET_ALREADY_RUN and changes nothing. A second run can
--      therefore never wipe real trading data or overwrite the archive.
--   2. Refuses to run when no platform admin exists (GO_LIVE_RESET_NO_ADMIN):
--      the audit_log entry is attributed to the oldest platform admin.
--   3. Locks the trading tables against concurrent writes (waits at most
--      15 s for running transactions, then fails and changes nothing).
--   4. Archives full copies of these tables into the private schema
--      go_live_archive (no access for anon, authenticated or service_role;
--      not exposed through the API):
--        portfolios, positions, orders, orders_audit, trades, cash_ledger,
--        unit_issuances, price_alerts
--      as go_live_archive.archive_20260925_<table>, and checks that every
--      archive has exactly as many rows as its source.
--   5. Resets the trading state to a clean launch:
--        - cancels every open or partially filled order,
--        - deletes every row of cash_ledger, trades, orders_audit, orders,
--          positions and unit_issuances,
--        - sets every portfolios.cash_balance to 0 (portfolio rows are kept).
--   6. Verifies the ledger invariants the database security suite checks
--      (cash balance = sum of the ledger for every portfolio, positions =
--      issued + bought - sold for every holder, no negative cash or units)
--      and aborts, changing nothing, if any of them fails.
--   7. Writes one audit_log row (action 'go_live_reset', entity
--      'trading_state') with the archived row counts and what was reset.
--
-- WHAT IT KEEPS: users (auth.users, profiles), roles (user_roles),
-- companies and memberships, brands (including reference prices and the
-- published flag), product submissions and documents, Shariah decisions and
-- their audit trail, audit_log, access requests and invitations, price
-- alerts and watch lists, notification settings, launch_review_holds.
-- After the reset every investor has cash 0 and no units: activate and fund
-- investors (admin deposit), then issue units, as in the README checklist.
-- Open launch_review_holds rows describe balances this reset zeroes; review
-- and resolve them before re-activating those accounts.
--
-- HOW TO RESTORE FROM THE ARCHIVE (only if the reset must be undone, before
-- any new trading activity; run as one transaction in the SQL editor):
--
--   BEGIN;
--   -- the published-instrument trigger would refuse orders on instruments
--   -- that are no longer published; restored rows are historical.
--   ALTER TABLE public.orders DISABLE TRIGGER trg_orders_require_published;
--   DELETE FROM public.cash_ledger;
--   DELETE FROM public.trades;
--   DELETE FROM public.orders_audit;
--   DELETE FROM public.orders;
--   DELETE FROM public.positions;
--   DELETE FROM public.unit_issuances;
--   INSERT INTO public.orders         SELECT * FROM go_live_archive.archive_20260925_orders;
--   INSERT INTO public.orders_audit   SELECT * FROM go_live_archive.archive_20260925_orders_audit;
--   INSERT INTO public.trades         SELECT * FROM go_live_archive.archive_20260925_trades;
--   INSERT INTO public.cash_ledger    SELECT * FROM go_live_archive.archive_20260925_cash_ledger;
--   INSERT INTO public.positions      SELECT * FROM go_live_archive.archive_20260925_positions;
--   INSERT INTO public.unit_issuances SELECT * FROM go_live_archive.archive_20260925_unit_issuances;
--   UPDATE public.portfolios p SET cash_balance = a.cash_balance
--     FROM go_live_archive.archive_20260925_portfolios a WHERE a.user_id = p.user_id;
--   ALTER TABLE public.orders ENABLE TRIGGER trg_orders_require_published;
--   COMMIT;
--
--   Order matters (orders before the rows that reference them). SELECT *
--   relies on the archive having the same columns in the same order as the
--   live table; if a later migration added columns, list them explicitly.
--   Rows of users deleted since the reset must be left out (foreign keys).
--   Orders come back exactly as archived, including those that were resting
--   when the reset ran.
--
-- The archive can be dropped once it is no longer needed:
--   DROP SCHEMA go_live_archive CASCADE;
-- (after that this script would run again, so keep the schema until the
-- script itself is retired).
-- ============================================================================

BEGIN;

DO $go_live_reset$
DECLARE
  v_tables constant text[] := ARRAY[
    'portfolios', 'positions', 'orders', 'orders_audit', 'trades',
    'cash_ledger', 'unit_issuances', 'price_alerts'
  ];
  v_table text;
  v_archive text;
  v_source_rows bigint;
  v_archive_rows bigint;
  v_archived jsonb := '{}'::jsonb;
  v_actor uuid;
  v_open_orders bigint;
  v_portfolios_zeroed bigint;
  v_cash_before numeric;
  v_units_before numeric;
  v_bad bigint;
BEGIN
  -- 1. Run once only.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_tables
     WHERE schemaname = 'go_live_archive' AND tablename LIKE 'archive\_20260925\_%'
  ) THEN
    RAISE EXCEPTION 'GO_LIVE_RESET_ALREADY_RUN'
      USING DETAIL = 'go_live_archive.archive_20260925_* tables already exist, so the reset has already run. Nothing was changed.',
            HINT = 'Restore or drop the archive deliberately (see the header of supabase/ops/go_live_reset.sql) before running it again.';
  END IF;

  -- 2. Attribution for the audit_log row.
  SELECT ur.user_id INTO v_actor
    FROM public.user_roles ur
   WHERE ur.role = 'platform_admin'
   ORDER BY ur.created_at, ur.user_id
   LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'GO_LIVE_RESET_NO_ADMIN'
      USING DETAIL = 'No user holds the platform_admin role. Nothing was changed.',
            HINT = 'Grant platform_admin to the operator account first.';
  END IF;

  -- 3. No trading while the reset runs.
  PERFORM pg_catalog.set_config('lock_timeout', '15s', true);
  LOCK TABLE public.portfolios, public.positions, public.orders, public.orders_audit,
             public.trades, public.cash_ledger, public.unit_issuances, public.price_alerts
    IN SHARE ROW EXCLUSIVE MODE;

  SELECT coalesce(sum(cash_balance), 0) INTO v_cash_before FROM public.portfolios;
  SELECT coalesce(sum(qty), 0) INTO v_units_before FROM public.positions;

  -- 4. Archive (private schema, no API access).
  CREATE SCHEMA IF NOT EXISTS go_live_archive;
  REVOKE ALL ON SCHEMA go_live_archive FROM PUBLIC, anon, authenticated, service_role;
  FOREACH v_table IN ARRAY v_tables LOOP
    v_archive := 'archive_20260925_' || v_table;
    EXECUTE format('CREATE TABLE go_live_archive.%I AS TABLE public.%I', v_archive, v_table);
    EXECUTE format('REVOKE ALL ON TABLE go_live_archive.%I FROM PUBLIC, anon, authenticated, service_role', v_archive);
    EXECUTE format('ALTER TABLE go_live_archive.%I ENABLE ROW LEVEL SECURITY', v_archive);
    EXECUTE format('COMMENT ON TABLE go_live_archive.%I IS %L', v_archive,
      'Full copy of public.' || v_table || ' taken by supabase/ops/go_live_reset.sql at ' || now()::text);
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_source_rows;
    EXECUTE format('SELECT count(*) FROM go_live_archive.%I', v_archive) INTO v_archive_rows;
    IF v_source_rows <> v_archive_rows THEN
      RAISE EXCEPTION 'GO_LIVE_RESET_ARCHIVE_MISMATCH'
        USING DETAIL = format('%s has %s rows but its archive has %s. Nothing was changed.', v_table, v_source_rows, v_archive_rows);
    END IF;
    v_archived := v_archived || jsonb_build_object(v_table, v_archive_rows);
  END LOOP;

  -- 5. Clean launch state.
  UPDATE public.orders SET status = 'cancelled' WHERE status IN ('open', 'partial');
  GET DIAGNOSTICS v_open_orders = ROW_COUNT;

  DELETE FROM public.cash_ledger;      -- references orders (ref_order_id)
  DELETE FROM public.trades;           -- references orders
  DELETE FROM public.orders_audit;     -- references orders
  DELETE FROM public.orders;
  DELETE FROM public.positions;
  DELETE FROM public.unit_issuances;
  UPDATE public.portfolios SET cash_balance = 0 WHERE cash_balance <> 0;
  GET DIAGNOSTICS v_portfolios_zeroed = ROW_COUNT;

  -- 6. The invariants of supabase/tests/security.sh must hold.
  SELECT count(*) INTO v_bad
    FROM public.portfolios p
   WHERE p.cash_balance < 0
      OR p.cash_balance <> (SELECT coalesce(sum(l.amount), 0) FROM public.cash_ledger l WHERE l.user_id = p.user_id);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'GO_LIVE_RESET_CASH_INVARIANT' USING DETAIL = format('%s portfolios do not match their ledger. Nothing was changed.', v_bad);
  END IF;

  WITH moves AS (
    SELECT user_id, symbol, qty FROM public.unit_issuances
    UNION ALL SELECT buyer_id, symbol, qty FROM public.trades
    UNION ALL SELECT seller_id, symbol, -qty FROM public.trades
  ), expected AS (
    SELECT user_id, symbol, sum(qty) AS qty FROM moves GROUP BY 1, 2
  )
  SELECT count(*) INTO v_bad
    FROM expected e FULL JOIN public.positions p USING (user_id, symbol)
   WHERE coalesce(e.qty, 0) <> coalesce(p.qty, 0) OR coalesce(p.qty, 0) < 0;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'GO_LIVE_RESET_UNITS_INVARIANT' USING DETAIL = format('%s positions do not match issuances and trades. Nothing was changed.', v_bad);
  END IF;

  -- 7. Audit trail.
  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_actor, 'go_live_reset', 'trading_state', 'archive_20260925',
    jsonb_build_object(
      'description', 'Go-live reset: trading state archived to go_live_archive.archive_20260925_* and cleared (orders, trades, positions, cash ledger, unit issuances deleted; every cash balance set to 0). Users, roles, companies, brands, submissions, Shariah decisions and audit_log kept.',
      'archive_schema', 'go_live_archive',
      'archived_rows', v_archived,
      'open_orders_cancelled', v_open_orders,
      'portfolios_zeroed', v_portfolios_zeroed,
      'cash_total_before', v_cash_before,
      'units_total_before', v_units_before,
      'executed_as', session_user,
      'script', 'supabase/ops/go_live_reset.sql'
    )
  );

  RAISE NOTICE 'GO_LIVE_RESET_DONE archived=% open_orders_cancelled=% portfolios_zeroed=%',
    v_archived, v_open_orders, v_portfolios_zeroed;
END
$go_live_reset$;

COMMIT;
