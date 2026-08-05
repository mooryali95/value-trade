import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
 */

const QuoteSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  change24h: z.number(),
  volume24h: z.number().optional(),
  ts: z.number().optional(),
});
export type UpstreamQuote = z.infer<typeof QuoteSchema>;

export const fetchUpstreamQuotes = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ symbols: z.array(z.string().min(1)).max(300) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ quotes: UpstreamQuote[]; error?: string }> => {
    const base = process.env["MARKET_DATA_URL"];
    const key = process.env["MARKET_DATA_API_KEY"];
    if (!base || !key) return { quotes: [], error: "MARKET_DATA_NOT_CONFIGURED" };

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
      console.error("[market-data] upstream fetch failed", err);
      return { quotes: [], error: "UPSTREAM_UNREACHABLE" };
    }
  });
