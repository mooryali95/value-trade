-- ============================================================================
-- Governance lockdown: invitation-only activation, append-only audit log,
-- server-only access requests, protected instrument fields, submission and
-- document integrity, race-safe last-owner protection.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Sign-up no longer grants the global 'trader' role. A platform admin
--    activates an investor (inserts user_roles 'trader') and funds them.
--    Existing role rows are untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) audit_log is append-only and written by the server (service role) with
--    the verified actor id. Users keep their read policies.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "actor can insert own audit rows" ON public.audit_log;

-- ---------------------------------------------------------------------------
-- 3) access_requests: no direct anon/authenticated INSERT or UPDATE. The
--    server inserts with the service role after validation + rate limiting;
--    approval/rejection go through approve_/reject_access_request().
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "access_requests_insert_public" ON public.access_requests;
DROP POLICY IF EXISTS "access_requests_update_scoped" ON public.access_requests;

ALTER TABLE public.access_requests DROP CONSTRAINT IF EXISTS access_requests_text_lengths;
ALTER TABLE public.access_requests ADD CONSTRAINT access_requests_text_lengths CHECK (
  char_length(email) <= 320
  AND char_length(full_name) <= 2000
  AND (new_company_name_ar IS NULL OR char_length(new_company_name_ar) <= 2000)
  AND (new_company_name_en IS NULL OR char_length(new_company_name_en) <= 2000)
  AND (sector IS NULL OR char_length(sector) <= 2000)
  AND (rejection_reason IS NULL OR char_length(rejection_reason) <= 2000)
) NOT VALID;
DO $$ BEGIN
  ALTER TABLE public.access_requests VALIDATE CONSTRAINT access_requests_text_lengths;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'access_requests has legacy oversized rows; length check left NOT VALID';
END $$;

-- ---------------------------------------------------------------------------
-- 4) brands: company owners may edit descriptive fields only. symbol (the
--    Shariah rulings are keyed by it), slug, company_id, published,
--    reference_price (it anchors the price band), asset_class and
--    source_submission_id change only for service_role / platform_admin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brands_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Symbols are stored upper-case (Shariah rulings and orders match on them).
  IF TG_OP = 'INSERT' THEN
    NEW.symbol := upper(btrim(NEW.symbol));
    RETURN NEW;
  END IF;
  -- No end-user identity: service role (server) or a migration.
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'platform_admin') THEN
    IF NEW.symbol IS DISTINCT FROM OLD.symbol THEN
      NEW.symbol := upper(btrim(NEW.symbol));
    END IF;
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

DROP TRIGGER IF EXISTS trg_brands_guard ON public.brands;
CREATE TRIGGER trg_brands_guard BEFORE INSERT OR UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.brands_guard();

-- ---------------------------------------------------------------------------
-- 5) product_submissions: a new submission is always 'pending' with no
--    decision; the submitter is the session user. Reviews stamp the
--    reviewer from the session.
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_submissions DROP CONSTRAINT IF EXISTS product_submissions_status_check;
ALTER TABLE public.product_submissions ADD CONSTRAINT product_submissions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected')) NOT VALID;
DO $$ BEGIN
  ALTER TABLE public.product_submissions VALIDATE CONSTRAINT product_submissions_status_check;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'product_submissions has legacy statuses; check left NOT VALID';
END $$;

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
    NEW.reviewer_id := auth.uid();
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.reviewed_at := now();
    ELSE
      NEW.reviewed_at := OLD.reviewed_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.product_submissions_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_product_submissions_guard ON public.product_submissions;
CREATE TRIGGER trg_product_submissions_guard BEFORE INSERT OR UPDATE ON public.product_submissions
  FOR EACH ROW EXECUTE FUNCTION public.product_submissions_guard();

-- ---------------------------------------------------------------------------
-- 6) submission_documents: the row must reference a submission of the same
--    company, and file_path must be "<company_id>/<submission_id>/<name>"
--    where <name> is non-empty and contains no '/' (max 512 chars in total).
--    The INSERT policy already requires the uploader to be an owner/finance
--    member of company_id; uploaded_by is stamped from the session.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submission_documents_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sub_company uuid;
  _prefix text;
BEGIN
  SELECT s.company_id INTO _sub_company
    FROM public.product_submissions s
   WHERE s.id = NEW.submission_id;
  IF _sub_company IS NULL OR _sub_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'SUBMISSION_NOT_FOUND';
  END IF;

  _prefix := NEW.company_id::text || '/' || NEW.submission_id::text || '/';
  IF NEW.file_path IS NULL
     OR left(NEW.file_path, char_length(_prefix)) <> _prefix
     OR char_length(NEW.file_path) <= char_length(_prefix)
     OR char_length(NEW.file_path) > 512
     OR position('/' IN substr(NEW.file_path, char_length(_prefix) + 1)) > 0 THEN
    RAISE EXCEPTION 'INVALID_FILE_PATH';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.uploaded_by := auth.uid();
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.submission_documents_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_submission_documents_guard ON public.submission_documents;
CREATE TRIGGER trg_submission_documents_guard BEFORE INSERT ON public.submission_documents
  FOR EACH ROW EXECUTE FUNCTION public.submission_documents_guard();

-- ---------------------------------------------------------------------------
-- 7) protect_last_owner, race-safe. Every removal/demotion of an owner first
--    locks the company row, so owner changes of one company are serialized
--    and the count below (a fresh READ COMMITTED snapshot taken after the
--    lock) sees the other transaction's committed change: two owners can no
--    longer remove each other concurrently. The company row is locked rather
--    than the owner rows: each concurrent DELETE already holds its own member
--    row, so locking all owner rows would deadlock instead of serializing.
--    FOR NO KEY UPDATE does not block member inserts (FK KEY SHARE).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_last_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owners int;
BEGIN
  IF OLD.role <> 'owner' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' AND NEW.company_id = OLD.company_id THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.companies c WHERE c.id = OLD.company_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    -- The company itself is being deleted (cascade): nothing to protect.
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*) INTO _owners
    FROM public.company_members m
   WHERE m.company_id = OLD.company_id AND m.role = 'owner';
  IF _owners <= 1 THEN
    RAISE EXCEPTION 'LAST_OWNER_PROTECTED';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.protect_last_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_last_owner_upd ON public.company_members;
CREATE TRIGGER trg_protect_last_owner_upd BEFORE UPDATE OF role, company_id ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_owner();
