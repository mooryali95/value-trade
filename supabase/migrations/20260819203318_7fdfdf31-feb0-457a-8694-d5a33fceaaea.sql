CREATE TABLE public.ops_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  smoke_fail_threshold integer NOT NULL DEFAULT 2 CHECK (smoke_fail_threshold BETWEEN 1 AND 20),
  cron_latency_budget_ms integer NOT NULL DEFAULT 15000 CHECK (cron_latency_budget_ms BETWEEN 500 AND 600000),
  alert_max_per_window integer NOT NULL DEFAULT 2 CHECK (alert_max_per_window BETWEEN 1 AND 50),
  alert_window_minutes integer NOT NULL DEFAULT 60 CHECK (alert_window_minutes BETWEEN 1 AND 1440),
  email_retry_attempts integer NOT NULL DEFAULT 3 CHECK (email_retry_attempts BETWEEN 1 AND 6),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ops_settings TO authenticated;
GRANT ALL ON public.ops_settings TO service_role;

ALTER TABLE public.ops_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read ops settings"
ON public.ops_settings FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'));

CREATE TRIGGER trg_ops_settings_updated
BEFORE UPDATE ON public.ops_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.ops_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;