import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  symbol: z.string().min(1).max(32),
  status: z.enum(["halal", "non_halal", "reviewing"]),
  reason: z.string().max(600).optional(),
});

export const recordShariahDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isReviewer } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "shariah_board",
    });
    if (!isReviewer) throw new Error("FORBIDDEN");

    const { data: row, error } = await supabase
      .from("shariah_decisions")
      .insert({
        symbol: data.symbol,
        status: data.status,
        reason: data.reason ?? null,
        reviewer_id: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listShariahDecisions = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data } = await client
    .from("shariah_decisions")
    .select("id, symbol, status, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  return data ?? [];
});