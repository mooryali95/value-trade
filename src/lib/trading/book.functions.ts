import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SymbolInput = z.object({ symbol: z.string().min(1).max(32) });

/**
 * Aggregated order book and last trades for a symbol. Market depth is public
 * data: the database function returns price/size levels only, never any
 * counterparty identity.
 */
export const getBook = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => SymbolInput.parse(input))
  .handler(async ({ data }) => {
    const { getPublicClient } = await import("./book.server");
    const client = getPublicClient();

    const [{ data: levels }, { data: last }] = await Promise.all([
      client.rpc("get_order_book" as never, { _symbol: data.symbol, _depth: 12 } as never),
      client.rpc("get_symbol_last_trade" as never, { _symbol: data.symbol } as never),
    ]);

    const rows = (levels ?? []) as { side: string; price: number; qty: number }[];
    const lastRow = (Array.isArray(last) ? last[0] : last) as
      | { last_price: number | null; traded_at: string | null }
      | null;

    return {
      bids: rows
        .filter((r) => r.side === "buy")
        .map((r) => ({ price: Number(r.price), qty: Number(r.qty) })),
      asks: rows
        .filter((r) => r.side === "sell")
        .map((r) => ({ price: Number(r.price), qty: Number(r.qty) })),
      lastPrice: lastRow?.last_price == null ? null : Number(lastRow.last_price),
      lastTradedAt: lastRow?.traded_at ?? null,
    };
  });

/** The signed-in trader's own executions for a symbol (RLS-scoped). */
export const getMyTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SymbolInput.partial().parse(input ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("trades")
      .select("id, symbol, qty, price, buyer_id, seller_id, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.symbol) q = q.eq("symbol", data.symbol);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      ...r,
      side: r.buyer_id === context.userId ? ("buy" as const) : ("sell" as const),
    }));
  });

/** The trader's resting (unfilled or partially filled) orders. */
export const getMyOpenOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("orders")
      .select("id, symbol, side, type, qty, filled_qty, price, status, created_at")
      .in("status", ["open", "partial", "pending", "modified"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
