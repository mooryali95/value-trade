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
