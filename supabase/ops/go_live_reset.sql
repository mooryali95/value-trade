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
--        unit_issuances, price_alerts, symbol_watchers, brands
--      as go_live_archive.archive_20260925_<table>, and checks that every
--      archive has exactly as many rows as its source.
--   5. Resets the trading state to a clean launch:
--        - cancels every open or partially filled order,
--        - deletes every row of cash_ledger, trades, orders_audit, orders,
--          positions and unit_issuances,
--        - sets every portfolios.cash_balance to 0 (portfolio rows are kept),
--        - deletes the legacy demo instruments: every instrument that is off
--          the market, belongs to no company and did not come from a product
--          submission (the early builds seeded them, some named after real
--          listed issuers), with the price alerts and watch-list rows on
--          their symbols. Their Shariah rulings stay on record.
--   6. Verifies the ledger invariants the database security suite checks
--      (cash balance = sum of the ledger for every portfolio, positions =
--      issued + bought - sold for every holder, no negative cash or units)
--      and aborts, changing nothing, if any of them fails. When the launch
--      bundle is applied, public.integrity_report() must also pass (every
--      check except published_ready, which is only reported as a notice
--      GO_LIVE_RESET_NOTE: a listed instrument without a ruling or price is
--      an admin task, not a reason to keep the old trading state).
--   7. Writes one audit_log row (action 'go_live_reset', entity
--      'trading_state') with the archived row counts and what was reset.
--
-- Columns added at launch (positions.cost_basis, orders.filled_notional)
-- are archived with their tables like every other column.
--
-- WHAT IT KEEPS: users (auth.users, profiles), roles (user_roles),
-- companies and memberships, every listed instrument and every instrument
-- of a company or a submission (including reference prices and the
-- published flag), product submissions and documents, Shariah decisions and
-- their audit trail, audit_log, access requests and invitations, price
-- alerts and watch lists (except those on removed demo instruments),
-- notification settings, launch_review_holds.
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
--   -- the removed demo instruments (legacy prices predate the price rules)
--   ALTER TABLE public.brands DISABLE TRIGGER trg_brands_reference_price;
--   INSERT INTO public.brands SELECT * FROM go_live_archive.archive_20260925_brands a
--    WHERE NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = a.id);
--   ALTER TABLE public.brands ENABLE TRIGGER trg_brands_reference_price;
--   INSERT INTO public.price_alerts SELECT * FROM go_live_archive.archive_20260925_price_alerts a
--    WHERE NOT EXISTS (SELECT 1 FROM public.price_alerts x WHERE x.id = a.id);
--   INSERT INTO public.symbol_watchers SELECT * FROM go_live_archive.archive_20260925_symbol_watchers a
--    WHERE NOT EXISTS (SELECT 1 FROM public.symbol_watchers x WHERE x.id = a.id);
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
    'cash_ledger', 'unit_issuances', 'price_alerts', 'symbol_watchers', 'brands'
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
  v_failed_checks text;
  v_demo_removed bigint;
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
             public.trades, public.cash_ledger, public.unit_issuances, public.price_alerts,
             public.symbol_watchers, public.brands
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

  -- Legacy demo instruments (off the market, no company, no submission):
  -- nothing refers to them any more once the trading state is cleared.
  CREATE TEMP TABLE go_live_demo_symbols ON COMMIT DROP AS
    SELECT b.symbol FROM public.brands b
     WHERE NOT b.published AND b.company_id IS NULL AND b.source_submission_id IS NULL;
  DELETE FROM public.price_alerts a USING go_live_demo_symbols d WHERE upper(a.symbol) = d.symbol;
  DELETE FROM public.symbol_watchers w USING go_live_demo_symbols d WHERE upper(w.symbol) = d.symbol;
  DELETE FROM public.brands b USING go_live_demo_symbols d WHERE b.symbol = d.symbol;
  GET DIAGNOSTICS v_demo_removed = ROW_COUNT;

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

  -- 6b. The integrity report (20260926101200), when present, must agree:
  --     every ledger, unit and order check passes on the cleared state.
  --     Listing checks (published_ready) are reported, not enforced here.
  IF to_regprocedure('public.integrity_report()') IS NOT NULL THEN
    SELECT count(*), string_agg(r.check_key, ', ')
      INTO v_bad, v_failed_checks
      FROM public.integrity_report() r
     WHERE NOT r.ok AND r.check_key <> 'published_ready';
    IF v_bad <> 0 THEN
      RAISE EXCEPTION 'GO_LIVE_RESET_INTEGRITY' USING DETAIL = format('integrity_report() fails after the reset: %s. Nothing was changed.', v_failed_checks);
    END IF;
    SELECT string_agg(r.check_key, ', ') INTO v_failed_checks FROM public.integrity_report() r WHERE NOT r.ok;
    IF v_failed_checks IS NOT NULL THEN
      RAISE NOTICE 'GO_LIVE_RESET_NOTE integrity checks to review after the reset: %', v_failed_checks;
    END IF;
  END IF;

  -- 7. Audit trail.
  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_actor, 'go_live_reset', 'trading_state', 'archive_20260925',
    jsonb_build_object(
      'description', 'Go-live reset: trading state archived to go_live_archive.archive_20260925_* and cleared (orders, trades, positions, cash ledger, unit issuances deleted; every cash balance set to 0; legacy demo instruments removed). Users, roles, companies, listed and company instruments, submissions, Shariah decisions and audit_log kept.',
      'archive_schema', 'go_live_archive',
      'archived_rows', v_archived,
      'open_orders_cancelled', v_open_orders,
      'portfolios_zeroed', v_portfolios_zeroed,
      'demo_instruments_removed', v_demo_removed,
      'cash_total_before', v_cash_before,
      'units_total_before', v_units_before,
      'executed_as', session_user,
      'script', 'supabase/ops/go_live_reset.sql'
    )
  );

  RAISE NOTICE 'GO_LIVE_RESET_DONE archived=% open_orders_cancelled=% portfolios_zeroed=% demo_instruments_removed=%',
    v_archived, v_open_orders, v_portfolios_zeroed, v_demo_removed;
END
$go_live_reset$;

COMMIT;
