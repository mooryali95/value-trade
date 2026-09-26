import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toStableError } from "@/lib/ops/errors.server";
import { isValidOrderQty, isValidReferencePrice } from "@/lib/trading/calc";

/**
 * Submission to listing lifecycle (enforced in SQL, see
 * supabase/migrations/20260926101000_submission_lifecycle.sql):
 *
 *   pending  -> approved | rejected   Shariah reviewer (review_submission)
 *   approved -> listed               platform admin   (approve_listing)
 *   approved -> rejected             platform admin   (decline_listing)
 *
 * Every transition is one SECURITY DEFINER function call in one transaction;
 * direct updates of a submission's decision are refused by the database.
 * The server checks the caller's role first and passes the verified user id;
 * the function checks it again.
 */

export type SubmissionStatus = "pending" | "approved" | "rejected" | "listed";

/** Stable codes the lifecycle functions raise that are safe to show. */
export const LIFECYCLE_ERROR_CODES = new Set([
  "FORBIDDEN",
  "FORBIDDEN_ADMIN_REQUIRED",
  "INVALID_INPUT",
  "INVALID_SYMBOL",
  "INVALID_PRICE",
  "INVALID_QTY",
  "USER_NOT_FOUND",
  "SYMBOL_TAKEN",
  "SUBMISSION_NOT_FOUND",
  "SUBMISSION_NOT_PENDING",
  "SUBMISSION_NOT_APPROVED",
  "SUBMISSION_TRANSITION_FORBIDDEN",
  "REJECTION_REASON_REQUIRED",
  "RULING_CHANGE_REASON_REQUIRED",
  "SHARIAH_RULING_CONFLICT",
  "SHARIAH_RULING_REQUIRED",
  "SHARIAH_NOT_HALAL",
  "INSTRUMENT_NOT_FOUND",
  "BRAND_CAP_REACHED",
]);

/** A database error -> a stable code (known lifecycle codes pass through). */
export function lifecycleError(tag: string, error: { message?: string | null; code?: string | null }): Error {
  const code = (error.message ?? "").trim();
  if (LIFECYCLE_ERROR_CODES.has(code)) return new Error(code);
  // Unique violation on symbol / slug: another company's instrument.
  if (error.code === "23505") return new Error("SYMBOL_TAKEN");
  return toStableError(tag, error);
}

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
        symbol: data.symbol.toUpperCase(),
        name_ar: data.name_ar,
        name_en: data.name_en,
        sector: data.sector ?? null,
        prospectus_url: data.prospectus_url ?? null,
      })
      .select("id, status, symbol")
      .single();
    if (error) throw toStableError("submissions.submit", error, "FORBIDDEN");
    return row;
  });

export type CompanySubmission = {
  id: string;
  symbol: string;
  name_ar: string;
  name_en: string;
  asset_class: string;
  sector: string | null;
  status: SubmissionStatus;
  review_reason: string | null;
  listing_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  listing_decided_at: string | null;
};

/** The company's own submissions (RLS: members of the company). */
export const listCompanySubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CompanySubmission[]> => {
    const { data: rows, error } = await context.supabase
      .from("product_submissions")
      .select("*")
      .eq("company_id", data.companyId)
      .order("submitted_at", { ascending: false });
    if (error) throw toStableError("submissions.listCompany", error);
    return ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      symbol: String(r.symbol),
      name_ar: String(r.name_ar),
      name_en: String(r.name_en),
      asset_class: String(r.asset_class),
      sector: (r.sector as string | null) ?? null,
      status: r.status as SubmissionStatus,
      review_reason: (r.review_reason as string | null) ?? null,
      listing_reason: (r.listing_reason as string | null) ?? null,
      submitted_at: String(r.submitted_at),
      reviewed_at: (r.reviewed_at as string | null) ?? null,
      listing_decided_at: (r.listing_decided_at as string | null) ?? null,
    }));
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callerRoles(context: { supabase: any; userId: string }) {
  const [board, admin] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "shariah_board" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "platform_admin" }),
  ]);
  if (board.error || admin.error) {
    console.error("[submissions] has_role failed", board.error?.code ?? admin.error?.code ?? "unknown");
    throw new Error("INTERNAL_ERROR");
  }
  return { isReviewer: board.data === true, isAdmin: admin.data === true };
}

export type QueueSubmission = {
  id: string;
  company_id: string;
  symbol: string;
  name_ar: string;
  name_en: string;
  asset_class: string;
  sector: string | null;
  prospectus_url: string | null;
  status: SubmissionStatus;
  review_reason: string | null;
  listing_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  listing_decided_at: string | null;
  companies: { name_ar: string; name_en: string; slug: string } | null;
  /** The instrument created at Shariah approval (approved / listed / rejected at listing). */
  instrument: { symbol: string; referencePrice: number; published: boolean } | null;
  /** The Shariah ruling in force for the symbol, whatever its origin. */
  shariahStatus: "halal" | "non_halal" | "reviewing" | null;
};

/**
 * The review and listing queue: Shariah reviewers (who rule on pending
 * submissions) and platform admins (who list approved ones). Neither is a
 * member of the submitting companies, so everything is read with the service
 * role after the role check, for the newest 300 submissions only.
 */
export const listPendingSubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<QueueSubmission[]> => {
    const { isReviewer, isAdmin } = await callerRoles(context);
    if (!isReviewer && !isAdmin) throw new Error("FORBIDDEN");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("product_submissions")
      .select("*")
      .order("submitted_at", { ascending: false })
      .limit(300);
    if (error) throw toStableError("submissions.listQueue", error);
    const submissions = (rows ?? []) as Record<string, unknown>[];
    const companyIds = Array.from(new Set(submissions.map((r) => String(r.company_id))));
    const symbols = Array.from(new Set(submissions.map((r) => String(r.symbol).trim().toUpperCase())));
    const ids = submissions.map((r) => String(r.id));

    const names = new Map<string, { name_ar: string; name_en: string; slug: string }>();
    const instruments = new Map<string, { symbol: string; referencePrice: number; published: boolean }>();
    const rulings = new Map<string, "halal" | "non_halal" | "reviewing">();
    if (submissions.length > 0) {
      const [companies, brands, decisions] = await Promise.all([
        supabaseAdmin.from("companies").select("id, name_ar, name_en, slug").in("id", companyIds),
        supabaseAdmin
          .from("brands")
          .select("symbol, reference_price, published, source_submission_id")
          .in("source_submission_id", ids),
        supabaseAdmin
          .from("shariah_decisions")
          .select("symbol, status, effective_at, created_at, id")
          .in("symbol", symbols)
          .order("effective_at", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
      ]);
      if (companies.error) throw toStableError("submissions.listQueue.companies", companies.error);
      if (brands.error) throw toStableError("submissions.listQueue.brands", brands.error);
      if (decisions.error) throw toStableError("submissions.listQueue.rulings", decisions.error);
      for (const c of companies.data ?? []) names.set(c.id, { name_ar: c.name_ar, name_en: c.name_en, slug: c.slug });
      for (const b of brands.data ?? []) {
        if (b.source_submission_id) {
          instruments.set(b.source_submission_id, {
            symbol: b.symbol,
            referencePrice: Number(b.reference_price),
            published: b.published,
          });
        }
      }
      // Newest first: the first row per symbol is the ruling in force.
      for (const d of decisions.data ?? []) {
        if (!rulings.has(d.symbol)) rulings.set(d.symbol, d.status as "halal" | "non_halal" | "reviewing");
      }
    }
    return submissions.map((r) => ({
      id: String(r.id),
      company_id: String(r.company_id),
      symbol: String(r.symbol),
      name_ar: String(r.name_ar),
      name_en: String(r.name_en),
      asset_class: String(r.asset_class),
      sector: (r.sector as string | null) ?? null,
      prospectus_url: (r.prospectus_url as string | null) ?? null,
      status: r.status as SubmissionStatus,
      review_reason: (r.review_reason as string | null) ?? null,
      listing_reason: (r.listing_reason as string | null) ?? null,
      submitted_at: String(r.submitted_at),
      reviewed_at: (r.reviewed_at as string | null) ?? null,
      listing_decided_at: (r.listing_decided_at as string | null) ?? null,
      companies: names.get(String(r.company_id)) ?? null,
      instrument: instruments.get(String(r.id)) ?? null,
      shariahStatus: rulings.get(String(r.symbol).trim().toUpperCase()) ?? null,
    }));
  });

const ReviewInput = z
  .object({
    submissionId: z.string().uuid(),
    status: z.enum(["approved", "rejected"]),
    reason: z.string().max(600).optional(),
    /** Approve although a non-halal / under-review ruling is in force (needs a reason). */
    replaceRuling: z.boolean().optional(),
  })
  // A rejection must always carry a reason the applicant can act on.
  .refine((v) => v.status !== "rejected" || (v.reason ?? "").trim().length >= 10, {
    message: "REJECTION_REASON_REQUIRED",
    path: ["reason"],
  });

export function parseReviewInput(input: unknown): z.infer<typeof ReviewInput> {
  const parsed = ReviewInput.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "";
    throw new Error(msg === "REJECTION_REASON_REQUIRED" ? msg : "INVALID_INPUT");
  }
  return parsed.data;
}

/**
 * Shariah review of a pending submission, in ONE database transaction
 * (review_submission): approval creates or updates the company's instrument
 * off the market with no reference price, records the reviewer's 'halal'
 * ruling unless one is already in force, and flips the status. A ruling
 * already in force that is not 'halal' is never overridden silently
 * (SHARIAH_RULING_CONFLICT) unless the reviewer confirms the replacement
 * with a written reason. A rejection needs a reason of 10+ characters.
 */
export const reviewSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseReviewInput(input))
  .handler(async ({ data, context }) => {
    const { isReviewer } = await callerRoles(context);
    if (!isReviewer) throw new Error("FORBIDDEN");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const reason = data.reason?.trim() ? data.reason.trim() : null;
    const { data: rows, error } = await supabaseAdmin.rpc("review_submission" as never, {
      _submission_id: data.submissionId,
      _reviewer_id: context.userId,
      _decision: data.status,
      _reason: reason,
      _replace_ruling: data.replaceRuling === true,
    } as never);
    if (error) throw lifecycleError("submissions.review", error);
    const row = (Array.isArray(rows) ? rows[0] : rows) as
      | { status: string; symbol: string; ruling_recorded: boolean; ruling_id: string | null; previous_ruling: string | null }
      | undefined;
    if (!row) throw new Error("INTERNAL_ERROR");
    // A replaced ruling can affect holders and watchers of a relisted symbol.
    if (row.ruling_recorded && row.ruling_id && row.previous_ruling) {
      try {
        const { notifyShariahDecision } = await import("@/lib/trading/shariah-notify.server");
        await notifyShariahDecision({ decisionId: row.ruling_id, symbol: row.symbol, status: "halal", reason });
      } catch (err) {
        console.error("[submissions] notify failed", err);
      }
    }
    return { ok: true as const, status: row.status as SubmissionStatus, symbol: row.symbol, rulingRecorded: row.ruling_recorded };
  });

export type ListingInput = {
  submissionId: string;
  referencePrice: number;
  holderId?: string;
  qty?: number;
  issuePrice?: number;
  note?: string;
};

export function parseListingInput(input: unknown): ListingInput {
  const v = (input ?? {}) as Record<string, unknown>;
  if (!z.string().uuid().safeParse(v.submissionId).success) throw new Error("SUBMISSION_NOT_FOUND");
  if (!isValidReferencePrice(v.referencePrice)) throw new Error("INVALID_PRICE");
  const out: ListingInput = { submissionId: v.submissionId as string, referencePrice: v.referencePrice };
  const hasHolder = v.holderId !== undefined && v.holderId !== null && v.holderId !== "";
  if (hasHolder) {
    if (!z.string().uuid().safeParse(v.holderId).success) throw new Error("USER_NOT_FOUND");
    if (!isValidOrderQty(v.qty)) throw new Error("INVALID_QTY");
    out.holderId = v.holderId as string;
    out.qty = v.qty;
    if (v.issuePrice !== undefined && v.issuePrice !== null) {
      if (!isValidReferencePrice(v.issuePrice)) throw new Error("INVALID_PRICE");
      out.issuePrice = v.issuePrice;
    }
  } else if (v.qty !== undefined && v.qty !== null) {
    throw new Error("INVALID_INPUT");
  }
  if (v.note !== undefined && v.note !== null) {
    if (typeof v.note !== "string" || v.note.length > 280) throw new Error("INVALID_INPUT");
    if (v.note.trim()) out.note = v.note.trim();
  }
  return out;
}

/**
 * Platform admin approves the listing of a Shariah-approved submission, in
 * ONE database transaction (approve_listing): sets the reference price,
 * lists the instrument (needs the 'halal' ruling in force), optionally
 * allocates the first units to a holder at the issue price (default: the
 * reference price), and marks the submission 'listed'. Audited in SQL.
 */
export const approveListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseListingInput(input))
  .handler(async ({ data, context }) => {
    const { isAdmin } = await callerRoles(context);
    if (!isAdmin) throw new Error("FORBIDDEN_ADMIN_REQUIRED");
    const { checkRateLimit } = await import("@/lib/security/rate-limit.server");
    if (!(await checkRateLimit(`approve-listing:actor:${context.userId}`, 60, 3600))) throw new Error("RATE_LIMITED");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("approve_listing" as never, {
      _submission_id: data.submissionId,
      _actor_id: context.userId,
      _reference_price: data.referencePrice,
      _holder_id: data.holderId ?? null,
      _qty: data.qty ?? null,
      _issue_price: data.issuePrice ?? null,
      _note: data.note ?? null,
    } as never);
    if (error) throw lifecycleError("submissions.approveListing", error);
    const row = (Array.isArray(rows) ? rows[0] : rows) as
      | { symbol: string; reference_price: number; issuance_id: string | null }
      | undefined;
    if (!row) throw new Error("INTERNAL_ERROR");
    return {
      ok: true as const,
      symbol: row.symbol,
      referencePrice: Number(row.reference_price),
      issuanceId: row.issuance_id ?? null,
    };
  });

const DeclineInput = z.object({
  submissionId: z.string().uuid(),
  reason: z.string().trim().min(10, "REJECTION_REASON_REQUIRED").max(600),
});

/** Platform admin declines the listing of a Shariah-approved submission (reason required). */
export const declineListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const parsed = DeclineInput.safeParse(input);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message === "REJECTION_REASON_REQUIRED" ? "REJECTION_REASON_REQUIRED" : "INVALID_INPUT");
    }
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    const { isAdmin } = await callerRoles(context);
    if (!isAdmin) throw new Error("FORBIDDEN_ADMIN_REQUIRED");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("decline_listing" as never, {
      _submission_id: data.submissionId,
      _actor_id: context.userId,
      _reason: data.reason,
    } as never);
    if (error) throw lifecycleError("submissions.declineListing", error);
    return { ok: true as const };
  });

export type ListingHolder = { userId: string; email: string; role: string; isTrader: boolean };

/**
 * Candidate holders of the first allocation: the submitting company's
 * owners and finance members (platform admins only).
 */
export const listListingHolders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ submissionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ListingHolder[]> => {
    const { isAdmin } = await callerRoles(context);
    if (!isAdmin) throw new Error("FORBIDDEN_ADMIN_REQUIRED");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sub, error: subErr } = await supabaseAdmin
      .from("product_submissions")
      .select("company_id")
      .eq("id", data.submissionId)
      .maybeSingle();
    if (subErr) throw toStableError("submissions.holders.sub", subErr);
    if (!sub) throw new Error("SUBMISSION_NOT_FOUND");
    const { data: members, error } = await supabaseAdmin
      .from("company_members")
      .select("user_id, role")
      .eq("company_id", sub.company_id)
      .in("role", ["owner", "finance"])
      .limit(50);
    if (error) throw toStableError("submissions.holders.members", error);
    const userIds = (members ?? []).map((m) => m.user_id);
    if (userIds.length === 0) return [];
    const { data: traders, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "trader")
      .in("user_id", userIds);
    if (rolesErr) throw toStableError("submissions.holders.roles", rolesErr);
    const traderSet = new Set((traders ?? []).map((r) => r.user_id));
    const out: ListingHolder[] = [];
    for (const m of members ?? []) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
      out.push({ userId: m.user_id, email: u?.user?.email ?? "", role: m.role, isTrader: traderSet.has(m.user_id) });
    }
    return out;
  });
