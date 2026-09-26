-- ============================================================================
-- Final low fixes (phase 3).
--
-- S9  A Shariah reviewer could change the ruling in force on a symbol without
--     a change reason by recording a NEW decision (review console or a
--     direct REST insert under shariah_write_board), while changing an
--     existing decision requires one (update_shariah_decision). Now the same
--     rule holds for inserts: when a symbol already has a ruling in force and
--     the new row's status differs from it, a non-empty change reason is
--     required (column change_reason, or the transaction setting
--     app.shariah_change_reason for server functions). The change is
--     recorded in shariah_decision_audit (previous -> new status, reason), as
--     for updates. review_submission passes its replacement reason.
--
-- Functions follow the explicit EXECUTE allow-list pattern of
-- 20260924100600 / 20260926101700: trigger functions get no grant at all,
-- server functions service_role only. Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- S9) A new ruling that changes the ruling in force needs a change reason.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shariah_decisions ADD COLUMN IF NOT EXISTS change_reason text;
ALTER TABLE public.shariah_decisions DROP CONSTRAINT IF EXISTS shariah_decisions_change_reason_length;
ALTER TABLE public.shariah_decisions ADD CONSTRAINT shariah_decisions_change_reason_length
  CHECK (change_reason IS NULL OR char_length(change_reason) BETWEEN 1 AND 600);

-- Reviewers insert rulings through the API (policy shariah_write_board) and
-- may now send the change reason with them. It is not readable through the
-- API (no SELECT grant on the column): board members read it in
-- shariah_decision_audit.
GRANT INSERT (change_reason) ON public.shariah_decisions TO authenticated;

CREATE OR REPLACE FUNCTION public.shariah_decisions_require_change_reason()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sym text := upper(btrim(NEW.symbol));
  _current text;
  _why text := COALESCE(NULLIF(btrim(COALESCE(NEW.change_reason, '')), ''),
                        NULLIF(btrim(COALESCE(current_setting('app.shariah_change_reason', true), '')), ''));
BEGIN
  -- An API caller who is not a Shariah reviewer is refused by the insert
  -- policy (shariah_write_board, checked after BEFORE triggers): tell them
  -- nothing about the ruling in force and take no lock.
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'shariah_board') THEN
    RETURN NEW;
  END IF;
  -- The engine's per-symbol lock (the ruling trigger and match_order take it
  -- too): concurrent rulings on a symbol are checked one after the other,
  -- each against the ruling committed before it.
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));
  _current := public.current_shariah_status(_sym);
  IF _current IS NOT NULL AND _current IS DISTINCT FROM NEW.status AND _why IS NULL THEN
    RAISE EXCEPTION 'RULING_CHANGE_REASON_REQUIRED'
      USING DETAIL = format('The ruling in force for %s is %s; a new %s ruling needs a change reason.',
                            _sym, _current, NEW.status);
  END IF;
  NEW.change_reason := _why;
  -- In force from now, after every ruling committed before the lock.
  NEW.effective_at := clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.shariah_decisions_require_change_reason() FROM PUBLIC, anon, authenticated;

-- Runs after trg_shariah_stamp (triggers fire in name order), which
-- normalizes the symbol and stamps the identity columns.
DROP TRIGGER IF EXISTS trg_shariah_supersede_reason ON public.shariah_decisions;
CREATE TRIGGER trg_shariah_supersede_reason BEFORE INSERT ON public.shariah_decisions
  FOR EACH ROW EXECUTE FUNCTION public.shariah_decisions_require_change_reason();

-- The change of the ruling in force is audited like an update: previous and
-- new status and reason, who, and why.
CREATE OR REPLACE FUNCTION public.log_shariah_decision_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prev public.shariah_decisions;
BEGIN
  SELECT * INTO _prev
    FROM public.shariah_decisions d
   WHERE d.symbol = NEW.symbol
     AND d.id <> NEW.id
     AND (d.effective_at, d.created_at, d.id) < (NEW.effective_at, NEW.created_at, NEW.id)
   ORDER BY d.effective_at DESC, d.created_at DESC, d.id DESC
   LIMIT 1;
  IF FOUND AND _prev.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.shariah_decision_audit
      (decision_id, previous_status, new_status, previous_reason, new_reason, changed_by, change_reason)
    VALUES (NEW.id, _prev.status, NEW.status, _prev.reason, NEW.reason,
            COALESCE(auth.uid(), NEW.updated_by, NEW.reviewer_id), NEW.change_reason);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.log_shariah_decision_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shariah_supersede_audit ON public.shariah_decisions;
CREATE TRIGGER trg_shariah_supersede_audit AFTER INSERT ON public.shariah_decisions
  FOR EACH ROW EXECUTE FUNCTION public.log_shariah_decision_insert();

-- review_submission (20260926101000), unchanged except that a replaced
-- ruling carries its reason as the change reason.
CREATE OR REPLACE FUNCTION public.review_submission(
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
      -- The reason is also the change reason when a ruling is replaced
      -- (trg_shariah_supersede_reason requires one; 20260926101800).
      INSERT INTO public.shariah_decisions (symbol, status, reason, reviewer_id, updated_by, change_reason)
      VALUES (_sym, 'halal', _why, _reviewer_id, _reviewer_id,
              CASE WHEN _current IS NOT NULL THEN _why END)
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
-- EXECUTE allow-list for the functions above.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    'public.review_submission(uuid, uuid, text, text, boolean)'
  ];
  trigger_only text[] := ARRAY[
    'public.shariah_decisions_require_change_reason()',
    'public.log_shariah_decision_insert()'
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
