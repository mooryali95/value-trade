import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseOr } from "@/lib/security/parse-input";

const Input = z.object({
  symbol: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  direction: z.enum(["above", "below"]),
  targetPrice: z.number().positive().max(1_000_000_000),
});

/**
 * The database accepts an alert on a listed instrument only (RLS; the
 * symbol is stored upper-case) and at most 100 alerts per account
 * (ALERT_LIMIT_REACHED).
 */
export const createPriceAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseOr(Input, input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("price_alerts")
      .insert({
        user_id: userId,
        symbol: data.symbol.toUpperCase(),
        direction: data.direction,
        target_price: data.targetPrice,
        active: true,
      })
      .select("*")
      .single();
    if (error) {
      if ((error.message ?? "").trim() === "ALERT_LIMIT_REACHED") throw new Error("ALERT_LIMIT_REACHED");
      // Row-level security: the symbol is not a listed instrument.
      if (error.code === "42501") throw new Error("INSTRUMENT_NOT_FOUND");
      console.error("[alerts] insert failed", error.code ?? "");
      throw new Error("INTERNAL_ERROR");
    }
    return row;
  });

export const listMyAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("price_alerts")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    return data ?? [];
  });
