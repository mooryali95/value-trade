-- ============================================================================
-- Public status check for access_requests. Applicants aren't authenticated
-- (no Supabase Auth account exists until they're approved and accept an
-- invitation -- see 20260802121145_access_requests.sql), so there's no
-- session to scope a query to. This RPC requires BOTH the request's own id
-- (effectively an unguessable secret, since UUIDs aren't enumerable) AND a
-- matching email, so it can't be used to browse other people's requests.
-- Returns status only -- no name, no company details, nothing else.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_access_request_status(_id uuid, _email text)
RETURNS TABLE (status text, reviewed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT status, reviewed_at
  FROM public.access_requests
  WHERE id = _id AND lower(email) = lower(_email);
$$;
REVOKE EXECUTE ON FUNCTION public.check_access_request_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_access_request_status(uuid, text) TO anon, authenticated;
