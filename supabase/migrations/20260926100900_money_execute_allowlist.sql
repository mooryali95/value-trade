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
