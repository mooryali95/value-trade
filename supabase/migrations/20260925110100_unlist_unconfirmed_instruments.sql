-- ============================================================================
-- Only confirmed listings stay on the market (phase 2, fixer round 1).
--
-- Before phase 2, approving a product submission published the instrument
-- straight away: new symbols got the old column default of 100 as their
-- reference price, and approving a submission for a seeded symbol kept the
-- seed's invented price (and attached the seed to the company, so the demo
-- delisting migration does not recognise it). The seeded demo instruments,
-- now off the market, still carry invented prices that one click would
-- republish. A price "set by a platform admin" is one whose most recent
-- audit_log row (action 'brand.reference_price', written by the admin
-- screen) has the instrument's current price as its new value.
--
--   a) No Shariah ruling is created here. (An earlier draft of this
--      migration, never applied to production, recorded a 'halal' ruling in
--      the approving reviewer's name for every legacy approval that had
--      none. Nobody recorded those rulings, and a legacy approval may be a
--      test approval of a real issuer, so they are not invented.) A legacy
--      approval without a ruling therefore leaves the market under (b): a
--      Shariah reviewer rules on it from the review console (which lists
--      unpublished instruments too) and a platform admin lists it again.
--   b) A published instrument whose reference price no platform admin set,
--      or that has no Shariah ruling in force, is taken off the market
--      under the engine's per-symbol lock; its resting orders are closed
--      ('cancelled', orders_audit 'delisted'), exactly as an admin
--      unpublish does. Positions, cash and trades are not touched.
--   c) An instrument off the market whose reference price no platform
--      admin set gets reference_price 0 ("not set"): publishing it then
--      needs a real price from the admin screen first (INVALID_PRICE).
--
-- Idempotent: a second run finds nothing to change.
-- ============================================================================

-- b) and c)
DO $$
DECLARE
  s text;
BEGIN
  CREATE TEMP TABLE _admin_priced ON COMMIT DROP AS
  SELECT b.id
    FROM public.brands b
    CROSS JOIN LATERAL (
      SELECT a.metadata->>'to' AS to_price
        FROM public.audit_log a
       WHERE a.action = 'brand.reference_price' AND a.entity = 'brands' AND a.entity_id = b.id::text
       ORDER BY a.created_at DESC
       LIMIT 1
    ) last_set
   WHERE CASE WHEN last_set.to_price ~ '^[0-9]{1,10}(\.[0-9]{1,8})?$'
              THEN last_set.to_price::numeric = b.reference_price
              ELSE false END;

  FOR s IN
    SELECT b.symbol
      FROM public.brands b
     WHERE b.published
       AND (NOT EXISTS (SELECT 1 FROM _admin_priced p WHERE p.id = b.id)
            OR public.current_shariah_status(b.symbol) IS NULL)
     ORDER BY b.symbol
  LOOP
    -- Sorted symbol locks, the order deactivate_trader uses.
    PERFORM pg_advisory_xact_lock(hashtext('match:' || s));
    UPDATE public.brands b SET published = false WHERE b.symbol = s AND b.published;
    PERFORM public.close_instrument_orders(s, 'delisted', NULL);
  END LOOP;

  UPDATE public.brands b
     SET reference_price = 0
   WHERE NOT b.published
     AND b.reference_price <> 0
     AND NOT EXISTS (SELECT 1 FROM _admin_priced p WHERE p.id = b.id);
END $$;
