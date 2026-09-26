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
