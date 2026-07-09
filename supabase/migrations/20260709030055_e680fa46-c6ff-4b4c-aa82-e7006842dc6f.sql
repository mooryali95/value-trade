
-- =========================================================
-- Phase 5 migration
-- Companies (multi-tenant), submissions, audit trails
-- =========================================================

-- ---------- companies ----------
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  plan text NOT NULL DEFAULT 'basic',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- company_members ----------
CREATE TYPE public.company_role AS ENUM ('owner', 'finance', 'shariah', 'trader', 'viewer');

CREATE TABLE public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.company_role NOT NULL DEFAULT 'viewer',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_members TO authenticated;
GRANT ALL ON public.company_members TO service_role;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- security-definer helpers (avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_company_member(_user_id uuid, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE user_id = _user_id AND company_id = _company_id
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_company_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_company_role(_user_id uuid, _company_id uuid, _role public.company_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE user_id = _user_id AND company_id = _company_id AND role = _role
  );
$$;
REVOKE EXECUTE ON FUNCTION public.has_company_role(uuid, uuid, public.company_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, uuid, public.company_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_company_owner(_user_id uuid, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE user_id = _user_id AND company_id = _company_id AND role = 'owner'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_company_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_company_owner(uuid, uuid) TO authenticated;

-- companies policies
CREATE POLICY "companies_read_members" ON public.companies FOR SELECT TO authenticated
  USING (public.is_company_member(auth.uid(), id));
CREATE POLICY "companies_insert_self" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);
CREATE POLICY "companies_update_owner" ON public.companies FOR UPDATE TO authenticated
  USING (public.is_company_owner(auth.uid(), id))
  WITH CHECK (public.is_company_owner(auth.uid(), id));

-- Auto-add creator as owner
CREATE OR REPLACE FUNCTION public.add_creator_as_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.company_members (company_id, user_id, role, invited_by)
  VALUES (NEW.id, NEW.created_by, 'owner', NEW.created_by)
  ON CONFLICT (company_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_creator_as_owner() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_companies_owner AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.add_creator_as_owner();

-- company_members policies (use helpers to avoid recursion)
CREATE POLICY "members_read_same_company" ON public.company_members FOR SELECT TO authenticated
  USING (public.is_company_member(auth.uid(), company_id));
CREATE POLICY "members_insert_owner" ON public.company_members FOR INSERT TO authenticated
  WITH CHECK (public.is_company_owner(auth.uid(), company_id));
CREATE POLICY "members_update_owner" ON public.company_members FOR UPDATE TO authenticated
  USING (public.is_company_owner(auth.uid(), company_id))
  WITH CHECK (public.is_company_owner(auth.uid(), company_id));
CREATE POLICY "members_delete_owner" ON public.company_members FOR DELETE TO authenticated
  USING (public.is_company_owner(auth.uid(), company_id));

-- ---------- company_brands ----------
CREATE TABLE public.company_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_symbol text NOT NULL,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, brand_symbol)
);
GRANT SELECT, INSERT, DELETE ON public.company_brands TO authenticated;
GRANT ALL ON public.company_brands TO service_role;
ALTER TABLE public.company_brands ENABLE ROW LEVEL SECURITY;

-- 30-brand cap
CREATE OR REPLACE FUNCTION public.enforce_brand_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM public.company_brands WHERE company_id = NEW.company_id) >= 30 THEN
    RAISE EXCEPTION 'BRAND_CAP_REACHED';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_brand_cap() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_brand_cap BEFORE INSERT ON public.company_brands
  FOR EACH ROW EXECUTE FUNCTION public.enforce_brand_cap();

CREATE POLICY "brands_read_members" ON public.company_brands FOR SELECT TO authenticated
  USING (public.is_company_member(auth.uid(), company_id));
CREATE POLICY "brands_write_owner_finance" ON public.company_brands FOR INSERT TO authenticated
  WITH CHECK (public.is_company_owner(auth.uid(), company_id)
             OR public.has_company_role(auth.uid(), company_id, 'finance'));
CREATE POLICY "brands_delete_owner_finance" ON public.company_brands FOR DELETE TO authenticated
  USING (public.is_company_owner(auth.uid(), company_id)
         OR public.has_company_role(auth.uid(), company_id, 'finance'));

-- ---------- product_submissions ----------
CREATE TABLE public.product_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  submitted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  asset_class text NOT NULL,
  symbol text NOT NULL,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  sector text,
  prospectus_url text,
  status text NOT NULL DEFAULT 'pending',
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_reason text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.product_submissions TO authenticated;
GRANT ALL ON public.product_submissions TO service_role;
ALTER TABLE public.product_submissions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_submissions_updated BEFORE UPDATE ON public.product_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "submissions_read_company_or_reviewer" ON public.product_submissions FOR SELECT
  TO authenticated USING (
    public.is_company_member(auth.uid(), company_id)
    OR public.has_role(auth.uid(), 'shariah_board')
  );
CREATE POLICY "submissions_insert_company" ON public.product_submissions FOR INSERT
  TO authenticated WITH CHECK (
    public.is_company_owner(auth.uid(), company_id)
    OR public.has_company_role(auth.uid(), company_id, 'finance')
  );
CREATE POLICY "submissions_update_reviewer" ON public.product_submissions FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'shariah_board'))
  WITH CHECK (public.has_role(auth.uid(), 'shariah_board'));

-- ---------- shariah_decisions audit ----------
ALTER TABLE public.shariah_decisions
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE public.shariah_decision_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.shariah_decisions(id) ON DELETE CASCADE,
  previous_status text,
  new_status text NOT NULL,
  previous_reason text,
  new_reason text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  change_reason text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shariah_decision_audit TO authenticated;
GRANT ALL ON public.shariah_decision_audit TO service_role;
ALTER TABLE public.shariah_decision_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_read_all_auth" ON public.shariah_decision_audit
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.log_shariah_decision_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    INSERT INTO public.shariah_decision_audit
      (decision_id, previous_status, new_status, previous_reason, new_reason, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, OLD.reason, NEW.reason, NEW.updated_by);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_shariah_decision_update() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_shariah_audit AFTER UPDATE ON public.shariah_decisions
  FOR EACH ROW EXECUTE FUNCTION public.log_shariah_decision_update();

-- ---------- orders audit ----------
CREATE TABLE public.orders_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  action text NOT NULL,
  previous_qty numeric(18,4),
  previous_price numeric(18,4),
  new_qty numeric(18,4),
  new_price numeric(18,4),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.orders_audit TO authenticated;
GRANT ALL ON public.orders_audit TO service_role;
ALTER TABLE public.orders_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_audit_owner_read" ON public.orders_audit FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND o.user_id = auth.uid()
  ));
CREATE POLICY "orders_audit_owner_insert" ON public.orders_audit FOR INSERT TO authenticated
  WITH CHECK (
    changed_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid())
  );
