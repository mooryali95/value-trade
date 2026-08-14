import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeRealized, summarize } from "./realized";

const Input = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  symbol: z.string().max(32).optional(),
});

/**
 * Realized results for the signed-in trader. The full fill history is always
 * replayed (cost basis depends on every earlier buy), then the resulting
 * trades are filtered to the requested window.
 */
export const getRealizedPnl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, symbol, asset_class, side, qty, filled_price, filled_at, created_at, status")
      .eq("user_id", userId)
      .eq("status", "filled")
      .order("filled_at", { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);

    const all = computeRealized(orders ?? []);
    const filtered = all.trades.filter((tr) => {
      if (data.from && tr.at < data.from) return false;
      if (data.to && tr.at > `${data.to}T23:59:59.999Z`) return false;
      if (data.symbol && tr.symbol.toUpperCase() !== data.symbol.toUpperCase()) return false;
      return true;
    });
    return summarize(filtered);
  });
