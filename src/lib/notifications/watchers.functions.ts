import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listMyWatchers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("symbol_watchers")
      .select("id, symbol, asset_class, created_at")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

const AddInput = z.object({
  symbol: z.string().min(1).max(32),
  asset_class: z.string().max(32).default("brand"),
});

export const addWatcher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AddInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("symbol_watchers")
      .upsert({ user_id: context.userId, symbol: data.symbol, asset_class: data.asset_class });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeWatcher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ symbol: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("symbol_watchers")
      .delete()
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol);
    if (error) throw new Error(error.message);
    return { ok: true };
  });