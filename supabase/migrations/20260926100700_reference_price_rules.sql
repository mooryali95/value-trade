-- ============================================================================
-- Listing reference price rules in the database (phase 3).
--
-- The server validated the reference price, the database did not: a direct
-- update could store an off-tick price (10.005) or one so small that the
-- ±20% band collapses to a single tick (0.01 .. 0.04: ceil(0.8p) = floor(1.2p)
-- on the 0.01 tick, so the price can never move). A reference price is now:
--   * 0, meaning "not set" (only while the instrument is off the market; the
--     brands_published_reference_price CHECK already refuses 0 on a
--     published instrument), or
--   * on the 0.01 tick, at least 0.05 (the smallest price whose band has
--     more than one tick: 0.04 .. 0.06) and at most 1,000,000,000.
-- Checked when the price is set or changed and when an instrument is
-- listed; existing rows are not rewritten (a legacy published row with an
-- invalid price keeps trading until an admin sets a valid one, and cannot
-- be relisted with it). Raises INVALID_PRICE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.brands_reference_price_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- Inline (no helper call): the trigger runs with the privileges of the
  -- caller, e.g. a platform admin through the API.
  _valid boolean := NEW.reference_price IS NOT NULL
                    AND NEW.reference_price <> 'NaN'::numeric
                    AND NEW.reference_price >= 0.05
                    AND NEW.reference_price <= 1000000000
                    AND NEW.reference_price = round(NEW.reference_price, 2);
BEGIN
  -- A new or changed price: 0 (not set) or a valid price.
  IF (TG_OP = 'INSERT' OR NEW.reference_price IS DISTINCT FROM OLD.reference_price)
     AND COALESCE(NEW.reference_price, 0) <> 0
     AND NOT _valid THEN
    RAISE EXCEPTION 'INVALID_PRICE';
  END IF;
  -- Listing (or relisting) needs a valid price. A price of 0 is left to the
  -- brands_published_reference_price CHECK.
  IF NEW.published AND (TG_OP = 'INSERT' OR OLD.published IS DISTINCT FROM true)
     AND COALESCE(NEW.reference_price, 0) <> 0
     AND NOT _valid THEN
    RAISE EXCEPTION 'INVALID_PRICE';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.brands_reference_price_rules() FROM PUBLIC, anon, authenticated;

-- Named after trg_brands_guard, so the authorization check runs first.
DROP TRIGGER IF EXISTS trg_brands_reference_price ON public.brands;
CREATE TRIGGER trg_brands_reference_price BEFORE INSERT OR UPDATE OF reference_price, published ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.brands_reference_price_rules();
