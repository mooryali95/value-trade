-- ============================================================================
-- Portfolio valuation read (phase 3, H1).
--
-- portfolio_positions(user): every position of one investor with what the
-- server needs to value it from real data, in one snapshot:
--   * qty, cost_basis (exact, see 20260926100500), avg_price (derived);
--   * reserved_qty: units promised to the investor's resting sell orders
--     (what match_order counts against holdings), so "available to sell"
--     = qty - reserved_qty;
--   * last_price / last_trade_at: the instrument's latest execution, listed
--     or not (the same "last price" as the public market board);
--   * band_reference: band_reference_price() (previous close, else the
--     listing reference price; 0 when an unlisted instrument has none);
--   * published, slug and names of the instrument, when it exists.
-- The server values a position at last_price, else band_reference (shown
-- as a reference price), else not at all (no market price); never at the
-- investor's own average cost.
-- SECURITY DEFINER, EXECUTE service_role only: the server calls it with the
-- verified user id of the caller.
-- ============================================================================

DROP FUNCTION IF EXISTS public.portfolio_positions(uuid);
CREATE FUNCTION public.portfolio_positions(_user_id uuid)
RETURNS TABLE (
  symbol text,
  asset_class text,
  qty numeric,
  cost_basis numeric,
  avg_price numeric,
  reserved_qty numeric,
  last_price numeric,
  last_trade_at timestamptz,
  band_reference numeric,
  published boolean,
  slug text,
  name_ar text,
  name_en text,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.symbol,
         p.asset_class,
         p.qty,
         p.cost_basis,
         p.avg_price,
         COALESCE((SELECT sum(o.qty - o.filled_qty)
                     FROM public.orders o
                    WHERE o.user_id = p.user_id
                      AND o.symbol = p.symbol
                      AND o.side = 'sell'
                      AND o.status IN ('open', 'partial')), 0),
         lt.price,
         lt.created_at,
         COALESCE(public.band_reference_price(p.symbol), 0),
         COALESCE(b.published, false),
         b.slug,
         b.name_ar,
         b.name_en,
         p.updated_at
    FROM public.positions p
    LEFT JOIN public.brands b ON b.symbol = upper(btrim(p.symbol))
    LEFT JOIN LATERAL (
      SELECT t.price, t.created_at
        FROM public.trades t
       WHERE t.symbol = upper(btrim(p.symbol))
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 1
    ) lt ON true
   WHERE p.user_id = _user_id
   ORDER BY p.symbol
   LIMIT 1000;
$$;
REVOKE ALL ON FUNCTION public.portfolio_positions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portfolio_positions(uuid) TO service_role;
