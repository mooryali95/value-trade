ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS filled_qty numeric NOT NULL DEFAULT 0;

CREATE TABLE public.trades (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL,
  asset_class text NOT NULL DEFAULT 'brand',
  qty numeric NOT NULL CHECK (qty > 0),
  price numeric NOT NULL CHECK (price > 0),
  buy_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  sell_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.trades TO authenticated;
GRANT ALL ON public.trades TO service_role;

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trades_own_read" ON public.trades
  FOR SELECT TO authenticated
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

CREATE INDEX idx_trades_symbol_time ON public.trades (symbol, created_at DESC);
CREATE INDEX idx_orders_book ON public.orders (symbol, side, status, price, created_at);

-- Applies one side of a fill to the trader's position (no cash here).
CREATE OR REPLACE FUNCTION public.apply_trade_position(
  _user_id uuid, _symbol text, _asset_class text, _side text, _qty numeric, _price numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur_qty numeric := 0;
  cur_avg numeric := 0;
  new_qty numeric;
  new_avg numeric;
BEGIN
  SELECT qty, avg_price INTO cur_qty, cur_avg
  FROM public.positions WHERE user_id = _user_id AND symbol = _symbol FOR UPDATE;
  cur_qty := COALESCE(cur_qty, 0);
  cur_avg := COALESCE(cur_avg, 0);

  IF _side = 'buy' THEN
    new_qty := cur_qty + _qty;
    new_avg := CASE WHEN new_qty = 0 THEN 0
                    ELSE ((cur_qty * cur_avg) + (_qty * _price)) / new_qty END;
  ELSE
    new_qty := cur_qty - _qty;
    IF new_qty < 0 THEN RAISE EXCEPTION 'INSUFFICIENT_QTY'; END IF;
    new_avg := CASE WHEN new_qty = 0 THEN 0 ELSE cur_avg END;
  END IF;

  IF new_qty = 0 THEN
    DELETE FROM public.positions WHERE user_id = _user_id AND symbol = _symbol;
  ELSE
    INSERT INTO public.positions (user_id, symbol, asset_class, qty, avg_price)
    VALUES (_user_id, _symbol, _asset_class, new_qty, new_avg)
    ON CONFLICT (user_id, symbol)
    DO UPDATE SET qty = EXCLUDED.qty, avg_price = EXCLUDED.avg_price, updated_at = now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_trade_position(uuid, text, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_trade_position(uuid, text, text, text, numeric, numeric) TO service_role;

-- Order matching engine: price priority, then time priority, partial fills.
-- Atomic per symbol via an advisory lock; positions and cash only ever move
-- as a consequence of a recorded trade.
CREATE OR REPLACE FUNCTION public.match_order(
  _user_id uuid, _symbol text, _asset_class text, _side text, _type text,
  _qty numeric, _limit_price numeric DEFAULT NULL
) RETURNS TABLE(order_id uuid, filled_qty numeric, avg_price numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  my_order public.orders;
  cand public.orders;
  remaining numeric := _qty;
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
  IF _side NOT IN ('buy','sell') THEN RAISE EXCEPTION 'INVALID_SIDE'; END IF;
  IF _type NOT IN ('limit','market') THEN RAISE EXCEPTION 'INVALID_TYPE'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  IF _type = 'limit' AND (_limit_price IS NULL OR _limit_price <= 0) THEN
    RAISE EXCEPTION 'LIMIT_PRICE_REQUIRED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('match:' || _symbol));

  INSERT INTO public.orders (user_id, symbol, asset_class, side, type, qty, price, status, filled_qty)
  VALUES (_user_id, _symbol, _asset_class, _side, _type, _qty,
          CASE WHEN _type = 'limit' THEN _limit_price ELSE NULL END, 'open', 0)
  RETURNING * INTO my_order;

  FOR cand IN
    SELECT * FROM public.orders o
     WHERE o.symbol = _symbol
       AND o.side = CASE WHEN _side = 'buy' THEN 'sell' ELSE 'buy' END
       AND o.status IN ('open','partial')
       AND o.user_id <> _user_id
       AND o.price IS NOT NULL
       AND (
         _type = 'market'
         OR (_side = 'buy' AND o.price <= _limit_price)
         OR (_side = 'sell' AND o.price >= _limit_price)
       )
     ORDER BY CASE WHEN _side = 'buy' THEN o.price ELSE -o.price END ASC, o.created_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;

    trade_qty := LEAST(remaining, cand.qty - cand.filled_qty);
    CONTINUE WHEN trade_qty <= 0;
    trade_price := cand.price;
    notional := trade_qty * trade_price;

    buyer := CASE WHEN _side = 'buy' THEN _user_id ELSE cand.user_id END;
    seller := CASE WHEN _side = 'buy' THEN cand.user_id ELSE _user_id END;

    -- Buyer must be able to pay, seller must own the quantity. A resting
    -- order that can no longer settle is cancelled instead of blocking.
    INSERT INTO public.portfolios (user_id) VALUES (buyer) ON CONFLICT (user_id) DO NOTHING;
    SELECT cash_balance INTO buyer_cash FROM public.portfolios WHERE user_id = buyer;
    IF COALESCE(buyer_cash, 0) < notional THEN
      IF buyer = cand.user_id THEN
        UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = cand.id;
        CONTINUE;
      ELSE
        EXIT;
      END IF;
    END IF;

    SELECT COALESCE(qty, 0) INTO seller_qty FROM public.positions
      WHERE user_id = seller AND symbol = _symbol;
    IF COALESCE(seller_qty, 0) < trade_qty THEN
      IF seller = cand.user_id THEN
        UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = cand.id;
        CONTINUE;
      ELSE
        EXIT;
      END IF;
    END IF;

    INSERT INTO public.trades (symbol, asset_class, qty, price, buy_order_id, sell_order_id, buyer_id, seller_id)
    VALUES (_symbol, _asset_class, trade_qty, trade_price,
            CASE WHEN _side = 'buy' THEN my_order.id ELSE cand.id END,
            CASE WHEN _side = 'buy' THEN cand.id ELSE my_order.id END,
            buyer, seller);

    PERFORM public.apply_trade_position(buyer, _symbol, _asset_class, 'buy', trade_qty, trade_price);
    PERFORM public.apply_trade_position(seller, _symbol, _asset_class, 'sell', trade_qty, trade_price);

    PERFORM public.post_cash_movement(buyer, 'order_buy', -notional, my_order.id,
      'buy ' || trade_qty || ' ' || _symbol || ' @ ' || trade_price, buyer);
    PERFORM public.post_cash_movement(seller, 'order_sell', notional, my_order.id,
      'sell ' || trade_qty || ' ' || _symbol || ' @ ' || trade_price, seller);

    UPDATE public.orders
       SET filled_qty = cand.filled_qty + trade_qty,
           filled_price = trade_price,
           status = CASE WHEN cand.filled_qty + trade_qty >= cand.qty THEN 'filled' ELSE 'partial' END,
           filled_at = CASE WHEN cand.filled_qty + trade_qty >= cand.qty THEN now() ELSE cand.filled_at END,
           updated_at = now()
     WHERE id = cand.id;

    remaining := remaining - trade_qty;
    total_qty := total_qty + trade_qty;
    total_cost := total_cost + notional;
  END LOOP;

  IF remaining <= 0 THEN
    final_status := 'filled';
  ELSIF _type = 'market' THEN
    final_status := CASE WHEN total_qty > 0 THEN 'partial' ELSE 'cancelled' END;
  ELSE
    final_status := CASE WHEN total_qty > 0 THEN 'partial' ELSE 'open' END;
  END IF;

  UPDATE public.orders
     SET filled_qty = total_qty,
         status = final_status,
         filled_price = CASE WHEN total_qty > 0 THEN total_cost / total_qty ELSE NULL END,
         filled_at = CASE WHEN total_qty > 0 THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = my_order.id;

  RETURN QUERY SELECT my_order.id, total_qty,
    CASE WHEN total_qty > 0 THEN total_cost / total_qty ELSE NULL END, final_status;
END;
$$;

REVOKE ALL ON FUNCTION public.match_order(uuid, text, text, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_order(uuid, text, text, text, text, numeric, numeric) TO service_role;

-- Public market data: last traded price for a symbol.
CREATE OR REPLACE FUNCTION public.get_symbol_last_trade(_symbol text)
RETURNS TABLE(last_price numeric, traded_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT price, created_at FROM public.trades
   WHERE symbol = _symbol ORDER BY created_at DESC LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_symbol_last_trade(text) TO anon, authenticated, service_role;

-- Public market data: aggregated order book (prices and sizes only).
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
    ORDER BY o.price DESC LIMIT _depth)
  UNION ALL
  (SELECT o.side, o.price, sum(o.qty - o.filled_qty) AS qty
     FROM public.orders o
    WHERE o.symbol = _symbol AND o.side = 'sell' AND o.status IN ('open','partial') AND o.price IS NOT NULL
    GROUP BY o.side, o.price HAVING sum(o.qty - o.filled_qty) > 0
    ORDER BY o.price ASC LIMIT _depth);
$$;

GRANT EXECUTE ON FUNCTION public.get_order_book(text, integer) TO anon, authenticated, service_role;