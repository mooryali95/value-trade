import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toStableError } from "@/lib/ops/errors.server";

const SubmitInput = z.object({
  companyId: z.string().uuid(),
  asset_class: z.enum(["stock", "sukuk", "brand"]),
  symbol: z.string().trim().regex(/^[A-Za-z0-9._-]{1,32}$/, "INVALID_SYMBOL"),
  name_ar: z.string().min(1).max(160),
  name_en: z.string().min(1).max(160),
  sector: z.string().max(80).optional(),
  prospectus_url: z.string().url().max(500).optional(),
});

/** Stable codes instead of a raw validation dump. */
export function parseSubmitInput(input: unknown): z.infer<typeof SubmitInput> {
  const parsed = SubmitInput.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw new Error(field === "symbol" ? "INVALID_SYMBOL" : field === "companyId" ? "FORBIDDEN" : "INVALID_INPUT");
  }
  return parsed.data;
}

export const submitProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseSubmitInput(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("product_submissions")
      .insert({
        company_id: data.companyId,
        submitted_by: userId,
        asset_class: data.asset_class,
        symbol: data.symbol,
        name_ar: data.name_ar,
        name_en: data.name_en,
        sector: data.sector ?? null,
        prospectus_url: data.prospectus_url ?? null,
      })
      .select("*")
      .single();
    if (error) throw toStableError("submissions.submit", error, "FORBIDDEN");
    return row;
  });

export const listCompanySubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("product_submissions")
      .select("*")
      .eq("company_id", data.companyId)
      .order("submitted_at", { ascending: false });
    return rows ?? [];
  });

export const listPendingSubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isReviewer } = await supabase.rpc("has_role", { _user_id: userId, _role: "shariah_board" });
    if (!isReviewer) throw new Error("FORBIDDEN");
    const { data: rows, error } = await supabase
      .from("product_submissions")
      .select("*")
      .order("submitted_at", { ascending: false })
      .limit(200);
    if (error) throw toStableError("submissions.listPending", error);
    // A Shariah board reviewer is not a member of the submitting companies,
    // so companies RLS hides them: the display names are resolved with the
    // service role, after the reviewer check, for these submissions only.
    const submissions = rows ?? [];
    const companyIds = Array.from(new Set(submissions.map((r) => r.company_id)));
    const names = new Map<string, { name_ar: string; name_en: string; slug: string }>();
    if (companyIds.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: companies, error: coErr } = await supabaseAdmin
        .from("companies")
        .select("id, name_ar, name_en, slug")
        .in("id", companyIds);
      if (coErr) throw toStableError("submissions.listPending.companies", coErr);
      for (const c of companies ?? []) names.set(c.id, { name_ar: c.name_ar, name_en: c.name_en, slug: c.slug });
    }
    return submissions.map((r) => ({ ...r, companies: names.get(r.company_id) ?? null }));
  });

const ReviewInput = z
  .object({
    submissionId: z.string().uuid(),
    status: z.enum(["approved", "rejected"]),
    reason: z.string().max(600).optional(),
  })
  // A rejection must always carry a reason the applicant can act on.
  .refine((v) => v.status !== "rejected" || (v.reason ?? "").trim().length >= 10, {
    message: "REJECTION_REASON_REQUIRED",
    path: ["reason"],
  });
export const reviewSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isReviewer } = await supabase.rpc("has_role", { _user_id: userId, _role: "shariah_board" });
    if (!isReviewer) throw new Error("FORBIDDEN");

    const { data: sub, error: subErr } = await supabase
      .from("product_submissions")
      .select("id, company_id, asset_class, symbol, name_ar, name_en, sector, status")
      .eq("id", data.submissionId)
      .maybeSingle();
    if (subErr) throw toStableError("submissions.review.read", subErr);
    if (!sub) throw new Error("SUBMISSION_NOT_FOUND");
    if (sub.status !== "pending") throw new Error("SUBMISSION_NOT_PENDING");

    // Approval closes the loop: the accepted product becomes a published,
    // tradable instrument in `public.brands`. The brand is written FIRST, so a
    // failure (symbol owned by another company, DB error) leaves the
    // submission pending and the reviewer can retry; the status flip below is
    // conditional on `pending`, so a concurrent review cannot double-apply.
    if (data.status === "approved") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const symbol = sub.symbol.trim().toUpperCase();
      if (!/^[A-Z0-9._-]{1,32}$/.test(symbol)) throw new Error("INVALID_SYMBOL");

      const { data: existing, error: lookupErr } = await supabaseAdmin
        .from("brands")
        .select("id, company_id")
        .eq("symbol", symbol)
        .maybeSingle();
      if (lookupErr) throw toStableError("submissions.review.brand_lookup", lookupErr);
      if (existing && existing.company_id !== sub.company_id) throw new Error("SYMBOL_TAKEN");

      const brand = {
        name_ar: sub.name_ar,
        name_en: sub.name_en,
        sector: sub.sector,
        asset_class: sub.asset_class,
        published: true,
        company_id: sub.company_id,
        source_submission_id: sub.id,
      };
      if (existing) {
        const { error: updErr } = await supabaseAdmin
          .from("brands")
          .update(brand)
          .eq("id", existing.id)
          .eq("company_id", sub.company_id);
        if (updErr) throw toStableError("submissions.review.brand_update", updErr);
      } else {
        const { error: insErr } = await supabaseAdmin
          .from("brands")
          .insert({ ...brand, symbol, slug: symbol.toLowerCase() });
        if (insErr) {
          // Lost a race on symbol/slug with another company's approval.
          if (insErr.code === "23505") throw new Error("SYMBOL_TAKEN");
          throw toStableError("submissions.review.brand_insert", insErr);
        }
      }
    }

    const { data: updated, error } = await supabase
      .from("product_submissions")
      .update({
        status: data.status,
        reviewer_id: userId,
        review_reason: data.reason ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.submissionId)
      .eq("status", "pending")
      .select("id");
    if (error) throw toStableError("submissions.review.update", error);
    if (!updated || updated.length === 0) throw new Error("SUBMISSION_NOT_PENDING");
    return { ok: true };
  });
