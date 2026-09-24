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

    // Symbols are stored upper-case (the database normalizes too); the same
    // normalized value is used for the audit row and the notification, whose
    // recipient lookups (positions, watchers, alerts) match it exactly.
    const symbol = data.symbol.trim().toUpperCase();

    // reviewer_id / updated_by are stamped from the session by the database.
    // A non_halal ruling cancels every resting buy on the symbol in the same
    // transaction.
    const { data: row, error } = await supabase
      .from("shariah_decisions")
      .insert({
        symbol,
        status: data.status,
        reason: data.reason ?? null,
      })
      // Not "*": reviewer_id / updated_by are not readable by API users.
      .select("id, symbol, status, reason, created_at, updated_at, effective_at")
      .single();
    if (error) {
      console.error("[shariah] insert failed", error.code ?? "", error.message);
      throw new Error(error.code === "42501" ? "FORBIDDEN" : "INTERNAL_ERROR");
    }
    await writeAudit(supabase, {
      actorId: userId, action: "shariah.decision.create", entity: "shariah_decisions", entityId: row.id,
      metadata: { symbol, status: data.status },
    });
    try {
      const { notifyShariahDecision } = await import("./shariah-notify.server");
      await notifyShariahDecision({
        decisionId: row.id,
        symbol,
        status: data.status,
        reason: data.reason ?? null,
      });
    } catch (err) {
      console.error("[shariah] notify failed", err);
    }
    return row;
  });

/**
 * Every recorded ruling, newest change first (at most 100), for the Shariah
 * review console: Shariah board members and platform admins only (the
 * database shows other users the rulings of listed instruments only; the
 * public pages use getPublicShariahRulings).
 */
export const listShariahDecisions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [board, admin] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "shariah_board" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "platform_admin" }),
    ]);
    if (board.error || admin.error) {
      console.error("[shariah] has_role failed", board.error?.code ?? admin.error?.code ?? "unknown");
      throw new Error("INTERNAL_ERROR");
    }
    if (!board.data && !admin.data) throw new Error("FORBIDDEN");
    const { data, error } = await supabase
      .from("shariah_decisions")
      .select("id, symbol, status, reason, created_at, updated_at, effective_at")
      // Most recent change first: the first row per symbol is the ruling in force.
      .order("effective_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("[shariah] list failed", error.code || "unknown");
      throw new Error("INTERNAL_ERROR");
    }
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

    const { data: updated, error } = await supabase.from("shariah_decisions").update({
      status: data.status,
      reason: data.reason ?? null,
    }).eq("id", data.id).select("id, symbol");
    if (error) {
      console.error("[shariah] update failed", error.code ?? "", error.message);
      throw new Error(error.code === "42501" ? "FORBIDDEN" : "INTERNAL_ERROR");
    }
    if (!updated || updated.length === 0) throw new Error("DECISION_NOT_FOUND");

    // Attach change_reason to the audit row this update just wrote (the
    // trigger records changed_by = the session user). The audit table is
    // not user-writable, so this goes through the service role.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: latest } = await supabaseAdmin
      .from("shariah_decision_audit")
      .select("id")
      .eq("decision_id", data.id)
      .eq("changed_by", userId)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest?.id) {
      const { error: reasonErr } = await supabaseAdmin
        .from("shariah_decision_audit")
        .update({ change_reason: data.changeReason })
        .eq("id", latest.id);
      if (reasonErr) console.error("[shariah] change_reason update failed", reasonErr.code ?? "", reasonErr.message);
    }
    await writeAudit(supabase, {
      actorId: userId, action: "shariah.decision.update", entity: "shariah_decisions", entityId: data.id,
      metadata: { status: data.status, changeReason: data.changeReason },
    });
    try {
      const { notifyShariahDecision } = await import("./shariah-notify.server");
      await notifyShariahDecision({
        decisionId: data.id,
        symbol: updated[0]?.symbol ?? "",
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