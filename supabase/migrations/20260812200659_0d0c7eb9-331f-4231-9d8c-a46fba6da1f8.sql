CREATE TABLE IF NOT EXISTS public.cash_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('deposit','withdrawal','order_buy','order_sell','adjustment')),
  amount numeric NOT NULL,
  balance_after numeric NOT NULL,
  ref_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_ledger_user_created_idx ON public.cash_ledger (user_id, created_at DESC);

GRANT SELECT ON public.cash_ledger TO authenticated;
GRANT ALL ON public.cash_ledger TO service_role;
ALTER TABLE public.cash_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_ledger_read_own" ON public.cash_ledger;
CREATE POLICY "cash_ledger_read_own" ON public.cash_ledger
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.post_cash_movement(
  _user_id uuid,
  _kind text,
  _amount numeric,
  _ref_order_id uuid DEFAULT NULL,
  _note text DEFAULT NULL,
  _actor_id uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _balance numeric;
BEGIN
  IF _kind NOT IN ('deposit','withdrawal','order_buy','order_sell','adjustment') THEN
    RAISE EXCEPTION 'INVALID_KIND';
  END IF;

  INSERT INTO public.portfolios (user_id)
  VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT cash_balance INTO _balance FROM public.portfolios WHERE user_id = _user_id FOR UPDATE;
  IF _balance IS NULL THEN
    RAISE EXCEPTION 'PORTFOLIO_UNAVAILABLE';
  END IF;

  _balance := _balance + _amount;
  IF _balance < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_CASH';
  END IF;

  INSERT INTO public.cash_ledger (user_id, kind, amount, balance_after, ref_order_id, note, created_by)
  VALUES (_user_id, _kind, _amount, _balance, _ref_order_id, _note, COALESCE(_actor_id, _user_id));

  UPDATE public.portfolios SET cash_balance = _balance, updated_at = now() WHERE user_id = _user_id;
  RETURN _balance;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.post_cash_movement(uuid, text, numeric, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_cash_movement(uuid, text, numeric, uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.protect_last_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _owners int;
BEGIN
  IF OLD.role <> 'owner' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO _owners
  FROM public.company_members
  WHERE company_id = OLD.company_id AND role = 'owner';
  IF _owners <= 1 THEN
    RAISE EXCEPTION 'LAST_OWNER_PROTECTED';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.protect_last_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_last_owner_del ON public.company_members;
CREATE TRIGGER trg_protect_last_owner_del BEFORE DELETE ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_owner();

DROP TRIGGER IF EXISTS trg_protect_last_owner_upd ON public.company_members;
CREATE TRIGGER trg_protect_last_owner_upd BEFORE UPDATE OF role ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_owner();