import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/audit/audit.server";

/** Validation failures reach the browser as a stable code, not a zod dump. */
function parseOr<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_INPUT");
  return parsed.data;
}

const Input = z.object({
  symbol: z.string().min(1).max(32),
  status: z.enum(["halal", "non_halal", "reviewing"]),
  reason: z.string().max(600).optional(),
});

export const recordShariahDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseOr(Input, input))
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
    if (!/^[A-Z0-9._-]{1,32}$/.test(symbol)) throw new Error("INSTRUMENT_NOT_FOUND");

    // A ruling is recorded for an existing instrument only, listed or not
    // (unlisted ones are ruled on before a platform admin lists them).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: brand, error: brandErr } = await supabaseAdmin
      .from("brands")
      .select("id")
      .eq("symbol", symbol)
      .maybeSingle();
    if (brandErr) {
      console.error("[shariah] instrument lookup failed", brandErr.code ?? "unknown");
      throw new Error("INTERNAL_ERROR");
    }
    if (!brand) throw new Error("INSTRUMENT_NOT_FOUND");

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
  .inputValidator((input: unknown) => parseOr(UpdateInput, input))
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
  .inputValidator((input: unknown) => parseOr(z.object({ decisionId: z.string().uuid() }), input))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("shariah_decision_audit")
      .select("*")
      .eq("decision_id", data.decisionId)
      .order("changed_at", { ascending: false });
    return rows ?? [];
  });
export type ReviewInstrument = {
  symbol: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  sector: string | null;
  assetClass: string;
  published: boolean;
  hasCompany: boolean;
  /** Status of the product submission that created it, if any. */
  submissionStatus: string | null;
  shariahStatus: "halal" | "non_halal" | "reviewing" | null;
  rulingEffectiveAt: string | null;
};

/**
 * Every instrument a Shariah reviewer can rule on, listed or not, with the
 * ruling in force (reviewer_instruments re-checks the role in SQL). Shariah
 * board members and platform admins only.
 */
export const listReviewInstruments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReviewInstrument[]> => {
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("reviewer_instruments" as never, { _actor_id: userId } as never);
    if (error) {
      console.error("[shariah] reviewer_instruments failed", (error as { code?: string }).code ?? "unknown");
      throw new Error((error as { message?: string }).message === "FORBIDDEN" ? "FORBIDDEN" : "INTERNAL_ERROR");
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      symbol: String(r.symbol),
      slug: String(r.slug),
      nameAr: String(r.name_ar),
      nameEn: String(r.name_en),
      sector: (r.sector as string | null) ?? null,
      assetClass: String(r.asset_class),
      published: r.published === true,
      hasCompany: r.has_company === true,
      submissionStatus: (r.submission_status as string | null) ?? null,
      shariahStatus: (r.shariah_status as ReviewInstrument["shariahStatus"]) ?? null,
      rulingEffectiveAt: (r.ruling_effective_at as string | null) ?? null,
    }));
  });
