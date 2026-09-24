-- ============================================================================
-- Cash: new portfolios start at 0 and every balance is explained by the
-- ledger.
--
-- Investors are activated and funded by a platform admin (deposit through
-- post_cash_movement); nobody receives play money on first touch any more.
-- Portfolios created before this migration got cash_balance = 100000 from
-- the column default, outside the ledger, so the ledger never reconciled.
-- For every such portfolio we add ONE 'adjustment' row (note 'opening
-- balance reconciliation') so that, afterwards, for every user:
--     sum(cash_ledger.amount)             = portfolios.cash_balance
--     latest cash_ledger.balance_after    = portfolios.cash_balance
-- No balance is changed.
-- ============================================================================

ALTER TABLE public.portfolios ALTER COLUMN cash_balance SET DEFAULT 0;

-- Same signature and behaviour; the portfolio is created explicitly at 0,
-- amounts must be whole cents (portfolios.cash_balance is numeric(18,2), so a
-- sub-cent amount would silently drift from the ledger), and ledger rows get
-- clock_timestamp() so several movements in one transaction keep their order.
CREATE OR REPLACE FUNCTION public.post_cash_movement(
  _user_id uuid,
  _kind text,
  _amount numeric,
  _ref_order_id uuid DEFAULT NULL,
  _note text DEFAULT NULL,
  _actor_id uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _balance numeric;
BEGIN
  IF _kind IS NULL OR _kind NOT IN ('deposit','withdrawal','order_buy','order_sell','adjustment') THEN
    RAISE EXCEPTION 'INVALID_KIND';
  END IF;
  IF _user_id IS NULL OR _amount IS NULL OR _amount = 'NaN'::numeric OR _amount <> round(_amount, 2) THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  INSERT INTO public.portfolios (user_id, cash_balance)
  VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT cash_balance INTO _balance FROM public.portfolios WHERE user_id = _user_id FOR UPDATE;
  IF _balance IS NULL THEN
    RAISE EXCEPTION 'PORTFOLIO_UNAVAILABLE';
  END IF;

  _balance := _balance + _amount;
  IF _balance < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_CASH';
  END IF;

  INSERT INTO public.cash_ledger (user_id, kind, amount, balance_after, ref_order_id, note, created_by, created_at)
  VALUES (_user_id, _kind, _amount, _balance, _ref_order_id, _note, COALESCE(_actor_id, _user_id), clock_timestamp());

  UPDATE public.portfolios SET cash_balance = _balance, updated_at = now() WHERE user_id = _user_id;
  RETURN _balance;
END;
$$;
REVOKE ALL ON FUNCTION public.post_cash_movement(uuid, text, numeric, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_cash_movement(uuid, text, numeric, uuid, text, uuid) TO service_role;

-- Opening balance reconciliation.
--  * If the ledger is otherwise consistent (no rows, or its newest row already
--    shows the current balance), the missing amount is the opening balance:
--    the row is dated before the first movement (at portfolio creation) and
--    its balance_after is the opening balance, so the running balance of the
--    whole history is coherent.
--  * Otherwise (the balance was changed outside the ledger later on), the
--    difference is booked now, with balance_after = the current balance.
WITH pf AS (
  SELECT p.user_id,
         p.cash_balance,
         p.created_at AS pf_created_at,
         COALESCE((SELECT sum(l.amount) FROM public.cash_ledger l WHERE l.user_id = p.user_id), 0) AS ledger_sum,
         (SELECT min(l.created_at) FROM public.cash_ledger l WHERE l.user_id = p.user_id) AS first_at,
         (SELECT max(l.created_at) FROM public.cash_ledger l WHERE l.user_id = p.user_id) AS last_at
    FROM public.portfolios p
), diff AS (
  SELECT pf.*,
         pf.cash_balance - pf.ledger_sum AS missing,
         (pf.first_at IS NULL OR EXISTS (
            SELECT 1 FROM public.cash_ledger l
             WHERE l.user_id = pf.user_id AND l.created_at = pf.last_at
               AND l.balance_after = pf.cash_balance)) AS opening_only
    FROM pf
   WHERE pf.cash_balance <> pf.ledger_sum
)
INSERT INTO public.cash_ledger (user_id, kind, amount, balance_after, ref_order_id, note, created_by, created_at)
SELECT d.user_id,
       'adjustment',
       d.missing,
       CASE WHEN d.opening_only THEN d.missing ELSE d.cash_balance END,
       NULL,
       'opening balance reconciliation',
       NULL,
       CASE
         WHEN d.first_at IS NULL THEN d.pf_created_at
         WHEN d.opening_only THEN LEAST(d.pf_created_at, d.first_at - interval '1 millisecond')
         ELSE clock_timestamp()
       END
  FROM diff d;
