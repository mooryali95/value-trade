import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Server-only sliding-window rate limit backed by public.rate_limits + check_rate_limit().
 * Returns true when the caller is within the limit, false when exceeded.
 * Fails open on infrastructure errors (logs to console) to avoid blocking prod on transient DB issues.
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
      console.warn("[rate-limit] rpc failed, failing open:", error.message);
      return true;
    }
    return data === true;
  } catch (err) {
    console.warn("[rate-limit] threw, failing open:", err);
    return true;
  }
}

/** Derive a stable client key from request headers (CF/edge friendly). */
export function clientKeyFromRequest(request: Request, scope: string): string {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return `${scope}:${ip}`;
}