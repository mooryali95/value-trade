-- ============================================================================
-- Internal market data: price/change/volume derived from real orders placed
-- on the platform itself, not an external exchange feed. `orders` is
-- protected by orders_self RLS (each user sees only their own orders) --
-- these RPCs are SECURITY DEFINER so they can aggregate across *all* users
-- for a symbol, but they only ever return aggregates (price, volume, counts)
-- -- never individual order rows, user ids, or quantities per trader. Safe
-- to expose to any authenticated user, same reasoning as the public company
-- search RPCs in 20260802121145_access_requests.sql.
--
-- Cold start: a symbol with zero filled orders has no real price yet. These
-- functions return NULL in that case -- the caller (internal-provider.ts)
-- falls back to the reference price (100, matching the existing mock
-- fallback already used in mock-provider.ts / generateCandles / getBrand),
-- not this migration's job to invent a price.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_symbol_last_trade(_symbol text)
RETURNS TABLE (last_price numeric, last_traded_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT filled_price, filled_at
  FROM public.orders
  WHERE symbol = _symbol AND status = 'filled' AND filled_price IS NOT NULL
  ORDER BY filled_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_symbol_market_stats(_symbol text)
RETURNS TABLE (
  last_price numeric,
  last_traded_at timestamptz,
  change_24h_pct numeric,
  volume_24h numeric,
  trade_count_24h bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH last_trade AS (
    SELECT filled_price, filled_at
    FROM public.orders
    WHERE symbol = _symbol AND status = 'filled' AND filled_price IS NOT NULL
    ORDER BY filled_at DESC
    LIMIT 1
  ),
  price_24h_ago AS (
    SELECT filled_price
    FROM public.orders
    WHERE symbol = _symbol AND status = 'filled' AND filled_price IS NOT NULL
      AND filled_at <= now() - interval '24 hours'
    ORDER BY filled_at DESC
    LIMIT 1
  ),
  window_24h AS (
    SELECT COALESCE(SUM(qty), 0) AS vol, COUNT(*) AS cnt
    FROM public.orders
    WHERE symbol = _symbol AND status = 'filled' AND filled_price IS NOT NULL
      AND filled_at >= now() - interval '24 hours'
  )
  SELECT
    lt.filled_price,
    lt.filled_at,
    CASE
      WHEN p24.filled_price IS NOT NULL AND p24.filled_price <> 0
        THEN round(((lt.filled_price - p24.filled_price) / p24.filled_price) * 100, 2)
      ELSE NULL
    END,
    w.vol,
    w.cnt
  FROM window_24h w
  LEFT JOIN last_trade lt ON true
  LEFT JOIN price_24h_ago p24 ON true;
$$;

-- Bulk variant for listing many instruments at once without N+1 RPC calls.
CREATE OR REPLACE FUNCTION public.get_market_snapshot(_symbols text[])
RETURNS TABLE (
  symbol text,
  last_price numeric,
  change_24h_pct numeric,
  volume_24h numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH syms AS (SELECT unnest(_symbols) AS symbol),
  last_trade AS (
    SELECT DISTINCT ON (symbol) symbol, filled_price, filled_at
    FROM public.orders
    WHERE symbol = ANY(_symbols) AND status = 'filled' AND filled_price IS NOT NULL
    ORDER BY symbol, filled_at DESC
  ),
  price_24h_ago AS (
    SELECT DISTINCT ON (symbol) symbol, filled_price
    FROM public.orders
    WHERE symbol = ANY(_symbols) AND status = 'filled' AND filled_price IS NOT NULL
      AND filled_at <= now() - interval '24 hours'
    ORDER BY symbol, filled_at DESC
  ),
  window_24h AS (
    SELECT symbol, COALESCE(SUM(qty), 0) AS vol
    FROM public.orders
    WHERE symbol = ANY(_symbols) AND status = 'filled' AND filled_price IS NOT NULL
      AND filled_at >= now() - interval '24 hours'
    GROUP BY symbol
  )
  SELECT
    s.symbol,
    lt.filled_price,
    CASE
      WHEN p24.filled_price IS NOT NULL AND p24.filled_price <> 0
        THEN round(((lt.filled_price - p24.filled_price) / p24.filled_price) * 100, 2)
      ELSE NULL
    END,
    COALESCE(w.vol, 0)
  FROM syms s
  LEFT JOIN last_trade lt ON lt.symbol = s.symbol
  LEFT JOIN price_24h_ago p24 ON p24.symbol = s.symbol
  LEFT JOIN window_24h w ON w.symbol = s.symbol;
$$;

REVOKE EXECUTE ON FUNCTION public.get_symbol_last_trade(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_symbol_market_stats(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_market_snapshot(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_symbol_last_trade(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_symbol_market_stats(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_market_snapshot(text[]) TO authenticated;
