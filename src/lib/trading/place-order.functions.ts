import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isBuyBlockedByShariah, parseOrderInput, toEngineResult, tradingErrorCode } from "./calc";

/** Order placements/modifications/restores per trader per minute. */
const ORDER_RATE_LIMIT = 60;

/**
 * Places an order on the internal book. Every market rule is enforced by
 * `match_order` inside the database (whole-unit qty, 0.01 tick, published
 * instrument, current Shariah ruling, ±20% price band, 5,000,000 max
 * notional, buying power / holdings, market-order price protection); the
 * checks here only fail fast. A market order never rests: whatever cannot
 * fill inside the band is cancelled, so it may resolve 'cancelled' with
 * filledQty 0.
 */
export const placeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseOrderInput(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Role gate first: an unauthorized caller must never reach the database.
    const { data: isTrader } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "trader",
    });
    if (!isTrader) throw new Error("FORBIDDEN_TRADER_REQUIRED");

    const { assertRateLimit } = await import("@/lib/security/rate-limit.server");
    await assertRateLimit(`orders:${userId}`, ORDER_RATE_LIMIT, 60);

    // The instrument is resolved from `public.brands` -- the single source of
    // truth. Unpublished instruments are not tradable.
    const { getInstrument } = await import("@/lib/instruments/instrument.server");
    let brand: Awaited<ReturnType<typeof getInstrument>>;
    try {
      brand = await getInstrument(supabase, data.symbolSlug);
    } catch (err) {
      console.error("[placeOrder] instrument lookup failed", err instanceof Error ? err.message : err);
      throw new Error("INTERNAL_ERROR");
    }
    if (!brand || !brand.published) throw new Error("INSTRUMENT_NOT_FOUND");

    // Shariah gate: the ruling in force is the most recent change (new
    // decision or status edit, `effective_at`) for the symbol. Selling stays
    // allowed so holders can exit. If the ruling cannot be read, the buy is
    // refused (fail closed); the engine re-checks anyway.
    if (data.side === "buy") {
      const { data: ruling, error: rulingErr } = await supabase
        .from("shariah_decisions")
        .select("status")
        .eq("symbol", brand.symbol.toUpperCase())
        .order("effective_at", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (rulingErr) {
        console.error("[placeOrder] shariah lookup failed", rulingErr.code ?? "", rulingErr.message);
        throw new Error("INTERNAL_ERROR");
      }
      if (isBuyBlockedByShariah(ruling?.status, data.side)) throw new Error("SHARIAH_BLOCKED");
    }

    // The order book is the execution venue: `match_order` validates the
    // order, inserts it, matches it by price-then-time priority (partial
    // fills allowed), records every fill in `trades`, and moves positions
    // plus ledgered cash for both counterparties atomically.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: matched, error: matchErr } = await supabaseAdmin.rpc("match_order", {
      _user_id: userId,
      _symbol: brand.symbol,
      _asset_class: brand.assetClass,
      _side: data.side,
      _type: data.type,
      _qty: data.qty,
      _limit_price: data.type === "limit" ? data.price : undefined,
    });
    if (matchErr) {
      const code = tradingErrorCode(matchErr.message);
      if (code === "INTERNAL_ERROR") {
        console.error("[placeOrder] match_order failed", matchErr.code ?? "", matchErr.message);
      }
      throw new Error(code);
    }
    const result = toEngineResult(matched);
    if (!result) {
      console.error("[placeOrder] match_order returned no row");
      throw new Error("INTERNAL_ERROR");
    }

    const { data: refreshed } = await supabase
      .from("portfolios")
      .select("cash_balance")
      .eq("user_id", userId)
      .maybeSingle();

    return {
      orderId: result.orderId,
      status: result.status,
      filledQty: result.filledQty,
      filledPrice: result.filledPrice,
      cashBalance: Number(refreshed?.cash_balance ?? 0),
    };
  });
