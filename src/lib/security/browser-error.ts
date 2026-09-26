/**
 * What a failed server function sends to the browser: a stable UPPER_SNAKE
 * code (mapped to a translated message by use-error-message), never raw text
 * such as a zod issue dump, a middleware sentence ("Unauthorized: No
 * authorization header provided") or a library message.
 *
 * Only Error instances are rewritten: TanStack's redirect() and notFound()
 * results are thrown as other objects and pass through untouched.
 */
const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export function browserErrorCode(message: string): string {
  const m = message.trim();
  if (CODE_RE.test(m)) return m;
  // requireSupabaseAuth (generated): "Unauthorized: No authorization header
  // provided", "Unauthorized: Invalid token", ...
  if (/^Unauthorized\b/i.test(m)) return "NOT_AUTHENTICATED";
  // A validator's issue list (zod .parse, or TanStack's standard-schema path).
  if (/^\s*\[\s*\{[\s\S]*"(code|message)"/.test(m)) return "INVALID_INPUT";
  return "INTERNAL_ERROR";
}

export function toBrowserError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const code = error.name === "ZodError" ? "INVALID_INPUT" : browserErrorCode(error.message ?? "");
  if (code === error.message) return error;
  if (code === "INTERNAL_ERROR") console.error("[server-fn] unexpected error", error.name);
  return new Error(code);
}
