-- Open offerings/listings to every approved asset class (src/lib/market/asset-classes.ts).
CREATE OR REPLACE FUNCTION public.set_instrument_published(_symbol text, _published boolean, _actor_id uuid)
 RETURNS TABLE(brand_id uuid, company_id uuid, symbol text, published boolean, changed boolean, cancelled_orders integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Only approved asset classes are listed (approve_listing lists through
    -- this function too).
    IF _brand.asset_class IS NULL OR _brand.asset_class NOT IN ('stock', 'fund', 'sukuk', 'brand') THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.product_submissions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Every approved asset class may be submitted.
    NEW.asset_class := COALESCE(NULLIF(btrim(NEW.asset_class), ''), 'brand');
    IF NEW.asset_class NOT IN ('stock', 'fund', 'sukuk', 'brand') THEN
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
    OR NEW.offering_details IS DISTINCT FROM OLD.offering_details
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
$function$;

-- Prospectus data captured by the class-specific offering form.
ALTER TABLE public.product_submissions
  ADD COLUMN IF NOT EXISTS offering_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.product_submissions
  ADD CONSTRAINT product_submissions_offering_details_object
  CHECK (jsonb_typeof(offering_details) = 'object' AND pg_column_size(offering_details) <= 16384);
COMMENT ON COLUMN public.product_submissions.offering_details IS
  'Class-specific prospectus fields (see src/lib/submissions/offering-schema.ts).';

-- Security review (2026-10-08): SECURITY DEFINER functions intentionally
-- callable through the API. Each returns no personal data.
COMMENT ON FUNCTION public.get_order_book(text, integer) IS 'SECURITY-APPROVED public: aggregated price levels (side, price, qty) only; no user ids.';
COMMENT ON FUNCTION public.get_symbol_last_trade(text) IS 'SECURITY-APPROVED public: last price and time only.';
COMMENT ON FUNCTION public.public_candles(text, text, integer) IS 'SECURITY-APPROVED public: OHLC aggregates only.';
COMMENT ON FUNCTION public.public_company_profile(uuid) IS 'SECURITY-APPROVED public: company id, names and sector of listed issuers only.';
COMMENT ON FUNCTION public.public_instrument(text) IS 'SECURITY-APPROVED public: published instrument market figures only.';
COMMENT ON FUNCTION public.public_market_overview(uuid) IS 'SECURITY-APPROVED public: published instrument market figures only.';
COMMENT ON FUNCTION public.public_market_summary() IS 'SECURITY-APPROVED public: market-wide counts and totals only.';
COMMENT ON FUNCTION public.public_recent_trades(text, integer) IS 'SECURITY-APPROVED public: price, qty, time of trades; no buyer/seller.';
COMMENT ON FUNCTION public.public_shariah_rulings() IS 'SECURITY-APPROVED public: rulings in force for published instruments; no reviewer identity.';
COMMENT ON FUNCTION public.shariah_decision_is_mine(uuid) IS 'SECURITY-APPROVED authenticated: boolean ownership check used by RLS.';
COMMENT ON TABLE public.launch_review_holds IS 'SECURITY-APPROVED: no API access by design (RLS on, no policies); service role only.';