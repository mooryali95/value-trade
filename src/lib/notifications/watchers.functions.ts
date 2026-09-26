import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseOr } from "@/lib/security/parse-input";

export const listMyWatchers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("symbol_watchers")
      .select("id, symbol, asset_class, created_at")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

const SymbolInput = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/);
const AddInput = z.object({
  symbol: SymbolInput,
  asset_class: z.string().max(32).default("brand"),
});

/**
 * Watches a listed instrument. The database refuses an instrument that is
 * not listed (RLS) and more than 100 watched symbols per account
 * (WATCHLIST_LIMIT_REACHED); watching one twice is a no-op.
 */
export const addWatcher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseOr(AddInput, input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("symbol_watchers")
      .upsert(
        { user_id: context.userId, symbol: data.symbol.toUpperCase(), asset_class: data.asset_class },
        { onConflict: "user_id,symbol", ignoreDuplicates: true },
      );
    if (error) {
      if ((error.message ?? "").trim() === "WATCHLIST_LIMIT_REACHED") throw new Error("WATCHLIST_LIMIT_REACHED");
      if (error.code === "42501") throw new Error("INSTRUMENT_NOT_FOUND");
      console.error("[watchers] write failed", error.code ?? "");
      throw new Error("INTERNAL_ERROR");
    }
    return { ok: true };
  });

export const removeWatcher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseOr(z.object({ symbol: SymbolInput }), input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("symbol_watchers")
      .delete()
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol.toUpperCase());
    if (error) {
      console.error("[watchers] write failed", error.code ?? "");
      throw new Error("INTERNAL_ERROR");
    }
    return { ok: true };
  });
