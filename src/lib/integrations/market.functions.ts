import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Upstream market-data bridge (Phase 1 of the live-data migration).
 *
 * The real feed (Tadawul / Mubasher) is reached over HTTP from the server so
 * the vendor key never touches the browser. Configuration is env-only:
 *   MARKET_DATA_URL      base URL of the vendor REST feed
 *   MARKET_DATA_API_KEY  vendor key (sent as `x-api-key`)
 *
 * When the env is absent or the vendor call fails, the function returns
 * `{ quotes: [], error }` and the caller falls back to the mock provider, so
 * the `MarketDataProvider` contract never breaks mid-migration.
 *
 * The call spends the vendor quota, so it requires a signed-in session, takes
 * at most MAX_SYMBOLS well-formed symbols, and is rate limited per user.
 */

export const MAX_SYMBOLS = 50;
const SymbolSchema = z.string().regex(/^[A-Za-z0-9._-]{1,32}$/);

const QuoteSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  change24h: z.number(),
  volume24h: z.number().optional(),
  ts: z.number().optional(),
});
export type UpstreamQuote = z.infer<typeof QuoteSchema>;

export const fetchUpstreamQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ symbols: z.array(SymbolSchema).max(MAX_SYMBOLS) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ quotes: UpstreamQuote[]; error?: string }> => {
    const base = process.env["MARKET_DATA_URL"];
    const key = process.env["MARKET_DATA_API_KEY"];
    if (!base || !key) return { quotes: [], error: "MARKET_DATA_NOT_CONFIGURED" };
    if (data.symbols.length === 0) return { quotes: [] };

    const { checkRateLimit } = await import("@/lib/security/rate-limit.server");
    if (!(await checkRateLimit(`market-quotes:${context.userId}`, 60, 60))) {
      return { quotes: [], error: "RATE_LIMITED" };
    }

    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/quotes?symbols=${encodeURIComponent(data.symbols.join(","))}`, {
        headers: { "x-api-key": key, accept: "application/json" },
      });
      if (!res.ok) return { quotes: [], error: `UPSTREAM_${res.status}` };
      const json: unknown = await res.json();
      const rows = Array.isArray(json) ? json : (json as { data?: unknown[] }).data ?? [];
      const quotes = rows
        .map((r) => QuoteSchema.safeParse(r))
        .filter((r): r is { success: true; data: UpstreamQuote } => r.success)
        .map((r) => r.data);
      return { quotes };
    } catch (err) {
      console.error("[market-data] upstream fetch failed", err instanceof Error ? err.name : "unknown");
      return { quotes: [], error: "UPSTREAM_UNREACHABLE" };
    }
  });
