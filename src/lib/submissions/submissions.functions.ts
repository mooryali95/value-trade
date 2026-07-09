import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SubmitInput = z.object({
  companyId: z.string().uuid(),
  asset_class: z.enum(["stock", "sukuk", "brand"]),
  symbol: z.string().min(1).max(32),
  name_ar: z.string().min(1).max(160),
  name_en: z.string().min(1).max(160),
  sector: z.string().max(80).optional(),
  prospectus_url: z.string().url().max(500).optional(),
});

export const submitProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SubmitInput.parse(input))
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
    if (error) throw new Error(error.message);
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
    const { data: rows } = await supabase
      .from("product_submissions")
      .select("*, companies:companies!inner(name_ar, name_en, slug)")
      .order("submitted_at", { ascending: false })
      .limit(200);
    return rows ?? [];
  });

const ReviewInput = z.object({
  submissionId: z.string().uuid(),
  status: z.enum(["approved", "rejected"]),
  reason: z.string().max(600).optional(),
});
export const reviewSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isReviewer } = await supabase.rpc("has_role", { _user_id: userId, _role: "shariah_board" });
    if (!isReviewer) throw new Error("FORBIDDEN");

    const { error } = await supabase.from("product_submissions").update({
      status: data.status,
      reviewer_id: userId,
      review_reason: data.reason ?? null,
      reviewed_at: new Date().toISOString(),
    }).eq("id", data.submissionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });