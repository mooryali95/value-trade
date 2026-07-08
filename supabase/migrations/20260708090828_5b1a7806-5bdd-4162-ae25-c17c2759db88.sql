-- portfolios
CREATE TABLE public.portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  cash_balance numeric(18,2) NOT NULL DEFAULT 100000,
  currency text NOT NULL DEFAULT 'SAR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.portfolios TO authenticated;
GRANT ALL ON public.portfolios TO service_role;
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portfolios_self" ON public.portfolios FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_portfolios_updated BEFORE UPDATE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- positions
CREATE TABLE public.positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  asset_class text NOT NULL DEFAULT 'brand',
  qty numeric(18,4) NOT NULL DEFAULT 0,
  avg_price numeric(18,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.positions TO authenticated;
GRANT ALL ON public.positions TO service_role;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "positions_self" ON public.positions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_positions_updated BEFORE UPDATE ON public.positions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- orders
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  asset_class text NOT NULL DEFAULT 'brand',
  side text NOT NULL,
  type text NOT NULL,
  qty numeric(18,4) NOT NULL,
  price numeric(18,4),
  status text NOT NULL DEFAULT 'pending',
  filled_at timestamptz,
  filled_price numeric(18,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_self" ON public.orders FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- shariah_decisions
CREATE TABLE public.shariah_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  status text NOT NULL,
  reason text,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shariah_decisions TO anon, authenticated;
GRANT INSERT, UPDATE ON public.shariah_decisions TO authenticated;
GRANT ALL ON public.shariah_decisions TO service_role;
ALTER TABLE public.shariah_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shariah_read_all" ON public.shariah_decisions FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "shariah_write_board" ON public.shariah_decisions FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'shariah_board'));
CREATE POLICY "shariah_update_board" ON public.shariah_decisions FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'shariah_board'))
  WITH CHECK (public.has_role(auth.uid(), 'shariah_board'));
CREATE TRIGGER trg_shariah_updated BEFORE UPDATE ON public.shariah_decisions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- price_alerts
CREATE TABLE public.price_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  direction text NOT NULL,
  target_price numeric(18,4) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_alerts TO authenticated;
GRANT ALL ON public.price_alerts TO service_role;
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alerts_self" ON public.price_alerts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_alerts_updated BEFORE UPDATE ON public.price_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();