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
