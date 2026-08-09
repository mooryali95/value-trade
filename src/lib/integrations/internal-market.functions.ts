import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Internal market-data bridge -- the "no external provider" counterpart to
 * market.functions.ts's fetchUpstreamQuotes. Price/change/volume come from
 * real orders placed on the platform itself (get_market_snapshot /
 * get_symbol_market_stats, both SECURITY DEFINER aggregates -- see
 * 20260809161927_internal_market_data.sql for why that's safe: they only
 * ever return aggregates, never individual orders or trader identity).
 *
 * Requires an authenticated session, same as any other authenticated RPC
 * call in this app -- unlike the public company-search RPCs, market data
 * inside the trading UI is only ever rendered to signed-in users anyway.
 */

export type SnapshotRow = {
  symbol: string;
  last_price: number | null;
  change_24h_pct: number | null;
  volume_24h: number;
};

export const getInternalMarketSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ symbols: z.array(z.string().min(1)).max(500) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ rows: SnapshotRow[] }> => {
    if (data.symbols.length === 0) return { rows: [] };
    const { data: rows, error } = await context.supabase.rpc("get_market_snapshot" as any, {
      _symbols: data.symbols,
    });
    if (error) {
      console.error("[internal-market] snapshot failed", error);
      return { rows: [] };
    }
    return { rows: (rows ?? []) as SnapshotRow[] };
  });

export type SymbolStats = {
  last_price: number | null;
  last_traded_at: string | null;
  change_24h_pct: number | null;
  volume_24h: number;
  trade_count_24h: number;
};

export const getInternalSymbolStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ symbol: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<SymbolStats | null> => {
    const { data: rows, error } = await context.supabase.rpc("get_symbol_market_stats" as any, {
      _symbol: data.symbol,
    });
    if (error) {
      console.error("[internal-market] symbol stats failed", error);
      return null;
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    return (row ?? null) as SymbolStats | null;
  });
