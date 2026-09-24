// Server-only: turn a Supabase/PostgREST/driver error into a stable
// UPPER_SNAKE code that is safe to send to the browser. SQL functions in this
// project RAISE stable codes (e.g. INVITATION_EXPIRED); those pass through.
// Anything else is logged server side and replaced with `fallback`.

const CODE_RE = /^[A-Z][A-Z0-9_]{2,63}$/;

export function stableErrorCode(
  error: { message?: string | null; code?: string | null } | null | undefined,
  fallback = "INTERNAL_ERROR",
): string {
  const msg = (error?.message ?? "").trim();
  return CODE_RE.test(msg) ? msg : fallback;
}

/** Logs `error` under `tag` and returns an Error carrying a stable code. */
export function toStableError(
  tag: string,
  error: { message?: string | null; code?: string | null } | null | undefined,
  fallback = "INTERNAL_ERROR",
): Error {
  const code = stableErrorCode(error, fallback);
  if (code === fallback) console.error(`[${tag}]`, error?.code ?? "", error?.message ?? "");
  return new Error(code);
}
