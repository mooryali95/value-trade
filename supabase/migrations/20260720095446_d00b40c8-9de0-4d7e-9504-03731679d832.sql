
-- 1) Fix mutable search_path on email queue helpers
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pg_temp;

-- 2) Revoke EXECUTE from PUBLIC/anon/authenticated on SECURITY DEFINER functions
-- that must not be callable via PostgREST RPC. Trigger and internal helpers only.
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'public.handle_new_user()',
    'public.log_shariah_decision_update()',
    'public.add_creator_as_owner()',
    'public.enforce_brand_cap()',
    'public.email_queue_dispatch()',
    'public.email_queue_wake()',
    'public.enqueue_email(text, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.delete_email(text, bigint)',
    'public.move_to_dlq(text, text, bigint, jsonb)',
    'public.check_rate_limit(text, integer, integer)',
    'public.set_updated_at()'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- 3) rate_limits — add explicit deny policies for anon/authenticated so
-- scanners see policies on the RLS-enabled table. service_role bypasses RLS.
DROP POLICY IF EXISTS "rate_limits_no_client_access" ON public.rate_limits;
CREATE POLICY "rate_limits_no_client_access"
  ON public.rate_limits
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- 4) shariah_decision_audit — tighten broad shariah_board read to only rows
-- relevant to the reviewer: rows the reviewer authored, or on decisions they
-- own (reviewer_id) on the parent decisions table.
DROP POLICY IF EXISTS "audit_read_shariah_board" ON public.shariah_decision_audit;
DROP POLICY IF EXISTS "audit_read_scoped_shariah_board" ON public.shariah_decision_audit;

CREATE POLICY "audit_read_scoped_shariah_board"
  ON public.shariah_decision_audit
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'shariah_board'::app_role)
    AND (
      changed_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.shariah_decisions d
        WHERE d.id = shariah_decision_audit.decision_id
          AND (d.reviewer_id = auth.uid() OR d.updated_by = auth.uid())
      )
    )
  );
