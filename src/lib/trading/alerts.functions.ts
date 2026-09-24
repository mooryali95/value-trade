import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  symbol: z.string().min(1).max(32),
  direction: z.enum(["above", "below"]),
  targetPrice: z.number().positive(),
});

export const createPriceAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("price_alerts")
      .insert({
        user_id: userId,
        symbol: data.symbol,
        direction: data.direction,
        target_price: data.targetPrice,
        active: true,
      })
      .select("*")
      .single();
    if (error) {
      console.error("[alerts] insert failed", error.code ?? "", error.message);
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