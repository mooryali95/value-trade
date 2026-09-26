-- ============================================================================
-- Phase 3 fixer, round 1: duplicate access requests.
--
-- The same person can submit the request form more than once (the per-address
-- limit is 3 a day). Each submission gets its own reference code, and the
-- applicant may keep any of them, so a submission is never refused or merged
-- (answering "you already applied" would tell anyone who types an address
-- whether that person applied). Instead, when a request is APPROVED, every
-- other PENDING request for the same thing from the same address is closed
-- as approved too (same invitation) in the same transaction:
--   - investor requests: same address;
--   - requests to join a company (search / link): same address and company;
--   - requests for a new company: same address and the same company names.
-- The approval only sends something to that address (the invitation or the
-- activation), so closing its duplicates grants nothing more; before, they
-- stayed in the review queue and approving one later sent a second decision
-- e-mail.
--
-- A REJECTION closes that request only. Anyone can submit a request under
-- any address, so rejecting a spam request must never reject a genuine one
-- from the same address: the other requests stay pending and are decided on
-- their own.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.access_requests_close_siblings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The sibling UPDATE below fires this trigger again: nothing left to do.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  -- Approvals only: a rejection never closes another request.
  IF OLD.status <> 'pending' OR NEW.status <> 'approved' THEN
    RETURN NULL;
  END IF;

  UPDATE public.access_requests s
     SET status = NEW.status,
         reviewed_by = NEW.reviewed_by,
         reviewed_at = NEW.reviewed_at,
         rejection_reason = NEW.rejection_reason,
         resulting_invitation_id = NEW.resulting_invitation_id
   WHERE s.id <> NEW.id
     AND s.status = 'pending'
     AND lower(btrim(s.email)) = lower(btrim(NEW.email))
     AND CASE
           WHEN NEW.join_method = 'investor' THEN s.join_method = 'investor'
           WHEN NEW.join_method IN ('search', 'link') THEN
             s.join_method IN ('search', 'link') AND s.requested_company_id = NEW.requested_company_id
           WHEN NEW.join_method = 'new_company' THEN
             s.join_method = 'new_company'
             AND lower(btrim(s.new_company_name_ar)) = lower(btrim(NEW.new_company_name_ar))
             AND lower(btrim(s.new_company_name_en)) = lower(btrim(NEW.new_company_name_en))
           ELSE false
         END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.access_requests_close_siblings() FROM PUBLIC, anon, authenticated;

-- The trigger is (re)created after the backfill below, which must not close
-- requests submitted after a decision.
DROP TRIGGER IF EXISTS trg_access_requests_close_siblings ON public.access_requests;

-- Requests approved before this migration: close the pending duplicates of
-- an already approved request the same way (oldest approval first). Pending
-- duplicates of a rejected request stay pending.
DO $$
DECLARE
  r public.access_requests;
  n integer := 0;
  k integer;
BEGIN
  FOR r IN
    SELECT * FROM public.access_requests d
     WHERE d.status = 'approved'
     ORDER BY d.reviewed_at NULLS FIRST, d.created_at
  LOOP
    UPDATE public.access_requests s
       SET status = r.status,
           reviewed_by = r.reviewed_by,
           reviewed_at = r.reviewed_at,
           rejection_reason = r.rejection_reason,
           resulting_invitation_id = r.resulting_invitation_id
     WHERE s.id <> r.id
       AND s.status = 'pending'
       AND s.created_at <= COALESCE(r.reviewed_at, r.created_at)
       AND lower(btrim(s.email)) = lower(btrim(r.email))
       AND CASE
             WHEN r.join_method = 'investor' THEN s.join_method = 'investor'
             WHEN r.join_method IN ('search', 'link') THEN
               s.join_method IN ('search', 'link') AND s.requested_company_id = r.requested_company_id
             WHEN r.join_method = 'new_company' THEN
               s.join_method = 'new_company'
               AND lower(btrim(s.new_company_name_ar)) = lower(btrim(r.new_company_name_ar))
               AND lower(btrim(s.new_company_name_en)) = lower(btrim(r.new_company_name_en))
             ELSE false
           END;
    GET DIAGNOSTICS k = ROW_COUNT;
    n := n + k;
  END LOOP;
  IF n > 0 THEN
    RAISE NOTICE 'closed % pending duplicate access request(s) of already approved requests', n;
  END IF;
END $$;

CREATE TRIGGER trg_access_requests_close_siblings
  AFTER UPDATE OF status ON public.access_requests
  FOR EACH ROW EXECUTE FUNCTION public.access_requests_close_siblings();
