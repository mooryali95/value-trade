import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  isBuyBlockedByShariah,
  parseModifyInput,
  parseOrderIdInput,
  toEngineResult,
  tradingErrorCode,
} from "./calc";

/**
 * Order lifecycle. Users have no write access to `orders`/`orders_audit`:
 * every change goes through a SECURITY DEFINER function (service role only)
 * that takes the per-symbol matching lock, checks ownership and state, and
 * writes the audit trail. The caller's id always comes from the verified JWT.
 */

/** Same bucket as placeOrder: order placements per trader per minute. */
const ORDER_RATE_LIMIT = 60;

type RpcError = { message: string; code?: string | null };

function engineError(tag: string, error: RpcError): Error {
  const code = tradingErrorCode(error.message);
  if (code === "INTERNAL_ERROR") console.error(`[${tag}] rpc failed`, error.code ?? "", error.message);
  return new Error(code);
}

type UserClient = SupabaseClient<Database>;

async function requireTrader(supabase: UserClient, userId: string): Promise<void> {
  const { data: isTrader } = await supabase.rpc("has_role", { _user_id: userId, _role: "trader" });
  if (!isTrader) throw new Error("FORBIDDEN_TRADER_REQUIRED");
}

/**
 * Pre-flight for re-placing an order: it must be the caller's own, and a buy
 * must not target a symbol whose ruling in force is non_halal (fail closed).
 * The database re-checks all of this under the matching lock.
 */
async function preflightOwnOrder(supabase: UserClient, orderId: string): Promise<void> {
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, symbol, side")
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    console.error("[orders] order lookup failed", error.code ?? "", error.message);
    throw new Error("INTERNAL_ERROR");
  }
  if (!order) throw new Error("ORDER_NOT_OPEN");
  if (order.side !== "buy") return;
  const { data: ruling, error: rulingErr } = await supabase
    .from("shariah_decisions")
    .select("status")
    .eq("symbol", order.symbol.toUpperCase())
    .order("effective_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rulingErr) {
    console.error("[orders] shariah lookup failed", rulingErr.code ?? "", rulingErr.message);
    throw new Error("INTERNAL_ERROR");
  }
  if (isBuyBlockedByShariah(ruling?.status, "buy")) throw new Error("SHARIAH_BLOCKED");
}

/**
 * Cancel one of the caller's resting (open/partial) orders. A partial fill
 * keeps its trades. Not gated on the trader role: an investor whose access
 * was withdrawn must still be able to pull their resting orders.
 */
export const cancelOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseOrderIdInput(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("cancel_order", {
      _user_id: context.userId,
      _order_id: data.orderId,
    });
    if (error) throw engineError("cancelOrder", error);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      ok: true as const,
      orderId: row?.order_id ?? data.orderId,
      status: "cancelled" as const,
      filledQty: Number(row?.filled_qty ?? 0),
    };
  });

/**
 * Undo a cancellation: the cancelled order's side, type, price and remaining
 * quantity are placed again as a NEW order, through every placement check.
 * Resolves to the new order.
 */
export const restoreOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseOrderIdInput(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireTrader(supabase, userId);
    const { assertRateLimit } = await import("@/lib/security/rate-limit.server");
    await assertRateLimit(`orders:${userId}`, ORDER_RATE_LIMIT, 60);
    await preflightOwnOrder(supabase, data.orderId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("restore_order", {
      _user_id: userId,
      _order_id: data.orderId,
    });
    if (error) throw engineError("restoreOrder", error);
    const result = toEngineResult(rows);
    if (!result) throw new Error("INTERNAL_ERROR");
    return result;
  });

/**
 * Modify = atomic replace: the resting order is cancelled and a NEW limit
 * order with the given price and quantity is placed through every placement
 * check, in one database transaction. If the new order is rejected the old
 * one stays exactly as it was. `qty` is the new order's quantity (for a
 * partially filled order, the quantity still wanted). Resolves to the new
 * order.
 */
export const modifyOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseModifyInput(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireTrader(supabase, userId);
    const { assertRateLimit } = await import("@/lib/security/rate-limit.server");
    await assertRateLimit(`orders:${userId}`, ORDER_RATE_LIMIT, 60);
    await preflightOwnOrder(supabase, data.orderId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("replace_order", {
      _user_id: userId,
      _order_id: data.orderId,
      _price: data.price,
      _qty: data.qty,
    });
    if (error) throw engineError("modifyOrder", error);
    const result = toEngineResult(rows);
    if (!result) throw new Error("INTERNAL_ERROR");
    return result;
  });

/** The caller's own audit trail for one order (RLS: owner only, read-only). */
export const listOrderAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("orders_audit")
      .select("*")
      .eq("order_id", data.orderId)
      .order("changed_at", { ascending: false });
    return rows ?? [];
  });
