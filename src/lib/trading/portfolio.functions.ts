import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { num, summarizePortfolio, valuePosition, type SnapshotRow } from "./valuation";

export type { MarkSource, PortfolioSummary, ValuedPosition } from "./valuation";

/**
 * The signed-in investor's portfolio. Cash and orders are read with the
 * user's session (RLS, own rows). Holdings, their market prices, the cash
 * reserved by resting buy orders and the buying power come from the
 * database's own definitions (portfolio_positions, open_buy_reserve,
 * buying_power), called with the service role for the verified user id
 * only. A holding is valued at the instrument's last execution price, else
 * its reference price, else not at all; never at the investor's own cost.
 * Portfolios are created when an admin funds the investor or when they
 * first trade; until then `portfolio` is null (cash 0, no positions).
 */
export const getMyPortfolio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // These functions are newer than the generated types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (fn: string, args: Record<string, unknown>) => any;

    const [pfRes, ordersRes, snapRes, reserveRes, bpRes] = await Promise.all([
      supabase.from("portfolios").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("orders").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
      rpc("portfolio_positions", { _user_id: userId }),
      rpc("open_buy_reserve", { _user_id: userId }),
      rpc("buying_power", { _user_id: userId }),
    ]);
    for (const [name, r] of [
      ["portfolio", pfRes],
      ["orders", ordersRes],
      ["portfolio_positions", snapRes],
      ["open_buy_reserve", reserveRes],
      ["buying_power", bpRes],
    ] as const) {
      const err = (r as { error: { code?: string } | null }).error;
      if (err) {
        console.error(`[getMyPortfolio] ${name} failed`, err.code ?? "");
        throw new Error("INTERNAL_ERROR");
      }
    }

    const positions = ((snapRes.data ?? []) as SnapshotRow[]).map(valuePosition);
    const cash = num(pfRes.data?.cash_balance) ?? 0;
    const reserved = num(reserveRes.data) ?? 0;
    const buyingPower = num(bpRes.data) ?? 0;

    return {
      portfolio: pfRes.data ?? null,
      positions,
      orders: ordersRes.data ?? [],
      summary: summarizePortfolio(positions, cash, reserved, buyingPower),
    };
  });
