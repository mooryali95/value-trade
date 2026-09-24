-- ============================================================================
-- Governance and listing fixes (launch audit, fixer round 1).
--
--   1) user_roles is the privilege gate (platform_admin, trader, ...). No
--      application code writes it with a user session (investor activation
--      runs on the server with the service role), so authenticated keeps
--      SELECT only and every write policy is dropped, whatever its name, as
--      for the financial tables. A drifted self-insert policy can then no
--      longer let a user grant themselves a role.
--   2) product_submissions: a reviewer may only move a PENDING submission to
--      approved or rejected, and 'approved' requires the published brand the
--      server lists first (brands.source_submission_id). Decided rows are
--      frozen for API users.
--   3) Primary issuance of brand units: unit_issuances (append-only record)
--      and issue_units(), the only way units enter the market besides
--      trading. Platform admins only, through the server.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) user_roles: read-only for API users.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.policyname FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'user_roles' AND p.cmd <> 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.user_roles', r.policyname);
  END LOOP;
END $$;

-- Platform admins keep reading every role row (the FOR ALL policy that used
-- to allow it is gone).
DROP POLICY IF EXISTS "user_roles_admin_read" ON public.user_roles;
CREATE POLICY "user_roles_admin_read" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'platform_admin'));

-- ---------------------------------------------------------------------------
-- 2) product_submissions: pending -> approved | rejected only.
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
      -- Approval means "listed": the server publishes the brand first.
      IF NEW.status = 'approved' AND NOT EXISTS (
        SELECT 1 FROM public.brands b
         WHERE b.source_submission_id = NEW.id AND b.company_id = NEW.company_id AND b.published
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
REVOKE ALL ON FUNCTION public.product_submissions_guard() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Primary issuance of brand units.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.unit_issuances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  user_id uuid NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0 AND qty = trunc(qty)),
  price numeric NOT NULL CHECK (price > 0 AND price = round(price, 2)),
  note text CHECK (note IS NULL OR char_length(note) <= 280),
  issued_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_unit_issuances_symbol ON public.unit_issuances (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unit_issuances_user ON public.unit_issuances (user_id, created_at DESC);

ALTER TABLE public.unit_issuances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.unit_issuances FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.unit_issuances TO service_role;
GRANT SELECT ON public.unit_issuances TO authenticated;

DROP POLICY IF EXISTS "unit_issuances_read_own" ON public.unit_issuances;
CREATE POLICY "unit_issuances_read_own" ON public.unit_issuances
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "unit_issuances_platform_admin_read" ON public.unit_issuances;
CREATE POLICY "unit_issuances_platform_admin_read" ON public.unit_issuances
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'platform_admin'));

-- Credits _qty units of a published brand to _user_id at the issue price
-- (the holder's cost basis). Payment for primary allocations is settled
-- outside the order book. Returns the issuance id.
CREATE OR REPLACE FUNCTION public.issue_units(
  _actor_id uuid, _user_id uuid, _symbol text, _qty numeric, _price numeric, _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _brand public.brands;
  _id uuid;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'platform_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_REQUIRED';
  END IF;
  IF _qty IS NULL OR _qty = 'NaN'::numeric OR _qty <= 0 OR _qty > 10000000 OR _qty <> trunc(_qty) THEN
    RAISE EXCEPTION 'INVALID_QTY';
  END IF;
  IF _price IS NULL OR _price = 'NaN'::numeric OR _price <= 0 OR _price > 1000000000
     OR _price <> round(_price, 2) THEN
    RAISE EXCEPTION 'INVALID_PRICE';
  END IF;
  IF _note IS NOT NULL AND char_length(_note) > 280 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF _user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  SELECT * INTO _brand FROM public.brands b WHERE b.symbol = upper(btrim(_symbol)) AND b.published;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUMENT_NOT_FOUND'; END IF;

  -- Same lock order as the order paths: user, then symbol.
  PERFORM pg_advisory_xact_lock(4242, hashtext(_user_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('match:' || _brand.symbol));

  PERFORM public.apply_trade_position(_user_id, _brand.symbol, _brand.asset_class, 'buy', _qty, _price);

  INSERT INTO public.unit_issuances (symbol, user_id, qty, price, note, issued_by)
  VALUES (_brand.symbol, _user_id, _qty, _price, NULLIF(btrim(COALESCE(_note, '')), ''), _actor_id)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_units(uuid, uuid, text, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_units(uuid, uuid, text, numeric, numeric, text) TO service_role;
