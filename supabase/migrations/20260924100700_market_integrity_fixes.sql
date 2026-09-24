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
