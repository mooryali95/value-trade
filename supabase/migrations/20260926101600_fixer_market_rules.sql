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
