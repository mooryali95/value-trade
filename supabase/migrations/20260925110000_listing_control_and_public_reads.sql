-- ============================================================================
-- Listing control and public reads (phase 2, fixer round 1).
--
--   1) Only set_instrument_published lists or delists an instrument.
--      brands_guard refuses, for every API caller (anon, authenticated
--      including platform admins, service_role), an INSERT of a published
--      brand and any change of brands.published, unless the
--      transaction-local flag app.listing_control is 'on'. Only
--      set_instrument_published sets it (API callers cannot run
--      set_config). Migrations and the SQL editor (no API role) are not
--      affected. So approving a submission, or a direct REST update, can no
--      longer list, relist or delist an instrument, and delisting always
--      closes the resting orders.
--   2) A reference price of 0 means "not set". The column default was 100,
--      a made-up price that the approval path used; it is now 0, so a new
--      instrument cannot be published (INVALID_PRICE) until a platform
--      admin sets its reference price.
--   3) set_instrument_published: publishing also needs a Shariah ruling in
--      force (SHARIAH_RULING_REQUIRED), so every listed instrument carries
--      one; the audit_log row (brand.publish / brand.unpublish) is written
--      in the same transaction as the change and the closed orders.
--   4) product_submissions: approval requires the brand the server created
--      for the submission (source_submission_id, same company), no longer
--      a published one. The server creates it unpublished with no
--      reference price and records the approving reviewer's ruling.
--   5) shariah_decisions reads: anon reads nothing (the public pages use
--      public_shariah_rulings()); signed-in users read the rulings of
--      published instruments only, and never reviewer_id / updated_by;
--      Shariah board members and platform admins read every ruling. The
--      audit-trail policy that compared reviewer_id / updated_by now calls
--      a SECURITY DEFINER helper that answers for the caller only.
--   6) public_candles walks the buckets newest first, one index probe on
--      idx_trades_symbol_time per bucket, and aggregates only the trades
--      inside the buckets it returns, instead of grouping the symbol's whole
--      trade history on every call. Same signature, same results.
--
-- Data clean-up of existing rows is in the next migration
-- (20260925110100_unlist_unconfirmed_instruments.sql).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) brands_guard: published changes only through set_instrument_published.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brands_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- PostgREST switches every request to one of these roles; migrations and
  -- the SQL editor run as the owner with no role set.
  _api boolean := COALESCE(current_setting('role', true), 'none') IN ('anon', 'authenticated', 'service_role');
BEGIN
  -- Symbols are stored upper-case (Shariah rulings and orders match on them).
  IF TG_OP = 'INSERT' THEN
    NEW.symbol := upper(btrim(NEW.symbol));
    -- A new instrument starts off the market; set_instrument_published
    -- lists it once it has a reference price and a ruling.
    IF _api AND NEW.published THEN
      RAISE EXCEPTION 'FORBIDDEN_BRAND_FIELD';
    END IF;
    RETURN NEW;
  END IF;
  -- Listing and delisting: set_instrument_published only (it closes the
  -- resting orders and writes the audit row in the same transaction).
  IF _api AND NEW.published IS DISTINCT FROM OLD.published
     AND COALESCE(current_setting('app.listing_control', true), '') <> 'on' THEN
    RAISE EXCEPTION 'FORBIDDEN_BRAND_FIELD';
  END IF;
  -- No end-user identity: service role (server) or a migration.
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'platform_admin') THEN
    IF NEW.symbol IS DISTINCT FROM OLD.symbol THEN
      NEW.symbol := upper(btrim(NEW.symbol));
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.symbol IS DISTINCT FROM OLD.symbol
     OR NEW.slug IS DISTINCT FROM OLD.slug
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.published IS DISTINCT FROM OLD.published
     OR NEW.reference_price IS DISTINCT FROM OLD.reference_price
     OR NEW.asset_class IS DISTINCT FROM OLD.asset_class
     OR NEW.source_submission_id IS DISTINCT FROM OLD.source_submission_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'FORBIDDEN_BRAND_FIELD';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) No made-up default reference price.
-- ---------------------------------------------------------------------------
ALTER TABLE public.brands ALTER COLUMN reference_price SET DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3) Publish / unpublish: ruling required, audited atomically.
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
-- 4) product_submissions: approval needs the submission's brand (created
--    unpublished by the server), not a published one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.reviewer_id := NULL;
    NEW.review_reason := NULL;
    NEW.reviewed_at := NULL;
    NEW.submitted_at := now();
    NEW.created_at := now();
    NEW.updated_at := now();
    IF auth.uid() IS NOT NULL THEN
      NEW.submitted_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    -- A decision is final for API users; only a pending submission changes.
    IF OLD.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'SUBMISSION_NOT_PENDING';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'SUBMISSION_NOT_PENDING';
      END IF;
      -- Approval: the server has created the submission's instrument
      -- first (off the market; a platform admin lists it later).
      IF NEW.status = 'approved' AND NOT EXISTS (
        SELECT 1 FROM public.brands b
         WHERE b.source_submission_id = NEW.id AND b.company_id = NEW.company_id
      ) THEN
        RAISE EXCEPTION 'BRAND_NOT_LISTED';
      END IF;
      NEW.reviewed_at := now();
    ELSE
      NEW.reviewed_at := OLD.reviewed_at;
    END IF;
    NEW.reviewer_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) shariah_decisions reads.
-- ---------------------------------------------------------------------------
-- True when the caller recorded or last changed the decision. Answers for
-- auth.uid() only, so it reveals nothing about other users.
CREATE OR REPLACE FUNCTION public.shariah_decision_is_mine(_decision_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.shariah_decisions d
     WHERE d.id = _decision_id
       AND (d.reviewer_id = auth.uid() OR d.updated_by = auth.uid())
  );
$$;

DO $$
BEGIN
  IF to_regclass('public.shariah_decisions') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.shariah_decisions FROM anon;
    -- Table-level SELECT goes (with it every column grant), then the
    -- public columns come back: never reviewer_id / updated_by.
    REVOKE SELECT ON TABLE public.shariah_decisions FROM authenticated;
    GRANT SELECT (id, symbol, status, reason, created_at, updated_at, effective_at)
      ON public.shariah_decisions TO authenticated;

    DROP POLICY IF EXISTS "shariah_read_all" ON public.shariah_decisions;
    DROP POLICY IF EXISTS "shariah_read_published_or_reviewer" ON public.shariah_decisions;
    CREATE POLICY "shariah_read_published_or_reviewer" ON public.shariah_decisions
      FOR SELECT TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.brands b WHERE b.symbol = shariah_decisions.symbol AND b.published)
        OR public.has_role(auth.uid(), 'shariah_board')
        OR public.has_role(auth.uid(), 'platform_admin')
      );
  END IF;

  IF to_regclass('public.shariah_decision_audit') IS NOT NULL THEN
    DROP POLICY IF EXISTS "audit_read_scoped_shariah_board" ON public.shariah_decision_audit;
    CREATE POLICY "audit_read_scoped_shariah_board" ON public.shariah_decision_audit
      FOR SELECT TO authenticated
      USING (
        public.has_role(auth.uid(), 'shariah_board')
        AND (changed_by = auth.uid() OR public.shariah_decision_is_mine(decision_id))
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Candles without a full-history scan.
-- ---------------------------------------------------------------------------
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
AS $$
  WITH RECURSIVE target AS (
    SELECT b.symbol,
           -- Asia/Riyadh has no DST: a trading day is exactly 24 hours.
           CASE WHEN _interval = '1h' THEN interval '1 hour' ELSE interval '24 hours' END AS step,
           LEAST(GREATEST(COALESCE(_limit, 200), 1), 500) AS cap
      FROM public.brands b
     WHERE b.published
       AND _interval IN ('1h', '1d')
       AND char_length(btrim(COALESCE(_symbol, ''))) BETWEEN 1 AND 64
       AND b.symbol = upper(btrim(_symbol))
  ), buckets AS (
    -- The newest bucket that has a trade, then each older one: one probe
    -- of idx_trades_symbol_time per bucket, at most `cap` buckets.
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
  SELECT bk.bucket, a.open_price, a.high_price, a.low_price, a.close_price, a.volume_units, a.trade_count
    FROM buckets bk
    CROSS JOIN target
    CROSS JOIN LATERAL (
      -- Only the trades of this bucket (index range scan).
      SELECT (array_agg(t.price ORDER BY t.created_at ASC, t.id ASC))[1] AS open_price,
             max(t.price) AS high_price,
             min(t.price) AS low_price,
             (array_agg(t.price ORDER BY t.created_at DESC, t.id DESC))[1] AS close_price,
             sum(t.qty) AS volume_units,
             count(*) AS trade_count
        FROM public.trades t
       WHERE t.symbol = target.symbol
         AND t.created_at >= bk.bucket
         AND t.created_at < bk.bucket + target.step
    ) a
   ORDER BY bk.bucket ASC;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE allow list (pattern of 20260924100600_function_execute_audit.sql).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    'public.brands_guard()',
    'public.product_submissions_guard()',
    'public.set_instrument_published(text, boolean, uuid)'
  ];
  signed_in text[] := ARRAY[
    'public.shariah_decision_is_mine(uuid)'
  ];
  public_read text[] := ARRAY[
    'public.public_candles(text, text, integer)'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only || signed_in || public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY signed_in || public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
  FOREACH fn IN ARRAY public_read LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', fn);
  END LOOP;
END $$;
