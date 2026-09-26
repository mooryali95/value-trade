-- ============================================================================
-- Phase 3 fixer, round 1: security hardening.
--
--   1) Rate limits (check_rate_limit): the bucket start is computed with
--      floor() instead of a rounding ::bigint cast, so a window is one row,
--      not two (limits were about 2x looser), and old rows are cleaned up
--      per row after their own window has ended. Before, every row older
--      than one hour was deleted in the call that had just counted it, so a
--      window longer than one hour (the 3-per-day cap per address on
--      /request-access) was never enforced. The bucket arithmetic lives in
--      rate_limit_bucket() so it can be tested with fixed timestamps.
--   2) Watch lists and price alerts: a row can only be added for an
--      instrument listed on the market (brands.published), symbols are
--      stored upper-case (the notification lookups match them exactly), and
--      each user holds at most 100 watched symbols and 100 price alerts.
--      Before, any signed-in account could watch any symbol (including
--      unlisted, pre-listing instruments) and receive their Shariah ruling
--      e-mails, and insert thousands of rows in one request.
--   3) Instruments (brands) through the API: authenticated callers keep
--      UPDATE on the descriptive columns only (name_ar, name_en, sector;
--      company owners, through brands_company_owner_update and
--      brands_guard); INSERT and the platform-admin write policies are
--      gone. Reference prices change through set_reference_price(), which
--      writes its audit row in the same transaction. The symbol, and the
--      company it belongs to, can no longer change once the instrument has
--      orders, positions, trades or issuances (INSTRUMENT_HAS_HISTORY), for
--      every caller.
--   4) Names: company names at most 120 characters, instrument names at
--      most 160, sector at most 80 (the limits of the forms); renaming a
--      company or an instrument through the API writes an audit_log row.
--   5) Signed-in market stats: get_symbol_market_stats / get_market_snapshot
--      answered for unlisted instruments; nothing in the app calls them, so
--      they are service_role only now.
--   6) Shariah rulings: a ruling is changed only through
--      update_shariah_decision(), which requires a written change reason
--      and records it in shariah_decision_audit in the same transaction.
--      Direct UPDATE of shariah_decisions is revoked from authenticated.
--   7) Storage: the bucket for submission documents is private, with no
--      anon/authenticated policy on its objects (the server reads and
--      writes it with the service role and short-lived signed URLs).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Rate limits.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rate_limits ADD COLUMN IF NOT EXISTS window_seconds integer;

CREATE OR REPLACE FUNCTION public.rate_limit_bucket(_at timestamptz, _window_seconds integer)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- Fixed windows aligned on the Unix epoch: [k * w, (k + 1) * w).
  SELECT to_timestamp(
    (floor(extract(epoch FROM _at) / GREATEST(COALESCE(_window_seconds, 1), 1))
      * GREATEST(COALESCE(_window_seconds, 1), 1))::double precision
  );
$$;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _key text,
  _limit integer,
  _window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _w integer := GREATEST(COALESCE(_window_seconds, 1), 1);
  _bucket timestamptz := public.rate_limit_bucket(now(), GREATEST(COALESCE(_window_seconds, 1), 1));
  _current integer;
BEGIN
  INSERT INTO public.rate_limits (key, window_start, count, window_seconds)
  VALUES (_key, _bucket, 1, _w)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1,
                window_seconds = GREATEST(COALESCE(public.rate_limits.window_seconds, 0), EXCLUDED.window_seconds)
  RETURNING count INTO _current;

  -- Best-effort cleanup: a row goes once its own window has ended (rows
  -- written before this migration have no window and are kept one hour).
  DELETE FROM public.rate_limits r
   WHERE r.window_start < now() - interval '1 hour'
     AND r.window_start + make_interval(secs => COALESCE(r.window_seconds, 3600)) < now();

  RETURN _current <= _limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Watch lists and price alerts: listed instruments only, capped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_watch_rows_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_max constant integer := 100;
  _n integer;
BEGIN
  NEW.symbol := upper(btrim(COALESCE(NEW.symbol, '')));
  IF TG_OP = 'INSERT' THEN
    -- One writer per user and table at a time, so the cap holds under
    -- concurrent requests too.
    PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || ':' || NEW.user_id::text));
    EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id = $1', TG_TABLE_NAME)
      INTO _n USING NEW.user_id;
    IF _n >= c_max THEN
      RAISE EXCEPTION '%', CASE WHEN TG_TABLE_NAME = 'price_alerts' THEN 'ALERT_LIMIT_REACHED'
                                ELSE 'WATCHLIST_LIMIT_REACHED' END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.user_watch_rows_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_symbol_watchers_guard ON public.symbol_watchers;
CREATE TRIGGER trg_symbol_watchers_guard BEFORE INSERT OR UPDATE OF symbol ON public.symbol_watchers
  FOR EACH ROW EXECUTE FUNCTION public.user_watch_rows_guard();
DROP TRIGGER IF EXISTS trg_price_alerts_guard ON public.price_alerts;
CREATE TRIGGER trg_price_alerts_guard BEFORE INSERT OR UPDATE OF symbol ON public.price_alerts
  FOR EACH ROW EXECUTE FUNCTION public.user_watch_rows_guard();

-- The owner reads and deletes their rows; a new or changed row must name a
-- listed instrument (checked after the trigger has normalised the symbol).
DROP POLICY IF EXISTS "watchers_self" ON public.symbol_watchers;
DROP POLICY IF EXISTS "watchers_read_own" ON public.symbol_watchers;
DROP POLICY IF EXISTS "watchers_delete_own" ON public.symbol_watchers;
DROP POLICY IF EXISTS "watchers_insert_listed" ON public.symbol_watchers;
DROP POLICY IF EXISTS "watchers_update_listed" ON public.symbol_watchers;
CREATE POLICY "watchers_read_own" ON public.symbol_watchers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "watchers_delete_own" ON public.symbol_watchers
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "watchers_insert_listed" ON public.symbol_watchers
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id
              AND EXISTS (SELECT 1 FROM public.brands b
                           WHERE b.symbol = symbol_watchers.symbol AND b.published));
CREATE POLICY "watchers_update_listed" ON public.symbol_watchers
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id
              AND EXISTS (SELECT 1 FROM public.brands b
                           WHERE b.symbol = symbol_watchers.symbol AND b.published));

DROP POLICY IF EXISTS "alerts_self" ON public.price_alerts;
DROP POLICY IF EXISTS "alerts_read_own" ON public.price_alerts;
DROP POLICY IF EXISTS "alerts_delete_own" ON public.price_alerts;
DROP POLICY IF EXISTS "alerts_insert_listed" ON public.price_alerts;
DROP POLICY IF EXISTS "alerts_update_listed" ON public.price_alerts;
CREATE POLICY "alerts_read_own" ON public.price_alerts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "alerts_delete_own" ON public.price_alerts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "alerts_insert_listed" ON public.price_alerts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id
              AND EXISTS (SELECT 1 FROM public.brands b
                           WHERE b.symbol = price_alerts.symbol AND b.published));
CREATE POLICY "alerts_update_listed" ON public.price_alerts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id
              AND EXISTS (SELECT 1 FROM public.brands b
                           WHERE b.symbol = price_alerts.symbol AND b.published));

-- ---------------------------------------------------------------------------
-- 3) Instruments through the API.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "brands_platform_admin_insert" ON public.brands;
DROP POLICY IF EXISTS "brands_platform_admin_update" ON public.brands;
-- Revoking the table privilege also revokes the column privileges; the
-- descriptive columns are granted again right after.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.brands FROM PUBLIC, anon, authenticated;
GRANT UPDATE (name_ar, name_en, sector) ON public.brands TO authenticated;

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
  IF NEW.symbol IS DISTINCT FROM OLD.symbol THEN
    NEW.symbol := upper(btrim(NEW.symbol));
  END IF;
  -- Fixer (phase 3): the identity of an instrument with a market history
  -- is frozen for every caller. Orders, positions, trades and issuances
  -- refer to it by symbol; renaming the symbol or moving the instrument to
  -- another company would orphan them. (Detaching it, company_id -> NULL,
  -- stays possible: that is what deleting the company does.)
  IF (NEW.symbol IS DISTINCT FROM OLD.symbol
      OR (NEW.company_id IS DISTINCT FROM OLD.company_id AND NEW.company_id IS NOT NULL))
     AND (EXISTS (SELECT 1 FROM public.orders o WHERE upper(o.symbol) = OLD.symbol)
          OR EXISTS (SELECT 1 FROM public.positions p WHERE upper(p.symbol) = OLD.symbol)
          OR EXISTS (SELECT 1 FROM public.trades t WHERE upper(t.symbol) = OLD.symbol)
          OR EXISTS (SELECT 1 FROM public.unit_issuances u WHERE upper(u.symbol) = OLD.symbol)) THEN
    RAISE EXCEPTION 'INSTRUMENT_HAS_HISTORY';
  END IF;
  -- No end-user identity: service role (server) or a migration.
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'platform_admin') THEN
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
REVOKE ALL ON FUNCTION public.brands_guard() FROM PUBLIC, anon, authenticated;

-- Reference price: platform admins, through the server (service role), with
-- the audit row in the same transaction. brands_reference_price_rules
-- enforces the price rules (INVALID_PRICE).
DROP FUNCTION IF EXISTS public.set_reference_price(text, numeric, uuid);
CREATE FUNCTION public.set_reference_price(_symbol text, _price numeric, _actor_id uuid)
RETURNS TABLE(brand_id uuid, symbol text, previous_price numeric, reference_price numeric, changed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _sym text := upper(btrim(COALESCE(_symbol, '')));
  _brand public.brands;
  _changed boolean;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;
  IF _price IS NULL OR _price = 'NaN'::numeric OR _price <= 0 THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;
  IF _sym !~ '^[A-Z0-9._-]{1,32}$' THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- The engine's per-symbol lock: no order is priced against a half-moved band.
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _sym));
  SELECT * INTO _brand FROM public.brands b WHERE b.symbol = _sym FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  _changed := _brand.reference_price IS DISTINCT FROM _price;
  IF _changed THEN
    UPDATE public.brands b SET reference_price = _price WHERE b.id = _brand.id;
  END IF;

  INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
  VALUES (_actor_id, _brand.company_id, 'brand.reference_price', 'brands', _brand.id::text,
          jsonb_build_object('symbol', _brand.symbol, 'from', _brand.reference_price, 'to', _price,
                             'changed', _changed));

  RETURN QUERY SELECT _brand.id, _brand.symbol, _brand.reference_price, _price, _changed;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Name lengths and rename audit.
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_name_length;
ALTER TABLE public.companies ADD CONSTRAINT companies_name_length
  CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 120 AND char_length(btrim(name_en)) BETWEEN 1 AND 120) NOT VALID;
ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_name_length;
ALTER TABLE public.brands ADD CONSTRAINT brands_name_length
  CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 160 AND char_length(btrim(name_en)) BETWEEN 1 AND 160
         AND (sector IS NULL OR char_length(sector) <= 80)) NOT VALID;
DO $$ BEGIN
  ALTER TABLE public.companies VALIDATE CONSTRAINT companies_name_length;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'companies has legacy names outside 1..120 characters; check left NOT VALID (new writes are checked)';
END $$;
DO $$ BEGIN
  ALTER TABLE public.brands VALIDATE CONSTRAINT brands_name_length;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'brands has legacy names or sectors outside the limits; check left NOT VALID (new writes are checked)';
END $$;

CREATE OR REPLACE FUNCTION public.audit_name_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- End users only: the server's own changes write their own audit rows.
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'brands' THEN
    IF NEW.name_ar IS DISTINCT FROM OLD.name_ar OR NEW.name_en IS DISTINCT FROM OLD.name_en
       OR NEW.sector IS DISTINCT FROM OLD.sector THEN
      INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
      VALUES (auth.uid(), NEW.company_id, 'brand.rename', 'brands', NEW.id::text,
              jsonb_build_object('symbol', NEW.symbol,
                                 'from', jsonb_build_object('name_ar', OLD.name_ar, 'name_en', OLD.name_en, 'sector', OLD.sector),
                                 'to', jsonb_build_object('name_ar', NEW.name_ar, 'name_en', NEW.name_en, 'sector', NEW.sector)));
    END IF;
  ELSIF NEW.name_ar IS DISTINCT FROM OLD.name_ar OR NEW.name_en IS DISTINCT FROM OLD.name_en THEN
    INSERT INTO public.audit_log (actor_id, company_id, action, entity, entity_id, metadata)
    VALUES (auth.uid(), NEW.id, 'company.rename', 'companies', NEW.id::text,
            jsonb_build_object('from', jsonb_build_object('name_ar', OLD.name_ar, 'name_en', OLD.name_en),
                               'to', jsonb_build_object('name_ar', NEW.name_ar, 'name_en', NEW.name_en)));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_name_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_brands_audit_rename ON public.brands;
CREATE TRIGGER trg_brands_audit_rename AFTER UPDATE OF name_ar, name_en, sector ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.audit_name_change();
DROP TRIGGER IF EXISTS trg_companies_audit_rename ON public.companies;
CREATE TRIGGER trg_companies_audit_rename AFTER UPDATE OF name_ar, name_en ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.audit_name_change();

-- ---------------------------------------------------------------------------
-- 5) Signed-in market stats that ignored the listing state: server only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.get_symbol_market_stats(text)', 'public.get_market_snapshot(text[])'] LOOP
    CONTINUE WHEN to_regprocedure(fn) IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Shariah rulings change with a written reason, through the server.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "shariah_update_board" ON public.shariah_decisions;
REVOKE UPDATE ON TABLE public.shariah_decisions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_shariah_decision_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    INSERT INTO public.shariah_decision_audit
      (decision_id, previous_status, new_status, previous_reason, new_reason, changed_by, change_reason)
    VALUES (NEW.id, OLD.status, NEW.status, OLD.reason, NEW.reason,
            COALESCE(auth.uid(), NEW.updated_by),
            NULLIF(current_setting('app.shariah_change_reason', true), ''));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.log_shariah_decision_update() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.update_shariah_decision(uuid, uuid, text, text, text);
CREATE FUNCTION public.update_shariah_decision(
  _decision_id uuid,
  _actor_id uuid,
  _status text,
  _reason text,
  _change_reason text
)
RETURNS TABLE(decision_id uuid, symbol text, status text, previous_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _d public.shariah_decisions;
  _why text := NULLIF(btrim(COALESCE(_change_reason, '')), '');
  _text text := NULLIF(btrim(COALESCE(_reason, '')), '');
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'shariah_board') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _status IS NULL OR _status NOT IN ('halal', 'non_halal', 'reviewing') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF _why IS NULL THEN RAISE EXCEPTION 'RULING_CHANGE_REASON_REQUIRED'; END IF;
  IF char_length(_why) > 600 OR char_length(COALESCE(_text, '')) > 600 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT * INTO _d FROM public.shariah_decisions d WHERE d.id = _decision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DECISION_NOT_FOUND'; END IF;
  -- The engine's per-symbol lock (a non_halal ruling cancels resting buys).
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _d.symbol));
  SELECT * INTO _d FROM public.shariah_decisions d WHERE d.id = _decision_id FOR UPDATE;

  PERFORM set_config('app.shariah_change_reason', _why, true);
  -- updated_by: the stamp trigger keeps it when there is no session user.
  UPDATE public.shariah_decisions d
     SET status = _status, reason = _text, updated_by = _actor_id
   WHERE d.id = _d.id;
  PERFORM set_config('app.shariah_change_reason', '', true);

  RETURN QUERY SELECT _d.id, _d.symbol, _status, _d.status;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) Storage: the submission documents bucket is private.
-- ---------------------------------------------------------------------------
-- The storage schema belongs to the storage service: if the migration role
-- may not change it, the migration goes on (one-transaction launch bundle)
-- and says so; the bucket is then checked by hand (Storage settings:
-- "submission-docs", public off, no policies).
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    BEGIN
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('submission-docs', 'submission-docs', false)
      ON CONFLICT (id) DO UPDATE SET public = false;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'STORAGE_BUCKET_NOT_CHECKED: make sure the bucket submission-docs is private';
    END;
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    -- No client policy may open this bucket: the server uses the service
    -- role (which bypasses RLS) and hands out 120-second signed URLs.
    FOR r IN
      SELECT pol.polname
        FROM pg_policy pol
       WHERE pol.polrelid = 'storage.objects'::regclass
         AND (COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') ILIKE '%submission-docs%'
              OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ILIKE '%submission-docs%')
    LOOP
      BEGIN
        EXECUTE format('DROP POLICY %I ON storage.objects', r.polname);
        RAISE NOTICE 'dropped storage policy % (submission-docs is server-only)', r.polname;
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE WARNING 'STORAGE_POLICY_NOT_DROPPED: remove the storage policy % by hand', r.polname;
      END;
    END LOOP;
  END IF;
END $$;
