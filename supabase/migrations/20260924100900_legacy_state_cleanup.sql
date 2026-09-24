-- ============================================================================
-- Legacy state cleanup before launch (launch audit, fixer round 1).
--
-- Before 20260924100100 users could write orders, positions and portfolios
-- directly (backdated or fractional resting orders, bids at 10x the price,
-- minted units, self-set cash). The lockdown stops new writes; this
-- migration deals with rows that already exist.
--
--   1) Every order still resting (open/partial) when this migration runs was
--      accepted under the old rules (it ships in the same release as the
--      hardened engine, 20260924100200). It is closed as 'cancelled' with an
--      orders_audit 'legacy_close' row. Nothing else changes: no cash or
--      units move. Owners can restore such an order, which re-places it as a
--      NEW order through every engine check (whole units, tick, band,
--      Shariah, buying power, holdings).
--   2) Accounts whose balances cannot be explained are put on hold for a
--      manual review instead of being silently legitimized:
--        * cash: the 'opening balance reconciliation' booked by
--          20260924100300 exceeds what was credited outside the ledger by
--          the platform itself: 100,000.00 (the old column default) plus the
--          result of the pre-engine fills whose cash placeOrder wrote
--          straight to the balance before 2026-08-12 (valued as the old app
--          filled them; sales count only when the units reconcile);
--        * units: a position is larger than issuances + units bought -
--          units sold + legacy fills that predate the trades table.
--        A legacy fill counts only if the old app could have written it
--        (positive quantity and price); a fabricated row explains nothing.
--      A held account loses the 'trader' role (it can no longer trade; its
--      resting orders were closed above) and gets a row in
--      launch_review_holds (service role only). Balances are NOT changed. A
--      platform admin reviews the row and re-activates the investor (or
--      corrects the balance) afterwards.
-- Idempotent: re-running it closes nothing new and adds no duplicate hold.
-- ============================================================================

-- 1) Close legacy resting orders.
WITH legacy AS (
  SELECT o.id, o.qty, o.price, o.status
    FROM public.orders o
   WHERE o.status IN ('open', 'partial')
   FOR UPDATE
), upd AS (
  UPDATE public.orders o
     SET status = 'cancelled', updated_at = clock_timestamp()
    FROM legacy
   WHERE o.id = legacy.id
  RETURNING o.id
)
INSERT INTO public.orders_audit
  (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by, previous_status, new_status)
SELECT legacy.id, 'legacy_close', legacy.qty, legacy.price, legacy.qty, legacy.price, NULL, legacy.status, 'cancelled'
  FROM legacy JOIN upd ON upd.id = legacy.id;

-- 2) Review holds.
CREATE TABLE IF NOT EXISTS public.launch_review_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('unexplained_cash', 'unexplained_units')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  had_trader_role boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  UNIQUE (user_id, reason)
);
ALTER TABLE public.launch_review_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.launch_review_holds FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.launch_review_holds TO service_role;

-- One statement: the candidates, the hold rows and the role revocation all
-- see the same snapshot (had_trader_role is the state before this run), and
-- only holds inserted now revoke a role, so a re-run never undoes an admin's
-- re-activation after review.
WITH fills AS (
  -- Fills of the pre-engine placeOrder (until 2026-08-20): marked filled at
  -- once at the investor's own price, with no trade row. Only rows that app
  -- could have written explain anything: buy or sell, 0 < qty <= 1,000,000,
  -- filled_qty 0 (the column came later) or at most qty, a positive fill
  -- price. Investors could write orders directly, so a fabricated negative,
  -- zero or NaN quantity or price (NaN compares greater than any number and
  -- poisons every sum it enters) would otherwise explain self-set cash or
  -- minted units; such a row explains nothing, as if it did not exist.
  SELECT o.id, o.user_id, o.symbol,
         CASE WHEN o.side = 'buy' THEN 1 ELSE -1 END
         * CASE WHEN o.filled_qty > 0 THEN o.filled_qty ELSE o.qty END AS units,
         COALESCE(o.filled_price, o.price) AS price
    FROM public.orders o
   WHERE o.status = 'filled'
     AND o.side IN ('buy', 'sell')
     AND o.qty > 0 AND o.qty <= 1000000
     AND o.filled_qty >= 0 AND o.filled_qty <= o.qty
     AND COALESCE(o.filled_price, o.price) > 0
     AND COALESCE(o.filled_price, o.price) < 'Infinity'::numeric
     AND NOT EXISTS (SELECT 1 FROM public.trades t WHERE t.buy_order_id = o.id OR t.sell_order_id = o.id)
), moves AS (
  -- Units nobody issued or sold to the holder.
  SELECT i.user_id, i.symbol, i.qty FROM public.unit_issuances i
  UNION ALL SELECT t.buyer_id, t.symbol, t.qty FROM public.trades t
  UNION ALL SELECT t.seller_id, t.symbol, -t.qty FROM public.trades t
  UNION ALL SELECT f.user_id, f.symbol, f.units FROM fills f
), explained AS (
  SELECT m.user_id, m.symbol, sum(m.qty) AS qty FROM moves m GROUP BY m.user_id, m.symbol
), backed AS (
  -- Symbols whose units reconcile exactly: a pre-engine sale there sold
  -- units the investor really held.
  SELECT e.user_id, e.symbol
    FROM explained e
    LEFT JOIN public.positions p ON p.user_id = e.user_id AND p.symbol = e.symbol
   WHERE e.qty >= 0 AND e.qty = COALESCE(p.qty, 0)
), fill_cash AS (
  -- Cash of pre-engine fills that never reached the ledger: before
  -- 2026-08-12 placeOrder wrote portfolios.cash_balance directly, so that
  -- profit or loss is part of the opening balance reconciliation (later
  -- fills posted a ledger row referencing the order). Purchases always
  -- count; sales only on backed symbols, so a fabricated sale cannot
  -- explain self-set cash. Tolerance: the old app rounded each balance write
  -- to the cent and priced on the unrounded limit (orders keep 4 decimals).
  SELECT f.user_id,
         sum(-f.units * f.price) AS amount,
         sum(0.01 + 0.00005 * abs(f.units)) AS tolerance
    FROM fills f
   WHERE NOT EXISTS (SELECT 1 FROM public.cash_ledger l WHERE l.ref_order_id = f.id)
     AND (f.units > 0 OR EXISTS (SELECT 1 FROM backed b WHERE b.user_id = f.user_id AND b.symbol = f.symbol))
   GROUP BY f.user_id
), cash_holds AS (
  -- Cash credited outside the ledger beyond the old 100,000 default plus
  -- the result of the unledgered pre-engine fills (with a cent per ledger
  -- row: ledger amounts were not rounded to the cent before 20260924100300).
  SELECT r.user_id, 'unexplained_cash'::text AS reason,
         jsonb_build_object('reconciliation_amount', r.amount,
                            'explained_amount', round(100000 + COALESCE(fc.amount, 0), 2)) AS detail
    FROM (SELECT l.user_id, sum(l.amount) AS amount
            FROM public.cash_ledger l
           WHERE l.note = 'opening balance reconciliation' AND l.kind = 'adjustment'
           GROUP BY l.user_id) r
    LEFT JOIN fill_cash fc ON fc.user_id = r.user_id
   WHERE r.amount > 100000 + COALESCE(fc.amount, 0) + COALESCE(fc.tolerance, 0)
                    + 0.01 * (SELECT count(*) FROM public.cash_ledger l WHERE l.user_id = r.user_id)
), unit_holds AS (
  SELECT p.user_id, 'unexplained_units'::text AS reason,
         jsonb_object_agg(p.symbol, jsonb_build_object('held', p.qty, 'explained', COALESCE(e.qty, 0))) AS detail
    FROM public.positions p
    LEFT JOIN explained e ON e.user_id = p.user_id AND e.symbol = p.symbol
   WHERE p.qty > COALESCE(e.qty, 0)
   GROUP BY p.user_id
), held AS (
  INSERT INTO public.launch_review_holds (user_id, reason, detail, had_trader_role)
  SELECT c.user_id, c.reason, c.detail, public.has_role(c.user_id, 'trader')
    FROM (SELECT * FROM cash_holds UNION ALL SELECT * FROM unit_holds) c
  ON CONFLICT (user_id, reason) DO NOTHING
  RETURNING user_id
)
-- Suspend trading for the accounts put on hold by this run.
DELETE FROM public.user_roles ur
 WHERE ur.role = 'trader'
   AND ur.user_id IN (SELECT h.user_id FROM held h);
