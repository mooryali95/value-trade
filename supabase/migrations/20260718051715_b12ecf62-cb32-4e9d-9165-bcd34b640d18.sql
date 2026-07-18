
CREATE TABLE public.rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (bypasses RLS) touches this table.

CREATE INDEX rate_limits_window_idx ON public.rate_limits(window_start);

-- Atomic rate-limit check; called by service_role from server functions.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _key text,
  _limit integer,
  _window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bucket timestamptz;
  _current integer;
BEGIN
  _bucket := date_trunc('second', now()) - (extract(epoch from now())::bigint % _window_seconds) * interval '1 second';

  INSERT INTO public.rate_limits (key, window_start, count)
  VALUES (_key, _bucket, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO _current;

  -- Best-effort cleanup of old buckets.
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 hour';

  RETURN _current <= _limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;
