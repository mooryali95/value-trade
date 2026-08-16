CREATE TABLE public.ops_run_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','warn','fail')),
  detail text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ops_run_log_job_created_idx ON public.ops_run_log (job, created_at DESC);

GRANT SELECT ON public.ops_run_log TO authenticated;
GRANT ALL ON public.ops_run_log TO service_role;

ALTER TABLE public.ops_run_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read ops runs"
ON public.ops_run_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'));