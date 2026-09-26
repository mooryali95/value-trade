-- ============================================================================
-- Public market data (phase 2: a truthful market).
--
-- Read-only functions behind the public market pages (callable with the
-- publishable key, i.e. as anon, and by signed-in users). Every number comes
-- from executed trades (public.trades, written only by the matching engine)
-- and from published instruments (public.brands.published). They return
-- aggregates and instrument data only: never a user id, order id, trade id,
-- issuance holder or reviewer identity. Every result is capped.
--
--   public_market_overview(_company_id)   one row per published instrument
--   public_market_summary()               listed count, 24h trades/value, last trade
--   public_instrument(_slug)              one instrument (slug or symbol) with
--                                         today's open/high/low and the engine's band
--   public_candles(_symbol, _interval, _limit)  OHLCV buckets that have trades
--   public_recent_trades(_symbol, _limit) the trade tape (price, qty, time)
--   public_shariah_rulings()              ruling in force per published instrument
--   public_company_profile(_id)           a company linked to a published instrument
--
-- Definitions shared with the engine:
--   * last price: the most recent trade (created_at, id);
--   * 24h change: last price vs the last trade at least 24h old, else the
--     first trade inside the window (as get_symbol_market_stats);
--   * volume: each trade counted once (units = sum(qty), value = sum(qty*price));
--   * trading day: Asia/Riyadh calendar day (as band_reference_price);
--   * band: band_reference_price() ± 20%, edges on the 0.01 tick inside the
--     band, exactly the limit prices match_order accepts;
--   * Shariah status: current_shariah_status() (the ruling in force).
--
-- Also:
--   * get_order_book / get_symbol_last_trade (anon market data) now answer
--     for published instruments only;
--   * anon keeps reading shariah_decisions for the public rulings list, but
--     no longer the reviewer_id / updated_by columns (user ids).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Internal: one row of market data per published instrument, optionally of
-- one company or one instrument. SECURITY INVOKER and not executable by API
-- roles: only the SECURITY DEFINER wrappers below (running as the owner)
-- and the service role call it.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.market_instrument_rows(uuid, uuid);
CREATE FUNCTION public.market_instrument_rows(_company_id uuid DEFAULT NULL, _brand_id uuid DEFAULT NULL)
RETURNS TABLE (
  brand_id uuid,
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
  shariah_status text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT b.id, b.symbol, b.slug, b.name_ar, b.name_en, b.sector, b.asset_class,
         b.company_id, c.name_ar, c.name_en,
         b.reference_price,
         lt.price,
         CASE WHEN lt.price IS NOT NULL AND base.price IS NOT NULL AND base.price <> 0
              THEN round(((lt.price - base.price) / base.price) * 100, 2) END,
         COALESCE(w.units, 0),
         COALESCE(w.value, 0),
         COALESCE(w.cnt, 0),
         lt.created_at,
         public.current_shariah_status(b.symbol)
    FROM public.brands b
    LEFT JOIN public.companies c ON c.id = b.company_id
    LEFT JOIN LATERAL (
      SELECT t.price, t.created_at
        FROM public.trades t
       WHERE t.symbol = b.symbol
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 1
    ) lt ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        (SELECT t.price FROM public.trades t
          WHERE t.symbol = b.symbol AND t.created_at <= now() - interval '24 hours'
          ORDER BY t.created_at DESC, t.id DESC LIMIT 1),
        (SELECT t.price FROM public.trades t
          WHERE t.symbol = b.symbol AND t.created_at > now() - interval '24 hours'
          ORDER BY t.created_at ASC, t.id ASC LIMIT 1)
      ) AS price
    ) base ON true
    LEFT JOIN LATERAL (
      SELECT sum(t.qty) AS units, round(sum(t.qty * t.price), 2) AS value, count(*) AS cnt
        FROM public.trades t
       WHERE t.symbol = b.symbol AND t.created_at > now() - interval '24 hours'
    ) w ON true
   WHERE b.published
     AND (_company_id IS NULL OR b.company_id = _company_id)
     AND (_brand_id IS NULL OR b.id = _brand_id)
   ORDER BY b.symbol
   LIMIT 1000;
$$;

-- ---------------------------------------------------------------------------
-- Market board: every published instrument (at most 1000), by symbol.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_market_overview(uuid);
CREATE FUNCTION public.public_market_overview(_company_id uuid DEFAULT NULL)
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
  shariah_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.symbol, r.slug, r.name_ar, r.name_en, r.sector, r.asset_class,
         r.company_id, r.company_name_ar, r.company_name_en,
         r.reference_price, r.last_price, r.change_24h_pct,
         r.volume_24h_units, r.volume_24h_value, r.trades_24h, r.last_trade_at,
         r.shariah_status
    FROM public.market_instrument_rows(_company_id, NULL) r
   ORDER BY r.symbol;
$$;

-- ---------------------------------------------------------------------------
-- Market summary over published instruments.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_market_summary();
CREATE FUNCTION public.public_market_summary()
RETURNS TABLE (
  listed_count bigint,
  trades_24h bigint,
  volume_24h_value numeric,
  last_trade_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM public.brands b WHERE b.published),
    (SELECT count(*)
       FROM public.trades t JOIN public.brands b ON b.symbol = t.symbol AND b.published
      WHERE t.created_at > now() - interval '24 hours'),
    (SELECT COALESCE(round(sum(t.qty * t.price), 2), 0)
       FROM public.trades t JOIN public.brands b ON b.symbol = t.symbol AND b.published
      WHERE t.created_at > now() - interval '24 hours'),
    (SELECT max(lt.created_at)
       FROM public.brands b
       CROSS JOIN LATERAL (
         SELECT t.created_at FROM public.trades t
          WHERE t.symbol = b.symbol
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT 1
       ) lt
      WHERE b.published);
$$;

-- ---------------------------------------------------------------------------
-- One published instrument by slug or symbol (case-insensitive; a slug
-- match wins, as in getInstrument), with today's (Asia/Riyadh) open, high
-- and low and the price band the engine enforces right now.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_instrument(text);
CREATE FUNCTION public.public_instrument(_slug text)
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
         -- match_order: low = ref * (1 - 0.2), high = ref * (1 + 0.2); a limit
         -- price outside [low, high] is refused, so on the 0.01 tick the
         -- accepted range is [ceil(low), floor(high)].
         CASE WHEN ref.price > 0 THEN round(ceil(ref.price * (1 - 0.2) * 100) / 100, 2) END,
         CASE WHEN ref.price > 0 THEN round(floor(ref.price * (1 + 0.2) * 100) / 100, 2) END
    FROM target t
    CROSS JOIN LATERAL public.market_instrument_rows(NULL, t.id) r
    CROSS JOIN ref
    CROSS JOIN day;
$$;

-- ---------------------------------------------------------------------------
-- Candles: OHLCV per bucket that has trades, oldest first. '1h' buckets
-- are clock hours (UTC; Asia/Riyadh is a whole-hour offset without DST),
-- '1d' buckets are Asia/Riyadh days. The most recent _limit buckets
-- (default 200, at most 500). Any other interval returns nothing.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_candles(text, text, integer);
CREATE FUNCTION public.public_candles(_symbol text, _interval text DEFAULT '1d', _limit integer DEFAULT 200)
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
AS $$
  WITH target AS (
    SELECT b.symbol
      FROM public.brands b
     WHERE b.published
       AND _interval IN ('1h', '1d')
       AND char_length(btrim(COALESCE(_symbol, ''))) BETWEEN 1 AND 64
       AND b.symbol = upper(btrim(_symbol))
  ), bucketed AS (
    SELECT CASE WHEN _interval = '1h'
                THEN date_trunc('hour', t.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                ELSE date_trunc('day', t.created_at AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'
           END AS bucket,
           t.price, t.qty, t.created_at, t.id
      FROM public.trades t
      JOIN target ON target.symbol = t.symbol
  ), agg AS (
    SELECT bk.bucket,
           (array_agg(bk.price ORDER BY bk.created_at ASC, bk.id ASC))[1] AS open_price,
           max(bk.price) AS high_price,
           min(bk.price) AS low_price,
           (array_agg(bk.price ORDER BY bk.created_at DESC, bk.id DESC))[1] AS close_price,
           sum(bk.qty) AS volume_units,
           count(*) AS trade_count
      FROM bucketed bk
     GROUP BY bk.bucket
     ORDER BY bk.bucket DESC
     LIMIT LEAST(GREATEST(COALESCE(_limit, 200), 1), 500)
  )
  SELECT a.bucket, a.open_price, a.high_price, a.low_price, a.close_price, a.volume_units, a.trade_count
    FROM agg a
   ORDER BY a.bucket ASC;
$$;

-- ---------------------------------------------------------------------------
-- Trade tape: newest first, price / quantity / time only (default 20, at
-- most 50).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_recent_trades(text, integer);
CREATE FUNCTION public.public_recent_trades(_symbol text, _limit integer DEFAULT 20)
RETURNS TABLE (
  price numeric,
  qty numeric,
  traded_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.price, t.qty, t.created_at
    FROM public.trades t
    JOIN public.brands b ON b.symbol = t.symbol AND b.published
   WHERE char_length(btrim(COALESCE(_symbol, ''))) BETWEEN 1 AND 64
     AND b.symbol = upper(btrim(_symbol))
   ORDER BY t.created_at DESC, t.id DESC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- The ruling in force for every published instrument that has one: the
-- same row current_shariah_status() picks (most recent change: effective_at,
-- then created_at, then id). No reviewer identity.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_shariah_rulings();
CREATE FUNCTION public.public_shariah_rulings()
RETURNS TABLE (
  symbol text,
  slug text,
  name_ar text,
  name_en text,
  status text,
  reason text,
  effective_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.symbol, b.slug, b.name_ar, b.name_en, d.status, d.reason, d.effective_at
    FROM public.brands b
    CROSS JOIN LATERAL (
      SELECT x.status, x.reason, x.effective_at
        FROM public.shariah_decisions x
       WHERE x.symbol = upper(btrim(b.symbol))
       ORDER BY x.effective_at DESC, x.created_at DESC, x.id DESC
       LIMIT 1
    ) d
   WHERE b.published
   ORDER BY b.symbol
   LIMIT 1000;
$$;

-- ---------------------------------------------------------------------------
-- Public company card: only a company linked to at least one published
-- instrument (its instruments come from public_market_overview(_id)).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_company_profile(uuid);
CREATE FUNCTION public.public_company_profile(_id uuid)
RETURNS TABLE (
  id uuid,
  name_ar text,
  name_en text,
  sector text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.name_ar, c.name_en, c.sector
    FROM public.companies c
   WHERE c.id = _id
     AND EXISTS (SELECT 1 FROM public.brands b WHERE b.company_id = c.id AND b.published);
$$;

-- ---------------------------------------------------------------------------
-- Existing anon market data: published instruments only. Same signatures
-- and result columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_symbol_last_trade(_symbol text)
RETURNS TABLE(last_price numeric, traded_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.price, t.created_at
    FROM public.trades t
   WHERE t.symbol = _symbol
     AND EXISTS (SELECT 1 FROM public.brands b WHERE b.symbol = t.symbol AND b.published)
   ORDER BY t.created_at DESC, t.id DESC
   LIMIT 1;
$$;

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
      AND EXISTS (SELECT 1 FROM public.brands b WHERE b.symbol = o.symbol AND b.published)
    GROUP BY o.side, o.price HAVING sum(o.qty - o.filled_qty) > 0
    ORDER BY o.price DESC LIMIT LEAST(GREATEST(COALESCE(_depth, 12), 1), 50))
  UNION ALL
  (SELECT o.side, o.price, sum(o.qty - o.filled_qty) AS qty
     FROM public.orders o
    WHERE o.symbol = _symbol AND o.side = 'sell' AND o.status IN ('open','partial') AND o.price IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.brands b WHERE b.symbol = o.symbol AND b.published)
    GROUP BY o.side, o.price HAVING sum(o.qty - o.filled_qty) > 0
    ORDER BY o.price ASC LIMIT LEAST(GREATEST(COALESCE(_depth, 12), 1), 50));
$$;

-- ---------------------------------------------------------------------------
-- shariah_decisions: anon reads the public columns only (the rulings list
-- of the public site), never reviewer_id / updated_by (user ids).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.shariah_decisions') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.shariah_decisions FROM anon;
    GRANT SELECT (id, symbol, status, reason, created_at, updated_at, effective_at)
      ON public.shariah_decisions TO anon;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- EXECUTE allow list (pattern of 20260924100600_function_execute_audit.sql).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    'public.market_instrument_rows(uuid, uuid)'
  ];
  public_read text[] := ARRAY[
    'public.public_market_overview(uuid)',
    'public.public_market_summary()',
    'public.public_instrument(text)',
    'public.public_candles(text, text, integer)',
    'public.public_recent_trades(text, integer)',
    'public.public_shariah_rulings()',
    'public.public_company_profile(uuid)',
    'public.get_symbol_last_trade(text)',
    'public.get_order_book(text, integer)'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only || public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', fn);
  END LOOP;
END $$;
