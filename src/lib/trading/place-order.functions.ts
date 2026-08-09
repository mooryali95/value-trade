import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getBrand } from "@/lib/mock-data";
import { applyFill } from "./calc";

const InputSchema = z.object({
  symbolSlug: z.string().min(1).max(64),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["limit", "market"]),
  qty: z.number().positive().max(1_000_000),
  price: z.number().positive().optional(),
});

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
    if (data.type === "market") {
      const { data: lastTrade } = await supabase.rpc("get_symbol_last_trade" as any, {
        _symbol: brand.symbol,
      });
      const row = Array.isArray(lastTrade) ? lastTrade[0] : lastTrade;
      if (row?.last_price != null) referencePrice = Number(row.last_price);
    }
    const fillPrice = data.type === "market" ? referencePrice : (data.price ?? brand.price);
    const notional = fillPrice * data.qty;

    const { data: isTrader } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "trader",
    });
    if (!isTrader) throw new Error("FORBIDDEN_TRADER_REQUIRED");

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

    await supabase.from("portfolios").update({ cash_balance: nextCash }).eq("id", pf.id);

    return { order, filledPrice: fillPrice, cashBalance: nextCash };
  });
