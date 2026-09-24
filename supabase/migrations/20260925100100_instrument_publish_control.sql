-- ============================================================================
-- Listing control: publish / unpublish an instrument (platform admins,
-- through the server).
--
--   1) close_instrument_orders(symbol, action, actor): closes every resting
--      (open/partial) order of an instrument as 'cancelled' with an
--      orders_audit row, under the engine's per-symbol lock. No cash or
--      units move (resting orders hold no funds; buying power is computed
--      from open orders). Service role only.
--   2) set_instrument_published(symbol, published, actor): the admin switch.
--      Publishing needs a positive reference price (it anchors the band).
--      Unpublishing takes the instrument off the market and closes its
--      resting orders (orders_audit action 'delisted') in the same
--      transaction. Positions, cash and trades are never touched: holders
--      keep their units and their history. Service role only; the server
--      checks platform_admin first and this function checks it again.
--   3) A resting order can only exist on a published instrument: an order
--      inserted open/partial for an unpublished symbol is refused
--      (INSTRUMENT_NOT_FOUND). This closes the window where match_order read
--      the instrument just before it was unpublished.
--   4) A published instrument always has a reference price in
--      (0, 1,000,000,000], so the band shown to users always exists.
--      Published rows that break it are unpublished first (and their orders
--      closed) so the constraint can be validated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Close an instrument's resting orders.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_instrument_orders(_symbol text, _action text, _actor uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sym text := upper(btrim(COALESCE(_symbol, '')));
  n integer;
BEGIN
  IF _sym = '' THEN RETURN 0; END IF;
  IF _action IS NULL OR _action !~ '^[a-z_]{1,40}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  -- Same per-symbol lock as match_order / cancel_order / the Shariah
  -- trigger: no fill runs on this symbol while its book is closed.
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

  WITH closing AS (
    SELECT o.id, o.qty, o.price, o.status
      FROM public.orders o
     WHERE upper(o.symbol) = _sym AND o.status IN ('open', 'partial')
     ORDER BY o.id
       FOR UPDATE
  ), upd AS (
    UPDATE public.orders o
       SET status = 'cancelled', updated_at = clock_timestamp()
      FROM closing
     WHERE o.id = closing.id
    RETURNING o.id
  )
  INSERT INTO public.orders_audit
    (order_id, action, previous_qty, previous_price, new_qty, new_price, changed_by, previous_status, new_status)
  SELECT closing.id, _action, closing.qty, closing.price, closing.qty, closing.price, _actor, closing.status, 'cancelled'
    FROM closing JOIN upd ON upd.id = closing.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Publish / unpublish.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_instrument_published(text, boolean, uuid);
CREATE FUNCTION public.set_instrument_published(_symbol text, _published boolean, _actor_id uuid)
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

  IF _published AND NOT (_brand.reference_price > 0 AND _brand.reference_price <= 1000000000) THEN
    RAISE EXCEPTION 'INVALID_PRICE';
  END IF;

  IF _brand.published IS DISTINCT FROM _published THEN
    UPDATE public.brands b SET published = _published WHERE b.id = _brand.id;
  END IF;

  IF NOT _published THEN
    _n := public.close_instrument_orders(_brand.symbol, 'delisted', _actor_id);
  END IF;

  RETURN QUERY SELECT _brand.id, _brand.company_id, _brand.symbol, _published,
    (_brand.published IS DISTINCT FROM _published), _n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Resting orders only on published instruments.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_require_published_instrument()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('open', 'partial') AND NOT EXISTS (
    SELECT 1 FROM public.brands b WHERE b.symbol = upper(btrim(NEW.symbol)) AND b.published
  ) THEN
    RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_require_published ON public.orders;
CREATE TRIGGER trg_orders_require_published BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_require_published_instrument();

-- ---------------------------------------------------------------------------
-- 4) Published => usable reference price.
-- ---------------------------------------------------------------------------
DO $$
DECLARE s text;
BEGIN
  FOR s IN
    SELECT b.symbol FROM public.brands b
     WHERE b.published AND NOT (b.reference_price > 0 AND b.reference_price <= 1000000000)
     ORDER BY b.symbol
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('match:' || s));
    UPDATE public.brands b SET published = false WHERE b.symbol = s;
    PERFORM public.close_instrument_orders(s, 'delisted', NULL);
  END LOOP;
END $$;

ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_published_reference_price;
ALTER TABLE public.brands ADD CONSTRAINT brands_published_reference_price
  CHECK (NOT published OR (reference_price > 0 AND reference_price <= 1000000000));

-- ---------------------------------------------------------------------------
-- EXECUTE allow list (pattern of 20260924100600_function_execute_audit.sql).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    'public.close_instrument_orders(text, text, uuid)',
    'public.set_instrument_published(text, boolean, uuid)',
    'public.orders_require_published_instrument()'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
