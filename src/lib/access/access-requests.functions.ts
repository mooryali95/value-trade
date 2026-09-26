import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/audit/audit.server";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit.server";
import { toStableError } from "@/lib/ops/errors.server";
import { normalizeReference, UUID_RE } from "./reference";
import { parseOr } from "@/lib/security/parse-input";

// NOTE ON THE `as Untyped` CASTS BELOW: the onboarding functions and the
// access_requests.reference_code column come from migrations that the
// generated Database types (src/integrations/supabase/types.ts) only learn
// about once Lovable applies them and regenerates that file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- until the generated types include them (see above)
type Untyped = any;

// ---------------------------------------------------------------------------
// Public: search / lookup companies (name+slug+id only). Only companies that
// have an owner are listed (search_companies_public), at most 8 per query,
// and each IP is rate limited: this is an unauthenticated typeahead.
// ---------------------------------------------------------------------------

export const searchCompaniesPublic = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ query: z.string().trim().min(2).max(80) }).parse(input))
  .handler(async ({ data }) => {
    if (!(await checkRateLimit(clientKeyFromRequest(getRequest(), "company-search-ip"), 120, 600))) {
      throw new Error("RATE_LIMITED");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("search_companies_public" as Untyped, {
      _query: data.query,
    });
    if (error) throw toStableError("access.search", error);
    return ((rows ?? []) as { id: string; slug: string; name_ar: string; name_en: string }[]).slice(0, 8);
  });

export const getCompanyBySlugPublic = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ slug: z.string().trim().toLowerCase().min(1).max(48).regex(/^[a-z0-9-]+$/) }).parse(input),
  )
  .handler(async ({ data }) => {
    if (!(await checkRateLimit(clientKeyFromRequest(getRequest(), "company-slug-ip"), 60, 600))) {
      throw new Error("RATE_LIMITED");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.rpc("get_company_by_slug_public" as Untyped, {
      _slug: data.slug,
    });
    if (error) throw toStableError("access.slug", error);
    const rows = (row ?? []) as { id: string; slug: string; name_ar: string; name_en: string }[];
    return rows[0] ?? null;
  });

// ---------------------------------------------------------------------------
// Public: submit an access request. No Supabase Auth account is created
// here. Rate limited by IP and by address (fails closed). The server
// function (service role, after validation and rate limiting) is the only
// write path. The applicant receives an acknowledgement e-mail with a short
// reference code (VU-XXXX-XXXX) to check the request status.
// ---------------------------------------------------------------------------

const Email = z.string().trim().toLowerCase().email().max(320);
const Name = z.string().trim().min(1).max(160);
const CompanyName = z.string().trim().min(1).max(120);

const SubmitInput = z.discriminatedUnion("join_method", [
  z.object({
    join_method: z.enum(["search", "link"]),
    email: Email,
    full_name: Name,
    requested_company_id: z.string().uuid(),
  }),
  z.object({
    join_method: z.literal("new_company"),
    email: Email,
    full_name: Name,
    new_company_name_ar: CompanyName,
    new_company_name_en: CompanyName,
  }),
  z.object({
    join_method: z.literal("investor"),
    email: Email,
    full_name: Name,
  }),
]);

export type JoinMethod = "search" | "link" | "new_company" | "investor";

/** Rate-limit key for an email without storing the address itself. */
async function emailKey(scope: string, email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${scope}:${hex.slice(0, 32)}`;
}

function requestKind(joinMethod: string): "investor" | "join" | "new_company" {
  return joinMethod === "investor" ? "investor" : joinMethod === "new_company" ? "new_company" : "join";
}

async function companyNames(companyId: string | null): Promise<{ ar: string | null; en: string | null }> {
  if (!companyId) return { ar: null, en: null };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("companies").select("name_ar, name_en").eq("id", companyId).maybeSingle();
  return { ar: data?.name_ar ?? null, en: data?.name_en ?? null };
}

/** Best-effort transactional e-mail; never throws, never returns provider text. */
async function sendMail(
  templateName: string,
  to: string,
  templateData: Record<string, unknown>,
  idempotencyKey: string,
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const { enqueueTransactionalEmail } = await import("@/lib/email/enqueue.server");
    const res = await enqueueTransactionalEmail({ templateName, recipientEmail: to, templateData, idempotencyKey, label: templateName });
    if (res.sent) return { sent: true };
    if (res.reason !== "suppressed" && res.detail) console.error(`[access] ${templateName} enqueue failed`, res.reason);
    return { sent: false, reason: res.reason === "suppressed" ? "SUPPRESSED" : "PROVIDER_ERROR" };
  } catch (err) {
    console.error(`[access] ${templateName} threw`, err instanceof Error ? err.name : "unknown");
    return { sent: false, reason: "PROVIDER_ERROR" };
  }
}

export const submitAccessRequest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => parseOr(SubmitInput, input))
  .handler(async ({ data }): Promise<{ id: string; referenceCode: string; emailSent: boolean }> => {
    const request = getRequest();
    const ipKey = clientKeyFromRequest(request, "access-request-ip");
    const perEmailKey = await emailKey("access-request-email", data.email);

    // checkRateLimit fails CLOSED: this is the only unauthenticated write path.
    const [ipOk, emailOk] = await Promise.all([
      checkRateLimit(ipKey, 5, 3600),
      checkRateLimit(perEmailKey, 3, 86400),
    ]);
    if (!ipOk || !emailOk) throw new Error("RATE_LIMITED");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const base = { email: data.email, full_name: data.full_name, join_method: data.join_method };
    const insert =
      data.join_method === "new_company"
        ? { ...base, new_company_name_ar: data.new_company_name_ar, new_company_name_en: data.new_company_name_en }
        : data.join_method === "investor"
          ? base
          : { ...base, requested_company_id: data.requested_company_id };

    // The reference code is random (40 bits); retry once on the rare clash.
    let row: { id: string; reference_code: string } | null = null;
    for (let attempt = 0; attempt < 2 && !row; attempt++) {
      const res = await (supabaseAdmin.from("access_requests" as Untyped) as Untyped)
        .insert(insert)
        .select("id, reference_code")
        .single();
      if (!res.error && res.data) {
        row = res.data as { id: string; reference_code: string };
        break;
      }
      if (res.error?.code !== "23505" || attempt === 1) throw toStableError("access.submit", res.error);
    }
    if (!row) throw new Error("INTERNAL_ERROR");

    const { canonicalOrigin } = await import("@/lib/ops/origin.server");
    // Anyone can type any address into this form, so the acknowledgement
    // quotes nothing the applicant wrote (name, new company names): only
    // the reference code and, for a join request, the registered company's
    // own name.
    const names =
      data.join_method === "search" || data.join_method === "link"
        ? await companyNames(data.requested_company_id)
        : { ar: null, en: null };
    const ack = await sendMail(
      "access-request-received",
      data.email,
      {
        fullName: null,
        referenceCode: row.reference_code,
        kind: requestKind(data.join_method),
        companyNameAr: names.ar,
        companyNameEn: names.en,
        statusUrl: `${canonicalOrigin()}/request-access?ref=${encodeURIComponent(row.reference_code)}`,
      },
      `access-request-received:${row.id}`,
    );

    return { id: row.id, referenceCode: row.reference_code, emailSent: ack.sent };
  });

// ---------------------------------------------------------------------------
// Authenticated: the approval queue. RLS on access_requests scopes rows to
// (a) owners of the target company or (b) platform_admin (who alone sees new
// company and investor requests).
// ---------------------------------------------------------------------------

export type AccessRequestRow = {
  id: string;
  email: string;
  full_name: string;
  join_method: JoinMethod;
  requested_company_id: string | null;
  new_company_name_ar: string | null;
  new_company_name_en: string | null;
  status: string;
  created_at: string;
  reference_code: string | null;
  companies: { id: string; name_ar: string; name_en: string; slug: string } | null;
};

export const listAccessRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccessRequestRow[]> => {
    const { data: rows, error } = await (context.supabase.from("access_requests" as Untyped) as Untyped)
      .select("*, companies:companies(id, name_ar, name_en, slug)")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw toStableError("access.list", error);
    return (rows ?? []) as AccessRequestRow[];
  });

const ApproveInput = z.object({
  requestId: z.string().uuid(),
  role: z.enum(["finance", "shariah", "trader", "viewer"]).optional(), // required for search/link
  sector: z.string().trim().max(80).optional(), // required for new_company
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9-]+$/)
    .optional(), // required for new_company
  // Ignored (kept optional for older clients): links use the server origin.
  origin: z.string().max(2048).optional(),
});

export type ApprovalResult = {
  ok: true;
  kind: "investor" | "join" | "new_company";
  companyId: string | null;
  /** Public invitation page (company requests); the owner or admin may copy it. */
  inviteUrl: string | null;
  /** Whether the applicant was e-mailed (invitation, platform invitation or notice). */
  notification: { sent: boolean; reason?: string };
  /** Investor already had an account: they were told to sign in instead. */
  accountExists?: boolean;
};

type RequestRecord = {
  id: string;
  email: string;
  full_name: string;
  join_method: string;
  requested_company_id: string | null;
  new_company_name_ar: string | null;
  new_company_name_en: string | null;
  status: string;
  reference_code: string | null;
  resulting_invitation_id: string | null;
  reviewed_at: string | null;
  created_at: string;
};

async function loadRequest(requestId: string): Promise<RequestRecord> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin.from("access_requests" as Untyped) as Untyped)
    .select(
      "id, email, full_name, join_method, requested_company_id, new_company_name_ar, new_company_name_en, status, reference_code, resulting_invitation_id, reviewed_at, created_at",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw toStableError("access.load", error);
  if (!data) throw new Error("REQUEST_NOT_FOUND");
  return data as RequestRecord;
}

/**
 * Investor platform invitation: a Supabase Auth invitation (set-password
 * link to the canonical origin). When the address already has an account,
 * the applicant is told by e-mail to sign in instead.
 */
async function sendInvestorWelcome(req: RequestRecord): Promise<{ sent: boolean; reason?: string; accountExists: boolean }> {
  const { sendAccountLink } = await import("@/lib/account/platform-invite.server");
  const link = await sendAccountLink(req.email, {
    next: "/",
    fallbackToRecovery: false,
    data: { full_name: req.full_name },
  });
  if (link.sent) return { sent: true, accountExists: false };
  if (link.reason !== "ALREADY_REGISTERED") return { sent: false, reason: link.reason, accountExists: false };
  const { canonicalOrigin } = await import("@/lib/ops/origin.server");
  const notice = await sendMail(
    "access-request-decision",
    req.email,
    {
      decision: "approved",
      kind: "investor",
      fullName: req.full_name,
      referenceCode: req.reference_code,
      signInUrl: `${canonicalOrigin()}/auth`,
    },
    `access-request-decision:${req.id}:approved:${Math.floor(Date.now() / 60_000)}`,
  );
  return { ...notice, accountExists: true };
}

export const approveAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ApproveInput.parse(input))
  .handler(async ({ data, context }): Promise<ApprovalResult> => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rpcRows, error } = await supabaseAdmin.rpc("approve_access_request" as Untyped, {
      _request_id: data.requestId,
      _actor_id: userId,
      _role: data.role ?? null,
      _sector: data.sector ?? null,
      _slug: data.slug ?? null,
    });
    if (error) throw toStableError("access.approve", error);
    const result = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) as {
      invitation_id: string | null;
      invitation_token: string | null;
      company_id: string | null;
    } | null;
    const req = await loadRequest(data.requestId);
    const kind = requestKind(req.join_method);

    let notification: { sent: boolean; reason?: string } = { sent: false, reason: "PROVIDER_ERROR" };
    let inviteUrl: string | null = null;
    let accountExists: boolean | undefined;
    if (kind === "investor") {
      const welcome = await sendInvestorWelcome(req);
      notification = { sent: welcome.sent, reason: welcome.reason };
      accountExists = welcome.accountExists;
    } else if (result?.invitation_id) {
      const { data: invite } = await supabaseAdmin
        .from("company_invitations")
        .select("id, company_id, email, role, token, status, expires_at")
        .eq("id", result.invitation_id)
        .maybeSingle();
      if (invite) {
        const { notifyInvitation, invitationUrl } = await import("@/lib/tenants/invitations.server");
        notification = await notifyInvitation(invite);
        inviteUrl = invitationUrl(invite.token);
      }
    }

    await writeAudit(supabase, {
      actorId: userId,
      companyId: result?.company_id ?? null,
      action: "access_request.approve",
      entity: "access_requests",
      entityId: data.requestId,
      metadata: { kind, invitationId: result?.invitation_id ?? null, emailSent: notification.sent },
    });

    return {
      ok: true,
      kind,
      companyId: result?.company_id ?? null,
      inviteUrl,
      notification,
      ...(accountExists !== undefined ? { accountExists } : {}),
    };
  });

const RejectInput = z.object({
  requestId: z.string().uuid(),
  /** Shared with the applicant in the decision e-mail. */
  reason: z.string().trim().max(600).optional(),
});

export const rejectAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RejectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const reason = data.reason ? data.reason : null;
    const { error } = await supabaseAdmin.rpc("reject_access_request" as Untyped, {
      _request_id: data.requestId,
      _actor_id: userId,
      _reason: reason,
    });
    if (error) throw toStableError("access.reject", error);

    const req = await loadRequest(data.requestId);
    const names = await companyNames(req.requested_company_id);
    const { canonicalOrigin } = await import("@/lib/ops/origin.server");
    const notification = await sendMail(
      "access-request-decision",
      req.email,
      {
        decision: "rejected",
        kind: requestKind(req.join_method),
        fullName: req.full_name,
        referenceCode: req.reference_code,
        companyNameAr: names.ar ?? req.new_company_name_ar,
        companyNameEn: names.en ?? req.new_company_name_en,
        note: reason,
        requestUrl: `${canonicalOrigin()}/request-access`,
      },
      `access-request-decision:${req.id}:rejected`,
    );

    await writeAudit(supabase, {
      actorId: userId,
      companyId: req.requested_company_id,
      action: "access_request.reject",
      entity: "access_requests",
      entityId: data.requestId,
      metadata: { reason, emailSent: notification.sent },
    });

    return { ok: true as const, notification };
  });

// ---------------------------------------------------------------------------
// Recently approved requests and what became of them (H2): the resulting
// company invitation (copy link, resend, re-issue) or, for investors, whether
// the account exists and is active. Visibility follows RLS (owners: their
// company's requests; platform admins: everything).
// ---------------------------------------------------------------------------

export type RecentDecision = {
  id: string;
  email: string;
  fullName: string;
  joinMethod: JoinMethod;
  referenceCode: string | null;
  reviewedAt: string | null;
  companyId: string | null;
  companyNameAr: string | null;
  companyNameEn: string | null;
  invitation: {
    id: string;
    role: string;
    status: "pending" | "expired" | "accepted" | "revoked";
    expiresAt: string;
    inviteUrl: string | null;
  } | null;
  /** Investors (platform admins only): where the account stands. */
  investorState: "no_account" | "awaiting_activation" | "active" | null;
};

export const listRecentAccessDecisions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RecentDecision[]> => {
    const since = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    const { data: rows, error } = await (context.supabase.from("access_requests" as Untyped) as Untyped)
      .select("id, email, full_name, join_method, reference_code, reviewed_at, requested_company_id, new_company_name_ar, new_company_name_en, resulting_invitation_id")
      .eq("status", "approved")
      // New companies stay listed past 60 days until their owner accepts:
      // until then the company has no member and only this list reaches
      // its owner invitation.
      .or(`reviewed_at.gte.${since},join_method.eq.new_company`)
      .order("reviewed_at", { ascending: false })
      .limit(200);
    if (error) throw toStableError("access.recent", error);
    const list = (rows ?? []) as Array<{
      id: string;
      email: string;
      full_name: string;
      join_method: JoinMethod;
      reference_code: string | null;
      reviewed_at: string | null;
      requested_company_id: string | null;
      new_company_name_ar: string | null;
      new_company_name_en: string | null;
      resulting_invitation_id: string | null;
    }>;
    if (list.length === 0) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { effectiveInvitationStatus, invitationUrl, isPlatformAdmin, adminRpc } = await import(
      "@/lib/tenants/invitations.server"
    );
    const invIds = list.map((r) => r.resulting_invitation_id).filter((v): v is string => !!v);
    const invites = new Map<string, { id: string; company_id: string; role: string; token: string; status: string; expires_at: string }>();
    if (invIds.length > 0) {
      const { data: invRows, error: invErr } = await supabaseAdmin
        .from("company_invitations")
        .select("id, company_id, role, token, status, expires_at")
        .in("id", invIds);
      if (invErr) throw toStableError("access.recent.invites", invErr);
      for (const i of invRows ?? []) invites.set(i.id, i);
    }
    const companyIds = Array.from(
      new Set(
        list
          .map((r) => r.requested_company_id ?? (r.resulting_invitation_id ? invites.get(r.resulting_invitation_id)?.company_id : null))
          .filter((v): v is string => !!v),
      ),
    );
    const names = new Map<string, { name_ar: string; name_en: string }>();
    if (companyIds.length > 0) {
      const { data: cos } = await supabaseAdmin.from("companies").select("id, name_ar, name_en").in("id", companyIds);
      for (const c of cos ?? []) names.set(c.id, { name_ar: c.name_ar, name_en: c.name_en });
    }

    // Investor rows: only platform admins see them (RLS), and only they get
    // the account state, from the pending-activation queue.
    // An invited account whose address is still unconfirmed has not used
    // its invitation link yet: it counts as "no account" for the resend.
    const queue = new Map<string, string>();
    if (list.some((r) => r.join_method === "investor") && (await isPlatformAdmin(context.userId))) {
      const { data: q, error: qErr } = await adminRpc<Array<{ email: string; source: string; email_confirmed: boolean | null }>>(
        "admin_pending_activations",
        { _actor_id: context.userId, _limit: 500 },
      );
      if (qErr) throw toStableError("access.recent.queue", qErr);
      for (const e of q ?? []) {
        if (queue.has(e.email)) continue;
        queue.set(e.email, e.source === "investor_request" && e.email_confirmed !== true ? "invited_no_account" : e.source);
      }
    }

    const sinceMs = Date.parse(since);
    const recentOrOpen = (r: (typeof list)[number]) => {
      if (r.reviewed_at && Date.parse(r.reviewed_at) >= sinceMs) return true;
      const inv = r.resulting_invitation_id ? invites.get(r.resulting_invitation_id) : undefined;
      return !!inv && inv.status !== "accepted";
    };
    // An approval also closes the applicant's pending duplicates (same
    // address, same request; access_requests_close_siblings; a rejection
    // closes one request only): list the decision once. Rows are newest
    // first, so the first one is kept.
    const seen = new Set<string>();
    const once = (r: (typeof list)[number]) => {
      const target =
        r.join_method === "investor"
          ? "investor"
          : r.join_method === "new_company"
            ? `new:${(r.new_company_name_en ?? "").trim().toLowerCase()}|${(r.new_company_name_ar ?? "").trim().toLowerCase()}`
            : `co:${r.requested_company_id ?? ""}`;
      const key = `${r.email.trim().toLowerCase()}|${target}|${r.reviewed_at ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    return list.filter(recentOrOpen).filter(once).slice(0, 100).map((r) => {
      const inv = r.resulting_invitation_id ? invites.get(r.resulting_invitation_id) : undefined;
      const companyId = r.requested_company_id ?? inv?.company_id ?? null;
      const co = companyId ? names.get(companyId) : undefined;
      const status = inv ? (effectiveInvitationStatus(inv.status, inv.expires_at) as NonNullable<RecentDecision["invitation"]>["status"]) : null;
      const source = queue.get(r.email.toLowerCase());
      return {
        id: r.id,
        email: r.email,
        fullName: r.full_name,
        joinMethod: r.join_method,
        referenceCode: r.reference_code,
        reviewedAt: r.reviewed_at,
        companyId,
        companyNameAr: co?.name_ar ?? r.new_company_name_ar,
        companyNameEn: co?.name_en ?? r.new_company_name_en,
        invitation:
          inv && status
            ? { id: inv.id, role: inv.role, status, expiresAt: inv.expires_at, inviteUrl: status === "pending" ? invitationUrl(inv.token) : null }
            : null,
        investorState:
          r.join_method !== "investor"
            ? null
            : source === "invited_no_account"
              ? "no_account"
              : source === "investor_request"
                ? "awaiting_activation"
                : "active",
      };
    });
  });

/** Platform admin: send the platform invitation of an approved investor again. */
export const resendInvestorInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { isPlatformAdmin } = await import("@/lib/tenants/invitations.server");
    if (!(await isPlatformAdmin(context.userId))) throw new Error("FORBIDDEN_ADMIN_REQUIRED");
    const req = await loadRequest(data.requestId);
    if (req.join_method !== "investor" || req.status !== "approved") throw new Error("REQUEST_NOT_FOUND");
    if (!(await checkRateLimit(`investor-invite-resend:${req.id}`, 3, 3600))) throw new Error("RATE_LIMITED");
    const welcome = await sendInvestorWelcome(req);
    await writeAudit(context.supabase, {
      actorId: context.userId,
      action: "access_request.investor_invite_resend",
      entity: "access_requests",
      entityId: req.id,
      metadata: { emailSent: welcome.sent, accountExists: welcome.accountExists },
    });
    return { notification: { sent: welcome.sent, reason: welcome.reason }, accountExists: welcome.accountExists };
  });

// ---------------------------------------------------------------------------
// Public: check the status of a previously submitted request with its
// reference (short code VU-XXXX-XXXX, or the older full request id) and the
// matching email. Rate limited by IP -- fails CLOSED.
// ---------------------------------------------------------------------------

const StatusCheckInput = z.object({
  reference: z.string().trim().min(1).max(64).optional(),
  /** Older clients sent the request id under this name. */
  requestId: z.string().trim().max(64).optional(),
  email: Email,
});

export const checkAccessRequestStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => StatusCheckInput.parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    const ok = await checkRateLimit(clientKeyFromRequest(request, "access-request-status-ip"), 10, 3600);
    if (!ok) throw new Error("RATE_LIMITED");

    const ref = normalizeReference(data.reference ?? data.requestId ?? "");
    if (!ref) return { found: false as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = UUID_RE.test(ref)
      ? await supabaseAdmin.rpc("check_access_request_status" as Untyped, { _id: ref, _email: data.email })
      : await supabaseAdmin.rpc("check_access_request_status_ref" as Untyped, { _ref: ref, _email: data.email });
    if (error) throw toStableError("access.status", error);
    const row = (Array.isArray(rows) ? rows[0] : rows) as
      | { status: string; reviewed_at: string | null; join_method?: string }
      | undefined;
    if (!row) return { found: false as const };
    return {
      found: true as const,
      status: row.status as string,
      reviewedAt: row.reviewed_at as string | null,
      joinMethod: (row.join_method ?? null) as string | null,
    };
  });
