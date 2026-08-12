import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Cash movements. The balance shown anywhere in the app is always the
 * `balance_after` of the newest ledger row -- nothing writes
 * `portfolios.cash_balance` directly except `post_cash_movement`.
 */

export const listCashLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("cash_ledger")
      .select("id, kind, amount, balance_after, note, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const AdjustInput = z.object({
  userId: z.string().uuid(),
  kind: z.enum(["deposit", "withdrawal", "adjustment"]),
  amount: z.number().positive().max(1_000_000_000),
  note: z.string().max(280).optional(),
});

/** Deposits/withdrawals are a platform-admin operation, never self-service. */
export const adjustCash = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AdjustInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "platform_admin",
    });
    if (!isAdmin) throw new Error("FORBIDDEN_ADMIN_REQUIRED");

    const signed = data.kind === "withdrawal" ? -data.amount : data.amount;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: balance, error } = await supabaseAdmin.rpc("post_cash_movement" as never, {
      _user_id: data.userId,
      _kind: data.kind,
      _amount: signed,
      _ref_order_id: null,
      _note: data.note ?? null,
      _actor_id: userId,
    } as never);
    if (error) throw new Error(error.message);
    return { balance: Number(balance) };
  });
