-- ============================================================================
-- EXECUTE privileges for the functions of the phase 3 fixer migrations
-- (20260926101500, 20260926101600), following the explicit allow-list
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
    'public.enforce_brand_cap()'
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
