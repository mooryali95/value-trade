import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyPortfolio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    await supabase.from("portfolios").upsert(
      { user_id: userId },
      { onConflict: "user_id", ignoreDuplicates: true },
    );

    const [{ data: pf }, { data: positions }, { data: orders }] = await Promise.all([
      supabase.from("portfolios").select("*").eq("user_id", userId).single(),
      supabase.from("positions").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
      supabase.from("orders").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    ]);

    return {
      portfolio: pf ?? null,
      positions: positions ?? [],
      orders: orders ?? [],
    };
  });