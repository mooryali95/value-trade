import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const cancelOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isTrader } = await supabase.rpc("has_role", { _user_id: userId, _role: "trader" });
    if (!isTrader) throw new Error("FORBIDDEN_TRADER_REQUIRED");
    const { data: existing, error: readErr } = await supabase
      .from("orders").select("id, status, qty, price, user_id").eq("id", data.orderId).single();
    if (readErr || !existing) throw new Error("ORDER_NOT_FOUND");
    if (existing.user_id !== userId) throw new Error("FORBIDDEN");
    if (existing.status !== "pending") throw new Error("ORDER_NOT_PENDING");

    const { error: updErr } = await supabase.from("orders").update({ status: "cancelled" }).eq("id", data.orderId);
    if (updErr) throw new Error(updErr.message);
    await supabase.from("orders_audit").insert({
      order_id: data.orderId,
      action: "cancel",
      previous_qty: existing.qty,
      previous_price: existing.price,
      changed_by: userId,
    });
    return { ok: true };
  });

const ModifyInput = z.object({
  orderId: z.string().uuid(),
  qty: z.number().positive().max(1_000_000),
  price: z.number().positive(),
});
export const modifyOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ModifyInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isTrader } = await supabase.rpc("has_role", { _user_id: userId, _role: "trader" });
    if (!isTrader) throw new Error("FORBIDDEN_TRADER_REQUIRED");
    const { data: existing, error: readErr } = await supabase
      .from("orders").select("id, status, qty, price, user_id").eq("id", data.orderId).single();
    if (readErr || !existing) throw new Error("ORDER_NOT_FOUND");
    if (existing.user_id !== userId) throw new Error("FORBIDDEN");
    if (existing.status !== "pending") throw new Error("ORDER_NOT_PENDING");

    const { error: updErr } = await supabase
      .from("orders")
      .update({ qty: data.qty, price: data.price, status: "modified" })
      .eq("id", data.orderId);
    if (updErr) throw new Error(updErr.message);
    await supabase.from("orders_audit").insert({
      order_id: data.orderId,
      action: "modify",
      previous_qty: existing.qty,
      previous_price: existing.price,
      new_qty: data.qty,
      new_price: data.price,
      changed_by: userId,
    });
    return { ok: true };
  });

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