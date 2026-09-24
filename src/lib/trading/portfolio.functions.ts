import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * The signed-in investor's portfolio (read-only, RLS own rows). Portfolios
 * are created by the database when an admin funds the investor or when they
 * first trade; until then `portfolio` is null, which reads as cash 0 and no
 * positions.
 */
export const getMyPortfolio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [{ data: pf }, { data: positions }, { data: orders }] = await Promise.all([
      supabase.from("portfolios").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("positions").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
      supabase.from("orders").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    ]);

    return {
      portfolio: pf ?? null,
      positions: positions ?? [],
      orders: orders ?? [],
    };
  });
