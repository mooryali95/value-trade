-- ============================================================================
-- Submission to listing lifecycle, enforced in SQL (phase 3, agent D).
--
-- One path, four states, each transition owned by one role and done by one
-- SECURITY DEFINER function in one transaction:
--
--   pending   --review_submission (Shariah reviewer)-->  approved | rejected
--   approved  --approve_listing   (platform admin)---->  listed
--   approved  --decline_listing   (platform admin)---->  rejected
--
--   * pending:  the company (owner or finance) submitted it; nothing exists
--               on the market.
--   * approved: a Shariah reviewer approved it. In the SAME transaction the
--               instrument is created (or the company's own instrument is
--               updated) OFF the market with no reference price, and the
--               reviewer's 'halal' ruling is recorded, unless a 'halal'
--               ruling is already in force. An existing 'non_halal' or
--               'reviewing' ruling is never overridden silently: the
--               approval is refused (SHARIAH_RULING_CONFLICT) unless the
--               reviewer explicitly replaces it with a written reason.
--   * listed:   a platform admin set a real reference price, listed the
--               instrument (set_instrument_published: ruling + price
--               checks, audit, same transaction) and optionally allocated
--               the first units (issue_units) to a holder. Listing the
--               instrument from the admin listing screen also marks its
--               'approved' submission 'listed' (set_instrument_published).
--   * rejected: by the reviewer (with a reason the company can act on), or
--               by the admin at the listing step (with a reason).
--
-- API callers (anon, authenticated, service_role) can no longer change a
-- submission's status or decision fields directly: UPDATE is revoked from
-- authenticated, the reviewer UPDATE policy is dropped, and the guard
-- trigger refuses any decision change that does not come from these
-- functions (transaction-local flag app.submission_control, which API
-- callers cannot set). Allowed transitions are checked for every caller,
-- migrations included.
--
-- Existing data: an 'approved' submission whose instrument is already
-- published is marked 'listed' (it went through the old one-step path).
-- No Shariah ruling is created for legacy rows (see the edited
-- 20260925110100_unlist_unconfirmed_instruments.sql).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Columns and states.
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_submissions ADD COLUMN IF NOT EXISTS shariah_decision_id uuid;
ALTER TABLE public.product_submissions ADD COLUMN IF NOT EXISTS listing_decided_by uuid;
ALTER TABLE public.product_submissions ADD COLUMN IF NOT EXISTS listing_decided_at timestamptz;
ALTER TABLE public.product_submissions ADD COLUMN IF NOT EXISTS listing_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_submissions_shariah_decision_fk') THEN
    ALTER TABLE public.product_submissions
      ADD CONSTRAINT product_submissions_shariah_decision_fk
      FOREIGN KEY (shariah_decision_id) REFERENCES public.shariah_decisions(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_submissions_listing_decided_by_fk') THEN
    ALTER TABLE public.product_submissions
      ADD CONSTRAINT product_submissions_listing_decided_by_fk
      FOREIGN KEY (listing_decided_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.product_submissions DROP CONSTRAINT IF EXISTS product_submissions_status_check;
ALTER TABLE public.product_submissions
  ADD CONSTRAINT product_submissions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'listed'));

ALTER TABLE public.product_submissions DROP CONSTRAINT IF EXISTS product_submissions_listing_reason_len;
ALTER TABLE public.product_submissions
  ADD CONSTRAINT product_submissions_listing_reason_len
  CHECK (listing_reason IS NULL OR char_length(listing_reason) <= 600);

CREATE INDEX IF NOT EXISTS idx_product_submissions_status ON public.product_submissions (status, submitted_at DESC);

-- ---------------------------------------------------------------------------
-- 2) No direct decision writes through the API.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "submissions_update_reviewer" ON public.product_submissions;
REVOKE UPDATE ON TABLE public.product_submissions FROM PUBLIC, anon, authenticated;
REVOKE DELETE, TRUNCATE ON TABLE public.product_submissions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.product_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_product_submissions_guard ON public.product_submissions;
CREATE TRIGGER trg_product_submissions_guard BEFORE INSERT OR UPDATE ON public.product_submissions
  FOR EACH ROW EXECUTE FUNCTION public.product_submissions_guard();

-- ---------------------------------------------------------------------------
-- 3) Shariah review: approve (instrument + ruling + status) or reject.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.review_submission(uuid, uuid, text, text, boolean);
CREATE FUNCTION public.review_submission(
  _submission_id uuid,
  _reviewer_id uuid,
  _decision text,
  _reason text DEFAULT NULL,
  _replace_ruling boolean DEFAULT false
)
RETURNS TABLE (
  submission_id uuid,
  status text,
  symbol text,
  brand_id uuid,
  ruling_id uuid,
  ruling_recorded boolean,
  previous_ruling text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sub public.product_submissions;
  _sym text;
  _why text := NULLIF(btrim(COALESCE(_reason, '')), '');
  _brand public.brands;
  _brand_id uuid;
  _current text;
  _ruling uuid;
  _recorded boolean := false;
BEGIN
  IF _reviewer_id IS NULL OR NOT public.has_role(_reviewer_id, 'shariah_board') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _decision IS NULL OR _decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF _why IS NOT NULL AND char_length(_why) > 600 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF _decision = 'rejected' AND char_length(COALESCE(_why, '')) < 10 THEN
    RAISE EXCEPTION 'REJECTION_REASON_REQUIRED';
  END IF;

  SELECT * INTO _sub FROM public.product_submissions s WHERE s.id = _submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBMISSION_NOT_FOUND'; END IF;
  IF _sub.status <> 'pending' THEN RAISE EXCEPTION 'SUBMISSION_NOT_PENDING'; END IF;

  _sym := upper(btrim(_sub.symbol));

  IF _decision = 'approved' THEN
    IF _sym !~ '^[A-Z0-9._-]{1,32}$' THEN RAISE EXCEPTION 'INVALID_SYMBOL'; END IF;
    -- The engine's per-symbol lock (the ruling trigger takes it too).
    PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));

    SELECT * INTO _brand FROM public.brands b WHERE b.symbol = _sym FOR UPDATE;
    IF FOUND THEN
      -- Another company's (or an unowned seeded) instrument.
      IF _brand.company_id IS DISTINCT FROM _sub.company_id THEN
        RAISE EXCEPTION 'SYMBOL_TAKEN';
      END IF;
      -- Never the listing state or the reference price.
      UPDATE public.brands b
         SET name_ar = _sub.name_ar, name_en = _sub.name_en, sector = _sub.sector,
             asset_class = _sub.asset_class, source_submission_id = _sub.id
       WHERE b.id = _brand.id;
      _brand_id := _brand.id;
    ELSE
      IF EXISTS (SELECT 1 FROM public.brands b WHERE b.slug = lower(_sym)) THEN
        RAISE EXCEPTION 'SYMBOL_TAKEN';
      END IF;
      INSERT INTO public.brands (symbol, slug, name_ar, name_en, sector, asset_class, company_id,
                                 source_submission_id, published, reference_price)
      VALUES (_sym, lower(_sym), _sub.name_ar, _sub.name_en, _sub.sector, _sub.asset_class,
              _sub.company_id, _sub.id, false, 0)
      RETURNING id INTO _brand_id;
    END IF;

    -- The ruling in force is never overridden silently.
    _current := public.current_shariah_status(_sym);
    IF _current = 'halal' THEN
      SELECT d.id INTO _ruling FROM public.shariah_decisions d
       WHERE d.symbol = _sym
       ORDER BY d.effective_at DESC, d.created_at DESC, d.id DESC
       LIMIT 1;
    ELSE
      IF _current IS NOT NULL THEN
        IF NOT COALESCE(_replace_ruling, false) THEN
          RAISE EXCEPTION 'SHARIAH_RULING_CONFLICT'
            USING DETAIL = format('The ruling in force for %s is %s.', _sym, _current);
        END IF;
        IF char_length(COALESCE(_why, '')) < 10 THEN
          RAISE EXCEPTION 'RULING_CHANGE_REASON_REQUIRED';
        END IF;
      END IF;
      INSERT INTO public.shariah_decisions (symbol, status, reason, reviewer_id, updated_by)
      VALUES (_sym, 'halal', _why, _reviewer_id, _reviewer_id)
      RETURNING id INTO _ruling;
      _recorded := true;
    END IF;
  END IF;

  PERFORM set_config('app.submission_control', 'on', true);
  UPDATE public.product_submissions s
     SET status = _decision,
         reviewer_id = _reviewer_id,
         review_reason = _why,
         reviewed_at = now(),
         shariah_decision_id = _ruling
   WHERE s.id = _sub.id;
  PERFORM set_config('app.submission_control', 'off', true);

  INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
  VALUES (
    _reviewer_id, _sub.company_id,
    CASE WHEN _decision = 'approved' THEN 'submission.approve' ELSE 'submission.reject' END,
    'product_submissions', _sub.id::text,
    jsonb_build_object('symbol', _sym, 'rulingRecorded', _recorded, 'rulingId', _ruling,
                       'previousRuling', _current, 'brandId', _brand_id)
  );

  RETURN QUERY SELECT _sub.id, _decision, _sym, _brand_id, _ruling, _recorded, _current;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Listing: reference price + listing + optional first allocation.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.approve_listing(uuid, uuid, numeric, uuid, numeric, numeric, text);
CREATE FUNCTION public.approve_listing(
  _submission_id uuid,
  _actor_id uuid,
  _reference_price numeric,
  _holder_id uuid DEFAULT NULL,
  _qty numeric DEFAULT NULL,
  _issue_price numeric DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS TABLE (
  submission_id uuid,
  symbol text,
  brand_id uuid,
  reference_price numeric,
  published boolean,
  issuance_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sub public.product_submissions;
  _brand public.brands;
  _ruling text;
  _issuance uuid;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;
  IF _reference_price IS NULL OR _reference_price = 'NaN'::numeric THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;
  IF (_holder_id IS NULL) <> (_qty IS NULL) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  SELECT * INTO _sub FROM public.product_submissions s WHERE s.id = _submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBMISSION_NOT_FOUND'; END IF;
  IF _sub.status <> 'approved' THEN RAISE EXCEPTION 'SUBMISSION_NOT_APPROVED'; END IF;

  SELECT * INTO _brand FROM public.brands b
   WHERE b.source_submission_id = _sub.id AND b.company_id = _sub.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- Lock order of every engine path: the holder first, then the symbol.
  IF _holder_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(4242, hashtext(_holder_id::text));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _brand.symbol));
  SELECT * INTO _brand FROM public.brands b WHERE b.id = _brand.id FOR UPDATE;

  -- Listing needs the Shariah reviewer's 'halal' ruling in force.
  _ruling := public.current_shariah_status(_brand.symbol);
  IF _ruling IS NULL THEN RAISE EXCEPTION 'SHARIAH_RULING_REQUIRED'; END IF;
  IF _ruling <> 'halal' THEN RAISE EXCEPTION 'SHARIAH_NOT_HALAL'; END IF;

  -- The reference price (brands_reference_price_rules raises INVALID_PRICE
  -- for anything off the 0.01 tick or outside 0.05 .. 1,000,000,000).
  IF _brand.reference_price IS DISTINCT FROM _reference_price THEN
    UPDATE public.brands b SET reference_price = _reference_price WHERE b.id = _brand.id;
    INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
    VALUES (_actor_id, _brand.company_id, 'brand.reference_price', 'brands', _brand.id::text,
            jsonb_build_object('symbol', _brand.symbol, 'from', _brand.reference_price, 'to', _reference_price,
                               'submissionId', _sub.id));
  END IF;

  -- Listing (ruling and price checks, audit row, same transaction).
  PERFORM 1 FROM public.set_instrument_published(_brand.symbol, true, _actor_id);

  -- First allocation (primary issuance at the issue price, by default the
  -- reference price).
  IF _holder_id IS NOT NULL THEN
    _issuance := public.issue_units(_actor_id, _holder_id, _brand.symbol, _qty,
                                    COALESCE(_issue_price, _reference_price),
                                    COALESCE(NULLIF(btrim(COALESCE(_note, '')), ''), 'Initial allocation at listing'));
  END IF;

  PERFORM set_config('app.submission_control', 'on', true);
  UPDATE public.product_submissions s
     SET status = 'listed', listing_decided_by = _actor_id, listing_decided_at = now()
   WHERE s.id = _sub.id;
  PERFORM set_config('app.submission_control', 'off', true);

  INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
  VALUES (_actor_id, _sub.company_id, 'submission.list', 'product_submissions', _sub.id::text,
          jsonb_build_object('symbol', _brand.symbol, 'referencePrice', _reference_price,
                             'issuanceId', _issuance, 'holderId', _holder_id, 'qty', _qty));

  RETURN QUERY SELECT _sub.id, _brand.symbol, _brand.id, _reference_price, true, _issuance;
END;
$$;

DROP FUNCTION IF EXISTS public.decline_listing(uuid, uuid, text);
CREATE FUNCTION public.decline_listing(_submission_id uuid, _actor_id uuid, _reason text)
RETURNS TABLE (submission_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sub public.product_submissions;
  _why text := NULLIF(btrim(COALESCE(_reason, '')), '');
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;
  IF char_length(COALESCE(_why, '')) < 10 THEN RAISE EXCEPTION 'REJECTION_REASON_REQUIRED'; END IF;
  IF char_length(_why) > 600 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  SELECT * INTO _sub FROM public.product_submissions s WHERE s.id = _submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBMISSION_NOT_FOUND'; END IF;
  IF _sub.status <> 'approved' THEN RAISE EXCEPTION 'SUBMISSION_NOT_APPROVED'; END IF;

  -- The instrument stays off the market; the Shariah ruling stays on record.
  PERFORM set_config('app.submission_control', 'on', true);
  UPDATE public.product_submissions s
     SET status = 'rejected', listing_decided_by = _actor_id, listing_decided_at = now(), listing_reason = _why
   WHERE s.id = _sub.id;
  PERFORM set_config('app.submission_control', 'off', true);

  INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
  VALUES (_actor_id, _sub.company_id, 'submission.decline_listing', 'product_submissions', _sub.id::text,
          jsonb_build_object('symbol', upper(btrim(_sub.symbol))));

  RETURN QUERY SELECT _sub.id, 'rejected'::text;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4b) set_instrument_published (same signature and behaviour as
--     20260925110000) also completes the lifecycle when an admin lists a
--     Shariah-approved submission's instrument from the listing screen:
--     its submission becomes 'listed', so the two never disagree.
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
$$;

-- ---------------------------------------------------------------------------
-- 5) Instruments a Shariah reviewer rules on: every instrument, listed or
--    not, with the ruling in force (reviewers and platform admins).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reviewer_instruments(uuid);
CREATE FUNCTION public.reviewer_instruments(_actor_id uuid)
RETURNS TABLE (
  symbol text,
  slug text,
  name_ar text,
  name_en text,
  sector text,
  asset_class text,
  published boolean,
  has_company boolean,
  submission_status text,
  shariah_status text,
  ruling_effective_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _actor_id IS NULL OR NOT (public.has_role(_actor_id, 'shariah_board') OR public.has_role(_actor_id, 'platform_admin')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT b.symbol, b.slug, b.name_ar, b.name_en, b.sector, b.asset_class, b.published,
         b.company_id IS NOT NULL,
         s.status,
         r.status, r.effective_at
    FROM public.brands b
    LEFT JOIN public.product_submissions s ON s.id = b.source_submission_id
    LEFT JOIN LATERAL (
      SELECT d.status, d.effective_at FROM public.shariah_decisions d
       WHERE d.symbol = b.symbol
       ORDER BY d.effective_at DESC, d.created_at DESC, d.id DESC
       LIMIT 1
    ) r ON true
   ORDER BY b.symbol
   LIMIT 2000;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Legacy rows: an approval whose instrument is already listed is 'listed'.
-- ---------------------------------------------------------------------------
UPDATE public.product_submissions s
   SET status = 'listed'
  FROM public.brands b
 WHERE s.status = 'approved'
   AND b.source_submission_id = s.id
   AND b.company_id = s.company_id
   AND b.published;

-- ---------------------------------------------------------------------------
-- 7) EXECUTE allow list (pattern of 20260924100600): service role only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    'public.review_submission(uuid, uuid, text, text, boolean)',
    'public.approve_listing(uuid, uuid, numeric, uuid, numeric, numeric, text)',
    'public.decline_listing(uuid, uuid, text)',
    'public.reviewer_instruments(uuid)',
    'public.set_instrument_published(text, boolean, uuid)'
  ];
  trigger_only text[] := ARRAY[
    'public.product_submissions_guard()'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY trigger_only LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;
