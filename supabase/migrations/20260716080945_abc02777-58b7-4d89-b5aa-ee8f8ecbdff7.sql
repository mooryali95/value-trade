CREATE TABLE public.audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id uuid NOT NULL,
  company_id uuid NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_company_created_idx ON public.audit_log (company_id, created_at DESC);
CREATE INDEX audit_log_actor_created_idx ON public.audit_log (actor_id, created_at DESC);
CREATE INDEX audit_log_entity_idx ON public.audit_log (entity, entity_id);

GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "actor can insert own audit rows"
  ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

CREATE POLICY "actor can read own audit rows"
  ON public.audit_log FOR SELECT TO authenticated
  USING (actor_id = auth.uid());

CREATE POLICY "company owners can read company audit rows"
  ON public.audit_log FOR SELECT TO authenticated
  USING (company_id IS NOT NULL AND public.is_company_owner(auth.uid(), company_id));

CREATE POLICY "platform admins can read all audit rows"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));