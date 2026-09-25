-- ============================================================================
-- Exact cost basis for positions (phase 3, money correctness M1/M2).
--
-- Until now a position kept only avg_price numeric(18,4) and every buy
-- rebuilt the average from the ROUNDED stored average, so the cost implied
-- by the position (qty * avg_price) drifted from the cash actually paid:
-- buying 100,000 @ 10.01 then 200,000 @ 10.00 costs 3,001,000.00 in the
-- ledger, but qty * avg_price (avg 10.0033) says 3,000,990.00.
--
--   1) positions.cost_basis numeric(24,2): the exact cost, in cents, of the
--      units held (average-cost method). avg_price is now derived from it
--      (round(cost_basis / qty, 4)) and is for display only.
--   2) apply_trade_position (same signature) maintains it:
--        buy : cost_basis += round(qty * price, 2)   (= the ledger debit)
--        sell: cost_basis -= round(cost_basis * sold / held, 2)
--              (pro rata of the remaining cost, rounded half away from
--              zero on the cent; selling the whole position removes the
--              whole remaining cost). src/lib/trading/realized.ts replays
--              the same arithmetic, so for any history
--                realized P/L + (market value - cost_basis)
--                  = sell proceeds - buy costs + market value
--              to the cent.
--   3) Existing rows: replayed exactly from unit_issuances + trades when that
--      history explains the position's quantity; otherwise (pre-engine
--      fills) round(qty * avg_price, 2), never negative.
--   4) unit_issuances.created_at is stamped with clock_timestamp() at insert
--      when it takes the column default (issue_units inserts the row after
--      applying the position, under the user and symbol locks; trades are
--      already stamped with clock_timestamp()), so ordering issuances and
--      trades by time replays them in the order the engine applied them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Exact money helpers (pure, IMMUTABLE). Amounts carry at most 2 decimals,
-- quantities at most 4 (positions.qty is numeric(18,4)); both are scaled to
-- integers so the division is exact before the single rounding step.
-- ---------------------------------------------------------------------------

-- round(_amount * _part / _whole, 2), half away from zero, computed exactly.
CREATE OR REPLACE FUNCTION public.money_prorata(_amount numeric, _part numeric, _whole numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  a numeric := round(_amount * 100);     -- cents
  p numeric := round(_part * 10000);     -- 1/10000 units
  w numeric := round(_whole * 10000);
  n numeric;
  q numeric;
BEGIN
  IF _amount IS NULL OR _part IS NULL OR _whole IS NULL OR w = 0 THEN
    RETURN NULL;
  END IF;
  n := a * p;
  -- |n / w| rounded half away from zero: floor((2|n| + |w|) / (2|w|)).
  q := div(2 * abs(n) + abs(w), 2 * abs(w));
  IF sign(n) * sign(w) < 0 THEN q := -q; END IF;
  RETURN round(q / 100, 2);
END;
$$;
REVOKE ALL ON FUNCTION public.money_prorata(numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.money_prorata(numeric, numeric, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 1) positions.cost_basis
-- ---------------------------------------------------------------------------
ALTER TABLE public.positions ADD COLUMN IF NOT EXISTS cost_basis numeric(24,2);

COMMENT ON COLUMN public.positions.cost_basis IS
  'Exact cost of the units held (average-cost method), in the trading currency, to the cent. Buys add round(qty*price,2); sells remove round(cost_basis*sold/held,2); avg_price = round(cost_basis/qty,4) is derived from it.';

-- 3) Backfill existing rows (only rows not filled yet, so re-running is a
-- no-op).
DO $$
DECLARE
  pos record;
  ev record;
  q numeric;
  c numeric;
  ok boolean;
BEGIN
  FOR pos IN
    SELECT p.id, p.user_id, upper(p.symbol) AS symbol, p.qty, p.avg_price
      FROM public.positions p
     WHERE p.cost_basis IS NULL
  LOOP
    q := 0; c := 0; ok := true;
    FOR ev IN
      SELECT e.side, e.qty, e.price
        FROM (
          SELECT i.created_at, 0 AS rank, i.id, 'buy'::text AS side, i.qty, i.price
            FROM public.unit_issuances i
           WHERE i.user_id = pos.user_id AND i.symbol = pos.symbol
          UNION ALL
          SELECT t.created_at, 1, t.id, 'buy', t.qty, t.price
            FROM public.trades t
           WHERE t.buyer_id = pos.user_id AND t.symbol = pos.symbol
          UNION ALL
          SELECT t.created_at, 2, t.id, 'sell', t.qty, t.price
            FROM public.trades t
           WHERE t.seller_id = pos.user_id AND t.symbol = pos.symbol
        ) e
       ORDER BY e.created_at, e.rank, e.id
    LOOP
      IF ev.qty IS NULL OR ev.price IS NULL OR ev.qty <= 0 OR ev.price <= 0 THEN
        ok := false; EXIT;
      END IF;
      IF ev.side = 'buy' THEN
        q := q + ev.qty;
        c := c + round(ev.qty * ev.price, 2);
      ELSE
        IF ev.qty > q THEN ok := false; EXIT; END IF;
        IF ev.qty = q THEN
          c := 0;
        ELSE
          c := c - public.money_prorata(c, ev.qty, q);
        END IF;
        q := q - ev.qty;
      END IF;
    END LOOP;

    IF ok AND q = pos.qty AND q > 0 THEN
      UPDATE public.positions SET cost_basis = c WHERE id = pos.id;
    ELSE
      UPDATE public.positions
         SET cost_basis = GREATEST(round(COALESCE(pos.qty, 0) * COALESCE(pos.avg_price, 0), 2), 0)
       WHERE id = pos.id;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.positions ALTER COLUMN cost_basis SET NOT NULL;
ALTER TABLE public.positions DROP CONSTRAINT IF EXISTS positions_cost_basis_nonnegative;
ALTER TABLE public.positions ADD CONSTRAINT positions_cost_basis_nonnegative CHECK (cost_basis >= 0);

-- A row inserted without a cost basis (fixtures, manual repairs by the
-- owner) gets qty * avg_price, like the legacy backfill.
CREATE OR REPLACE FUNCTION public.positions_cost_basis_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.cost_basis IS NULL THEN
    NEW.cost_basis := GREATEST(round(COALESCE(NEW.qty, 0) * COALESCE(NEW.avg_price, 0), 2), 0);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.positions_cost_basis_default() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_positions_cost_basis_default ON public.positions;
CREATE TRIGGER trg_positions_cost_basis_default BEFORE INSERT ON public.positions
  FOR EACH ROW EXECUTE FUNCTION public.positions_cost_basis_default();

-- ---------------------------------------------------------------------------
-- 2) apply_trade_position: same signature and callers (match_order,
--    issue_units); maintains cost_basis exactly and derives avg_price.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_trade_position(
  _user_id uuid, _symbol text, _asset_class text, _side text, _qty numeric, _price numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur_qty numeric;
  cur_cost numeric;
  new_qty numeric;
  new_cost numeric;
BEGIN
  IF _qty IS NULL OR _qty = 'NaN'::numeric OR _qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  IF _price IS NULL OR _price = 'NaN'::numeric OR _price <= 0 THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;

  SELECT p.qty, p.cost_basis INTO cur_qty, cur_cost
    FROM public.positions p
   WHERE p.user_id = _user_id AND p.symbol = _symbol
     FOR UPDATE;
  cur_qty := COALESCE(cur_qty, 0);
  cur_cost := COALESCE(cur_cost, 0);

  IF _side = 'buy' THEN
    new_qty := cur_qty + _qty;
    -- Exactly what the ledger debits for this fill.
    new_cost := cur_cost + round(_qty * _price, 2);
  ELSIF _side = 'sell' THEN
    new_qty := cur_qty - _qty;
    IF new_qty < 0 THEN RAISE EXCEPTION 'INSUFFICIENT_QTY'; END IF;
    IF new_qty = 0 THEN
      new_cost := 0;
    ELSE
      new_cost := cur_cost - public.money_prorata(cur_cost, _qty, cur_qty);
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_SIDE';
  END IF;

  IF new_qty = 0 THEN
    DELETE FROM public.positions p WHERE p.user_id = _user_id AND p.symbol = _symbol;
  ELSE
    INSERT INTO public.positions (user_id, symbol, asset_class, qty, avg_price, cost_basis)
    VALUES (_user_id, _symbol, _asset_class, new_qty, round(new_cost / new_qty, 4), new_cost)
    ON CONFLICT (user_id, symbol)
    DO UPDATE SET qty = EXCLUDED.qty,
                  avg_price = EXCLUDED.avg_price,
                  cost_basis = EXCLUDED.cost_basis,
                  updated_at = now();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_trade_position(uuid, text, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_trade_position(uuid, text, text, text, numeric, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Issuance time = the moment the units were credited.
-- ---------------------------------------------------------------------------
-- Only a row that takes the column default (now(), the transaction start)
-- is re-stamped; a row inserted with an explicit historical time (e.g. the
-- owner restoring the go-live archive) keeps it.
CREATE OR REPLACE FUNCTION public.unit_issuances_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.created_at IS NULL OR NEW.created_at = now() THEN
    NEW.created_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.unit_issuances_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_unit_issuances_stamp ON public.unit_issuances;
CREATE TRIGGER trg_unit_issuances_stamp BEFORE INSERT ON public.unit_issuances
  FOR EACH ROW EXECUTE FUNCTION public.unit_issuances_stamp();
