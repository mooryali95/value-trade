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
