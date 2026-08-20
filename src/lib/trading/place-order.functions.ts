import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isBuyBlockedByShariah } from "./calc";

const InputSchema = z.object({
  symbolSlug: z.string().min(1).max(64),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["limit", "market"]),
  qty: z.number().positive().max(1_000_000),
  price: z.number().positive().optional(),
});

/** Risk limits: a single order may not exceed this notional value. */
const MAX_ORDER_NOTIONAL = 5_000_000;
/** Limit orders must price within ±20% of the current reference price. */
const PRICE_BAND = 0.2;

export const placeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Role gate first: an unauthorized caller must never reach the database.
    const { data: isTrader } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "trader",
    });
    if (!isTrader) throw new Error("FORBIDDEN_TRADER_REQUIRED");

    // The instrument is resolved from `public.brands` -- the single source of
    // truth. Unpublished instruments are not tradable.
    const { getInstrument } = await import("@/lib/instruments/instrument.server");
    const brand = await getInstrument(supabase, data.symbolSlug);
    if (!brand) throw new Error("SYMBOL_NOT_FOUND");
    if (!brand.published) throw new Error("SYMBOL_NOT_TRADABLE");

    // Market orders fill at the real last-traded price when one exists --
    // otherwise the reference price (brand.price, 100 by default) stands
    // until the first real trade sets it. Limit orders always use the
    // trader's own specified price, same as before.
    let referencePrice = brand.referencePrice;
    {
      const { data: lastTrade } = await supabase.rpc("get_symbol_last_trade" as any, {
        _symbol: brand.symbol,
      });
      const row = Array.isArray(lastTrade) ? lastTrade[0] : lastTrade;
      if (row?.last_price != null) referencePrice = Number(row.last_price);
    }
    const fillPrice = data.type === "market" ? referencePrice : (data.price ?? brand.referencePrice);
    const notional = fillPrice * data.qty;

    // Risk guards run before any state changes: an oversized order or a price
    // far outside the daily band is rejected instead of filled.
    if (notional > MAX_ORDER_NOTIONAL) throw new Error("ORDER_TOO_LARGE");
    if (data.type === "limit" && referencePrice > 0) {
      const low = referencePrice * (1 - PRICE_BAND);
      const high = referencePrice * (1 + PRICE_BAND);
      if (fillPrice < low || fillPrice > high) throw new Error("PRICE_OUT_OF_BAND");
    }

    // Shariah gate: a symbol ruled non-halal cannot be bought. Selling an
    // existing position stays allowed so holders can exit.
    if (data.side === "buy") {
      const { data: ruling } = await supabase
        .from("shariah_decisions")
        .select("status")
        .eq("symbol", brand.symbol)
        .maybeSingle();
      if (isBuyBlockedByShariah(ruling?.status, data.side)) throw new Error("SHARIAH_BLOCKED");
    }

    // Ensure portfolio exists (idempotent), then pre-flight the trader's own
    // side so an unaffordable or unsellable order never enters the book.
    await supabase
      .from("portfolios")
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });

    const { data: pf, error: pfErr } = await supabase
      .from("portfolios")
      .select("id, cash_balance")
      .eq("user_id", userId)
      .single();
    if (pfErr || !pf) throw new Error("PORTFOLIO_UNAVAILABLE");

    const { data: existing } = await supabase
      .from("positions")
      .select("qty")
      .eq("user_id", userId)
      .eq("symbol", brand.symbol)
      .maybeSingle();
    const currentQty = Number(existing?.qty ?? 0);

    if (data.side === "buy" && Number(pf.cash_balance) < notional)
      throw new Error("INSUFFICIENT_CASH");
    if (data.side === "sell" && currentQty < data.qty) throw new Error("INSUFFICIENT_QTY");

    // The order book is the execution venue: `match_order` inserts the order,
    // matches it against resting opposite orders by price-then-time priority
    // (partial fills allowed), records every fill in `trades`, and moves
    // positions plus ledgered cash for both counterparties atomically.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: matched, error: matchErr } = await supabaseAdmin.rpc("match_order" as never, {
      _user_id: userId,
      _symbol: brand.symbol,
      _asset_class: brand.assetClass,
      _side: data.side,
      _type: data.type,
      _qty: data.qty,
      _limit_price: data.type === "limit" ? (data.price ?? null) : null,
    } as never);
    if (matchErr) throw new Error(matchErr.message);

    const result = (Array.isArray(matched) ? matched[0] : matched) as
      | { order_id: string; filled_qty: number; avg_price: number | null; status: string }
      | null;
    if (!result) throw new Error("ORDER_NOT_EXECUTED");

    const { data: order } = await supabase
      .from("orders")
      .select("*")
      .eq("id", result.order_id)
      .single();

    const { data: refreshed } = await supabase
      .from("portfolios")
      .select("cash_balance")
      .eq("user_id", userId)
      .single();

    return {
      order,
      filledQty: Number(result.filled_qty ?? 0),
      filledPrice: result.avg_price == null ? null : Number(result.avg_price),
      status: result.status,
      cashBalance: Number(refreshed?.cash_balance ?? pf.cash_balance),
    };
  });
