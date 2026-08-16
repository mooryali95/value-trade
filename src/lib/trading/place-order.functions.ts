import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getBrand } from "@/lib/mock-data";
import { applyFill, isBuyBlockedByShariah } from "./calc";

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
    const brand = getBrand(data.symbolSlug);
    if (!brand) throw new Error("SYMBOL_NOT_FOUND");

    const { supabase, userId } = context;

    // Market orders fill at the real last-traded price when one exists --
    // otherwise the reference price (brand.price, 100 by default) stands
    // until the first real trade sets it. Limit orders always use the
    // trader's own specified price, same as before.
    let referencePrice = brand.price;
    {
      const { data: lastTrade } = await supabase.rpc("get_symbol_last_trade" as any, {
        _symbol: brand.symbol,
      });
      const row = Array.isArray(lastTrade) ? lastTrade[0] : lastTrade;
      if (row?.last_price != null) referencePrice = Number(row.last_price);
    }
    const fillPrice = data.type === "market" ? referencePrice : (data.price ?? brand.price);
    const notional = fillPrice * data.qty;

    // Risk guards run before any state changes: an oversized order or a price
    // far outside the daily band is rejected instead of filled.
    if (notional > MAX_ORDER_NOTIONAL) throw new Error("ORDER_TOO_LARGE");
    if (data.type === "limit" && referencePrice > 0) {
      const low = referencePrice * (1 - PRICE_BAND);
      const high = referencePrice * (1 + PRICE_BAND);
      if (fillPrice < low || fillPrice > high) throw new Error("PRICE_OUT_OF_BAND");
    }

    const { data: isTrader } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "trader",
    });
    if (!isTrader) throw new Error("FORBIDDEN_TRADER_REQUIRED");

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

    // Ensure portfolio exists (idempotent).
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
      .select("qty, avg_price")
      .eq("user_id", userId)
      .eq("symbol", brand.symbol)
      .maybeSingle();

    const currentQty = Number(existing?.qty ?? 0);
    const currentAvg = Number(existing?.avg_price ?? 0);

    if (data.side === "buy" && Number(pf.cash_balance) < notional)
      throw new Error("INSUFFICIENT_CASH");
    if (data.side === "sell" && currentQty < data.qty) throw new Error("INSUFFICIENT_QTY");

    const next = applyFill(
      { qty: currentQty, avgPrice: currentAvg },
      data.side,
      data.qty,
      fillPrice,
    );
    const nextCash = Number(pf.cash_balance) + (data.side === "buy" ? -notional : notional);

    // Insert filled order
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        user_id: userId,
        symbol: brand.symbol,
        asset_class: brand.assetClass ?? "brand",
        side: data.side,
        type: data.type,
        qty: data.qty,
        price: data.price ?? null,
        status: "filled",
        filled_at: new Date().toISOString(),
        filled_price: fillPrice,
      })
      .select("*")
      .single();
    if (orderErr) throw new Error(orderErr.message);

    if (next.qty === 0 && existing) {
      await supabase.from("positions").delete().eq("user_id", userId).eq("symbol", brand.symbol);
    } else {
      await supabase.from("positions").upsert(
        {
          user_id: userId,
          symbol: brand.symbol,
          asset_class: brand.assetClass ?? "brand",
          qty: next.qty,
          avg_price: next.avgPrice,
        },
        { onConflict: "user_id,symbol" },
      );
    }

    // Cash is ledgered, never overwritten: one signed movement per fill and
    // the balance is derived inside `post_cash_movement`.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: balance, error: cashErr } = await supabaseAdmin.rpc(
      "post_cash_movement" as never,
      {
        _user_id: userId,
        _kind: data.side === "buy" ? "order_buy" : "order_sell",
        _amount: data.side === "buy" ? -notional : notional,
        _ref_order_id: order.id,
        _note: `${data.side} ${data.qty} ${brand.symbol} @ ${fillPrice}`,
        _actor_id: userId,
      } as never,
    );
    if (cashErr) throw new Error(cashErr.message);

    return { order, filledPrice: fillPrice, cashBalance: Number(balance ?? nextCash) };
  });
