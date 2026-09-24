import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Server-only sliding-window rate limit backed by public.rate_limits + check_rate_limit().
 * Returns true when the caller is within the limit, false when exceeded.
 * Fails CLOSED: if the RPC errors or throws, the call is treated as limited
 * (returns false) so a database hiccup can never disable abuse protection on
 * public write endpoints.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc("check_rate_limit", {
      _key: key,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    if (error) {
      console.error("[rate-limit] rpc failed, failing closed:", error.code ?? "unknown");
      return false;
    }
    return data === true;
  } catch (err) {
    console.error("[rate-limit] threw, failing closed:", err instanceof Error ? err.name : "unknown");
    return false;
  }
}

/** Throws RATE_LIMITED when the key is over its limit (or the check fails). */
export async function assertRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  if (!(await checkRateLimit(key, limit, windowSeconds))) throw new Error("RATE_LIMITED");
}

/**
 * Derive a stable client key from request headers. The app runs behind
 * Cloudflare, which sets cf-connecting-ip and overwrites any client-supplied
 * value; x-real-ip is the next best; the first x-forwarded-for entry is only a
 * last resort because clients can prepend arbitrary values to it.
 */
export function clientKeyFromRequest(request: Request, scope: string): string {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const ip =
    first(request.headers.get("cf-connecting-ip")) ??
    first(request.headers.get("x-real-ip")) ??
    first(request.headers.get("x-forwarded-for")) ??
    "unknown";
  return `${scope}:${ip.slice(0, 64)}`;
}
