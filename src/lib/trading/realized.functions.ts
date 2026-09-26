import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeRealizedFills, filterFills, summarize, type FilledOrder } from "./realized";

/** Days are Asia/Riyadh calendar days (YYYY-MM-DD); empty means unbounded. */
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Input = z.object({
  from: DAY.optional(),
  to: DAY.optional(),
  symbol: z.string().max(32).optional(),
});

function parseInput(input: unknown) {
  const parsed = Input.safeParse(input ?? {});
  if (!parsed.success) throw new Error("INVALID_INPUT");
  return parsed.data;
}

/** PostgREST returns at most this many rows per request. */
const TRADES_PAGE = 1000;
/** Upper bound on the replay (pages x page size executions). */
const MAX_TRADE_PAGES = 200;

type MyFill = { id: string; order_id: string | null; symbol: string; asset_class: string; side: string; qty: number; price: number; created_at: string };

/**
 * Every execution of the user, oldest first, paged so a long history is
 * never truncated (list_my_trades returns only the newest rows). Runs with
 * the service role for the verified user id only; the counterparty id is
 * used to derive the side and never returned.
 */
async function allMyFills(userId: string): Promise<MyFill[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const fills: MyFill[] = [];
  for (let page = 0; page < MAX_TRADE_PAGES; page++) {
    const from = page * TRADES_PAGE;
    const { data, error } = await supabaseAdmin
      .from("trades")
      .select("id, symbol, asset_class, qty, price, created_at, buyer_id, buy_order_id, sell_order_id")
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + TRADES_PAGE - 1);
    if (error) {
      console.error("[getRealizedPnl] trades query failed", error.code ?? "", error.message);
      throw new Error("INTERNAL_ERROR");
    }
    for (const t of data ?? []) {
      const isBuy = t.buyer_id === userId;
      fills.push({
        id: t.id,
        order_id: isBuy ? t.buy_order_id : t.sell_order_id,
        symbol: t.symbol,
        asset_class: t.asset_class,
        side: isBuy ? "buy" : "sell",
        qty: Number(t.qty),
        price: Number(t.price),
        created_at: t.created_at,
      });
    }
    if (!data || data.length < TRADES_PAGE) return fills;
  }
  console.error("[getRealizedPnl] trade history exceeds the replay bound", { pages: MAX_TRADE_PAGES });
  throw new Error("INTERNAL_ERROR");
}

/**
 * Realized results for the signed-in trader. The full fill history is always
 * replayed (cost basis depends on every earlier buy), then the sell fills are
 * filtered to the requested Asia/Riyadh days and symbol and grouped into
 * closed exits (one per sell order).
 *
 * Fills come from the executed trades (so partial fills, and market orders
 * whose unfilled remainder was cancelled, count exactly), primary unit
 * allocations (acquired at the issue price), plus orders that were filled
 * before the matching engine existed and therefore have no trade rows.
 */
export const getRealizedPnl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseInput(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [trades, { data: orders, error: ordersErr }, { data: issuances, error: issuancesErr }] = await Promise.all([
      allMyFills(userId),
      supabase
        .from("orders")
        .select("id, symbol, asset_class, side, qty, filled_price, filled_at, created_at, status")
        .eq("user_id", userId)
        .eq("status", "filled")
        .order("filled_at", { ascending: true })
        .limit(5000),
      supabase
        .from("unit_issuances")
        .select("id, symbol, qty, price, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(5000),
    ]);
    if (ordersErr || issuancesErr) {
      const err = ordersErr ?? issuancesErr;
      console.error("[getRealizedPnl] query failed", err?.code ?? "", err?.message ?? "");
      throw new Error("INTERNAL_ERROR");
    }

    const tradedOrderIds = new Set(trades.map((t) => t.order_id));
    const fills: FilledOrder[] = [
      ...(orders ?? [])
        .filter((o) => !tradedOrderIds.has(o.id))
        .map((o) => ({ ...o, source: "order" as const, fill_id: o.id })),
      ...(issuances ?? []).map((i) => ({
        id: i.id,
        symbol: i.symbol,
        asset_class: "brand",
        side: "buy",
        qty: i.qty,
        filled_price: i.price,
        filled_at: i.created_at,
        created_at: i.created_at,
        source: "issuance" as const,
        fill_id: i.id,
      })),
      ...trades.map((t) => ({
        id: t.order_id ?? t.id,
        symbol: t.symbol,
        asset_class: t.asset_class,
        side: t.side,
        qty: t.qty,
        filled_price: t.price,
        filled_at: t.created_at,
        created_at: t.created_at,
        source: "trade" as const,
        fill_id: t.id,
      })),
    ];

    const sells = filterFills(computeRealizedFills(fills), {
      from: data.from,
      to: data.to,
      symbol: data.symbol,
    });
    return summarize(sells);
  });
