-- ============================================================================
-- Take the seeded demo instruments off the market (phase 2: a truthful
-- market).
--
-- The early builds seeded public.brands with demo listings: real listed
-- issuers (Saudi Aramco 2222, Al Rajhi 1120, STC 7010, SABIC 2010, EMAAR,
-- ADCB, sovereign sukuk KSA-30, ...) and synthetic brands (NOO001, ...),
-- all published with made-up reference prices. Showing real issuers with
-- invented prices is misleading, and synthetic listings are fake data, so
-- the launch market lists only instruments that came through the listing
-- process.
--
-- Criterion: a brand with no source submission (source_submission_id IS
-- NULL) AND no company (company_id IS NULL) is a demo seed. Anything that
-- came from an approved product submission or is attached to a company
-- stays as it is.
--
-- For each such brand, under the engine's per-symbol lock:
--   * published = false (the rows are NOT deleted: symbols, names, history
--     and any holder's position stay intact);
--   * every resting (open/partial) order on it is closed as 'cancelled' with
--     an orders_audit row, action 'delisted' (close_instrument_orders, the
--     same routine the admin unpublish uses).
-- Positions, cash (portfolios / cash_ledger) and trades are not touched.
--
-- A platform admin can republish an instrument later from the admin screen
-- (/admin/investors, setInstrumentPublished -> set_instrument_published),
-- which requires a positive reference price.
--
-- Idempotent: a re-run finds no published demo brand and no resting order
-- on one, and changes nothing.
-- ============================================================================
DO $$
DECLARE
  s text;
BEGIN
  FOR s IN
    SELECT b.symbol
      FROM public.brands b
     WHERE b.source_submission_id IS NULL
       AND b.company_id IS NULL
       AND (b.published
            OR EXISTS (SELECT 1 FROM public.orders o
                        WHERE upper(o.symbol) = b.symbol AND o.status IN ('open', 'partial')))
     ORDER BY b.symbol
  LOOP
    -- Sorted symbol locks, the order deactivate_trader uses.
    PERFORM pg_advisory_xact_lock(hashtext('match:' || s));
    UPDATE public.brands b SET published = false WHERE b.symbol = s AND b.published;
    PERFORM public.close_instrument_orders(s, 'delisted', NULL);
  END LOOP;
END $$;
