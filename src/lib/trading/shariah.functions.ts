import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/audit/audit.server";

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
    await writeAudit(supabase, {
      actorId: userId, action: "shariah.decision.create", entity: "shariah_decisions", entityId: row.id,
      metadata: { symbol: data.symbol, status: data.status },
    });
    try {
      const { notifyShariahDecision } = await import("./shariah-notify.server");
      await notifyShariahDecision({
        decisionId: row.id,
        symbol: data.symbol,
        status: data.status,
        reason: data.reason ?? null,
      });
    } catch (err) {
      console.error("[shariah] notify failed", err);
    }
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
    .select("id, symbol, status, reason, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  return data ?? [];
});

const UpdateInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["halal", "non_halal", "reviewing"]),
  reason: z.string().max(600).optional(),
  changeReason: z.string().min(1).max(600),
});
export const updateShariahDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isReviewer } = await supabase.rpc("has_role", { _user_id: userId, _role: "shariah_board" });
    if (!isReviewer) throw new Error("FORBIDDEN");

    const { error } = await supabase.from("shariah_decisions").update({
      status: data.status,
      reason: data.reason ?? null,
      updated_by: userId,
    }).eq("id", data.id);
    if (error) throw new Error(error.message);

    // Attach change_reason to the last-created audit row for this decision
    const { data: latest } = await supabase
      .from("shariah_decision_audit")
      .select("id")
      .eq("decision_id", data.id)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest?.id) {
      await supabase.from("shariah_decision_audit").update({ change_reason: data.changeReason }).eq("id", latest.id);
    }
    await writeAudit(supabase, {
      actorId: userId, action: "shariah.decision.update", entity: "shariah_decisions", entityId: data.id,
      metadata: { status: data.status, changeReason: data.changeReason },
    });
    try {
      const { notifyShariahDecision } = await import("./shariah-notify.server");
      await notifyShariahDecision({
        decisionId: data.id,
        symbol: (await supabase.from("shariah_decisions").select("symbol").eq("id", data.id).maybeSingle()).data?.symbol ?? "",
        status: data.status,
        reason: data.reason ?? null,
      });
    } catch (err) {
      console.error("[shariah] notify failed", err);
    }
    return { ok: true };
  });

export const listDecisionAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ decisionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("shariah_decision_audit")
      .select("*")
      .eq("decision_id", data.decisionId)
      .order("changed_at", { ascending: false });
    return rows ?? [];
  });