import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SymbolInput = z.object({ symbol: z.string().min(1).max(32) });

export type BookLevel = { price: number; qty: number };
export type PublicBook = { bids: BookLevel[]; asks: BookLevel[]; lastPrice: number | null; lastTradedAt: string | null };

/**
 * Aggregated order book and last trades for a symbol. Market depth is public
 * data: the database function returns price/size levels only, never any
 * counterparty identity, for published instruments only. A malformed symbol
 * is an empty book; a database failure throws MARKET_DATA_UNAVAILABLE (so
 * the page shows an error state, not an empty book).
 */
export const getBook = createServerFn({ method: "GET" })
  .inputValidator((input: { symbol: string }) => {
    const parsed = SymbolInput.safeParse(input);
    return parsed.success ? parsed.data : { symbol: "" };
  })
  .handler(async ({ data }): Promise<PublicBook> => {
    // Symbols are stored upper-case (brands_guard).
    const symbol = data.symbol.trim().toUpperCase();
    if (!/^[A-Z0-9._-]{1,32}$/.test(symbol)) {
      return { bids: [], asks: [], lastPrice: null, lastTradedAt: null };
    }
    const { getPublicClient } = await import("./book.server");
    let client: ReturnType<typeof getPublicClient>;
    try {
      client = getPublicClient();
    } catch {
      console.error("[getBook] client unavailable");
      throw new Error("MARKET_DATA_UNAVAILABLE");
    }

    const [book, lastTrade] = await Promise.all([
      client.rpc("get_order_book", { _symbol: symbol, _depth: 12 }),
      client.rpc("get_symbol_last_trade", { _symbol: symbol }),
    ]);
    for (const r of [book, lastTrade]) {
      if (r.error) {
        console.error("[getBook] rpc failed", r.error.code ?? "unknown");
        throw new Error("MARKET_DATA_UNAVAILABLE");
      }
    }
    const levels = book.data;
    const last = lastTrade.data;

    const rows = levels ?? [];
    const lastRow = (Array.isArray(last) ? last[0] : last) ?? null;

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

/**
 * The signed-in trader's own executions, newest first: side, quantity, price
 * and their own order id. The counterparty's identity is never returned (the
 * database does not let users read trades.buyer_id / seller_id at all).
 */
export const getMyTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SymbolInput.partial().parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("list_my_trades", {
      _user_id: context.userId,
      _symbol: data.symbol,
      _limit: 50,
    });
    if (error) {
      console.error("[getMyTrades] rpc failed", error.code ?? "", error.message);
      throw new Error("INTERNAL_ERROR");
    }
    return (rows ?? []).map((r) => ({
      id: r.id,
      symbol: r.symbol,
      qty: Number(r.qty),
      price: Number(r.price),
      side: r.side === "buy" ? ("buy" as const) : ("sell" as const),
      orderId: r.order_id,
      created_at: r.created_at,
    }));
  });

/** The trader's resting (unfilled or partially filled) orders. */
export const getMyOpenOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("orders")
      .select("id, symbol, side, type, qty, filled_qty, price, status, created_at")
      .eq("user_id", context.userId)
      .in("status", ["open", "partial"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("[getMyOpenOrders] query failed", error.code ?? "", error.message);
      throw new Error("INTERNAL_ERROR");
    }
    return rows ?? [];
  });
