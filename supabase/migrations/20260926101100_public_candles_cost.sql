-- ============================================================================
-- public_candles: cheap small calls, bounded large ones (phase 3, agent D;
-- phase 2 leftover).
--
-- Measured on 1,000,000 trades of one published symbol, as anon:
--   * every call paid ~20-45 ms of JIT compilation: the planner's row
--     estimate for the per-bucket lateral scans (5,000 rows per bucket)
--     pushed the plan cost above jit_above_cost. The function now runs with
--     jit = off (the plans are index probes; JIT never pays off here);
--   * '1d' with a large limit aggregated every trade of the returned days
--     with two ordered array_agg sorts per bucket (open / close): 380 ms for
--     200 days, 680 ms for 500. Open and close are now one index probe each
--     (first / last trade of the bucket), and high / low / volume / count
--     come from an index-only scan of the covering index below, with no sort;
--   * '1d' is capped at 366 buckets (one year of trading days with trades),
--     '1h' stays capped at 500.
-- Same signature, same columns, same results (checked against a naive
-- GROUP BY in supabase/tests/extra/d_integrity.sh).
--
-- idx_trades_symbol_time_cover (symbol, created_at, id) INCLUDE (price, qty)
-- serves both directions of the old idx_trades_symbol_time (symbol,
-- created_at DESC), which is kept: other paths name it in their plans and
-- dropping it buys little.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_trades_symbol_time_cover
  ON public.trades (symbol, created_at, id) INCLUDE (price, qty);

CREATE OR REPLACE FUNCTION public.public_candles(_symbol text, _interval text DEFAULT '1d', _limit integer DEFAULT 200)
RETURNS TABLE (
  bucket_start timestamptz,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  close_price numeric,
  volume_units numeric,
  trade_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET jit = off
AS $$
  WITH RECURSIVE target AS (
    SELECT b.symbol,
           -- Asia/Riyadh has no DST: a trading day is exactly 24 hours.
           CASE WHEN _interval = '1h' THEN interval '1 hour' ELSE interval '24 hours' END AS step,
           LEAST(GREATEST(COALESCE(_limit, 200), 1), CASE WHEN _interval = '1h' THEN 500 ELSE 366 END) AS cap
      FROM public.brands b
     WHERE b.published
       AND _interval IN ('1h', '1d')
       AND char_length(btrim(COALESCE(_symbol, ''))) BETWEEN 1 AND 64
       AND b.symbol = upper(btrim(_symbol))
  ), buckets AS (
    -- The newest bucket that has a trade, then each older one: one probe
    -- per bucket, at most `cap` buckets.
    SELECT nb.bucket, 1 AS n
      FROM target
      CROSS JOIN LATERAL (
        SELECT t.created_at FROM public.trades t
         WHERE t.symbol = target.symbol
         ORDER BY t.created_at DESC
         LIMIT 1
      ) latest
      CROSS JOIN LATERAL (
        SELECT CASE WHEN _interval = '1h'
                    THEN date_trunc('hour', latest.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                    ELSE date_trunc('day', latest.created_at AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'
               END AS bucket
      ) nb
    UNION ALL
    SELECT nb.bucket, bk.n + 1
      FROM buckets bk
      CROSS JOIN target
      CROSS JOIN LATERAL (
        SELECT t.created_at FROM public.trades t
         WHERE t.symbol = target.symbol AND t.created_at < bk.bucket
         ORDER BY t.created_at DESC
         LIMIT 1
      ) prev
      CROSS JOIN LATERAL (
        SELECT CASE WHEN _interval = '1h'
                    THEN date_trunc('hour', prev.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                    ELSE date_trunc('day', prev.created_at AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'
               END AS bucket
      ) nb
     WHERE bk.n < target.cap
  )
  SELECT bk.bucket, o.price, a.high_price, a.low_price, c.price, a.volume_units, a.trade_count
    FROM buckets bk
    CROSS JOIN target
    CROSS JOIN LATERAL (
      -- First trade of the bucket (time, then id: the old tie-break).
      SELECT t.price FROM public.trades t
       WHERE t.symbol = target.symbol AND t.created_at >= bk.bucket AND t.created_at < bk.bucket + target.step
       ORDER BY t.created_at ASC, t.id ASC
       LIMIT 1
    ) o
    CROSS JOIN LATERAL (
      SELECT t.price FROM public.trades t
       WHERE t.symbol = target.symbol AND t.created_at >= bk.bucket AND t.created_at < bk.bucket + target.step
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 1
    ) c
    CROSS JOIN LATERAL (
      SELECT max(t.price) AS high_price,
             min(t.price) AS low_price,
             sum(t.qty) AS volume_units,
             count(*) AS trade_count
        FROM public.trades t
       WHERE t.symbol = target.symbol
         AND t.created_at >= bk.bucket
         AND t.created_at < bk.bucket + target.step
    ) a
   ORDER BY bk.bucket ASC;
$$;

-- Same audience as before (20260925110000): browser-visible market data.
DO $$
BEGIN
  IF to_regprocedure('public.public_candles(text, text, integer)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.public_candles(text, text, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.public_candles(text, text, integer) TO anon, authenticated, service_role;
  END IF;
END $$;
