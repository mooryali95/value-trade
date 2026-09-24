import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/audit/audit.server";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit.server";
import { toStableError } from "@/lib/ops/errors.server";

// NOTE ON `as any` CASTS BELOW:
// `access_requests`, `search_companies_public`, `get_company_by_slug_public`,
// `approve_access_request`, and `reject_access_request` all come from the new
// migration (20260802121145_access_requests.sql). The generated
// `Database` types (src/integrations/supabase/types.ts) only know about them
// once Lovable applies the migration to the linked Supabase project and
// regenerates that file -- which happens on sync, not before. These casts
// are the standard, narrow way to bridge that gap; remove them once
// types.ts picks up the new schema (tsc will flag the now-redundant casts).

// ---------------------------------------------------------------------------
// Public: search / lookup companies (name+slug+id only -- see
// search_companies_public / get_company_by_slug_public in the migration).
// No auth required; this is the typeahead for "join an existing company".
// ---------------------------------------------------------------------------

export const searchCompaniesPublic = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ query: z.string().min(2).max(80) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("search_companies_public" as any, {
      _query: data.query,
    });
    if (error) throw toStableError("access.search", error);
    return (rows ?? []) as { id: string; slug: string; name_ar: string; name_en: string }[];
  });

export const getCompanyBySlugPublic = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ slug: z.string().min(1).max(48) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.rpc("get_company_by_slug_public" as any, {
      _slug: data.slug,
    });
    if (error) throw toStableError("access.slug", error);
    const rows = (row ?? []) as { id: string; slug: string; name_ar: string; name_en: string }[];
    return rows[0] ?? null;
  });

// ---------------------------------------------------------------------------
// Public: submit an access request. No Supabase Auth account is created here
// -- see AGENTS-facing note in the migration for why. Rate limited by IP and
// by email; checkRateLimit fails closed, since this endpoint has no auth
// barrier at all. Direct anon/authenticated INSERT on access_requests is
// revoked: this server function (service role, after validation and rate
// limiting) is the only write path.
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
]);

/** Rate-limit key for an email without storing the address itself. */
async function emailKey(scope: string, email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${scope}:${hex.slice(0, 32)}`;
}

export const submitAccessRequest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SubmitInput.parse(input))
  .handler(async ({ data }) => {
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

    const insert =
      data.join_method === "new_company"
        ? {
            email: data.email.toLowerCase(),
            full_name: data.full_name,
            join_method: data.join_method,
            new_company_name_ar: data.new_company_name_ar,
            new_company_name_en: data.new_company_name_en,
          }
        : {
            email: data.email.toLowerCase(),
            full_name: data.full_name,
            join_method: data.join_method,
            requested_company_id: data.requested_company_id,
          };

    const { data: row, error } = await (supabaseAdmin.from("access_requests" as any) as any)
      .insert(insert)
      .select("id")
      .single();
    if (error || !row) throw toStableError("access.submit", error);

    return { id: row.id as string };
  });

// ---------------------------------------------------------------------------
// Authenticated: the approval queue. RLS on access_requests already scopes
// rows to (a) owners of the target company or (b) platform_admin -- this
// query relies on that scoping rather than re-deriving it here, so a company
// owner querying this literally cannot receive another tenant's rows.
// ---------------------------------------------------------------------------

export type AccessRequestRow = {
  id: string;
  email: string;
  full_name: string;
  join_method: "search" | "link" | "new_company";
  requested_company_id: string | null;
  new_company_name_ar: string | null;
  new_company_name_en: string | null;
  status: string;
  created_at: string;
  companies: { id: string; name_ar: string; name_en: string; slug: string } | null;
};

export const listAccessRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccessRequestRow[]> => {
    const { data: rows, error } = await (context.supabase.from("access_requests" as any) as any)
      .select("*, companies:companies(id, name_ar, name_en, slug)")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw toStableError("access.list", error);
    return (rows ?? []) as AccessRequestRow[];
  });

const ApproveInput = z.object({
  requestId: z.string().uuid(),
  role: z.enum(["finance", "shariah", "trader", "viewer"]).optional(), // required for search/link
  sector: z.string().max(80).optional(), // required for new_company
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9-]+$/)
    .optional(), // required for new_company
  // Ignored (kept optional for older clients): links use the server origin.
  origin: z.string().max(2048).optional(),
});

export const approveAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ApproveInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rpcRows, error } = await supabaseAdmin.rpc("approve_access_request" as any, {
      _request_id: data.requestId,
      _actor_id: userId,
      _role: data.role ?? null,
      _sector: data.sector ?? null,
      _slug: data.slug ?? null,
    });
    if (error) throw toStableError("access.approve", error);
    const result = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) as {
      invitation_id: string;
      invitation_token: string;
      company_id: string;
    };

    // Reuse the existing, already-tested invitation email path.
    const { data: invite } = await supabase
      .from("company_invitations")
      .select("*")
      .eq("id", result.invitation_id)
      .single();
    if (invite) {
      const { sendInvitationEmailBestEffort } =
        await import("@/lib/tenants/invitation-email.server");
      const { data: company } = await supabase
        .from("companies")
        .select("name_en, name_ar")
        .eq("id", result.company_id)
        .single();
      const co = (company ?? {}) as { name_en?: string; name_ar?: string };
      const { canonicalOrigin } = await import("@/lib/ops/origin.server");
      await sendInvitationEmailBestEffort({
        email: invite.email,
        companyName: co.name_en || co.name_ar || "Value Unit",
        acceptUrl: `${canonicalOrigin()}/invitations?token=${encodeURIComponent(invite.token)}`,
        invitationId: invite.id,
        role: invite.role,
      });
    }

    await writeAudit(supabase, {
      actorId: userId,
      companyId: result.company_id,
      action: "access_request.approve",
      entity: "access_requests",
      entityId: data.requestId,
      metadata: { invitationId: result.invitation_id },
    });

    return { ok: true, companyId: result.company_id as string };
  });

const RejectInput = z.object({
  requestId: z.string().uuid(),
  reason: z.string().max(600).optional(),
});

export const rejectAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RejectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("reject_access_request" as any, {
      _request_id: data.requestId,
      _actor_id: userId,
      _reason: data.reason ?? null,
    });
    if (error) throw toStableError("access.reject", error);

    await writeAudit(supabase, {
      actorId: userId,
      companyId: null,
      action: "access_request.reject",
      entity: "access_requests",
      entityId: data.requestId,
      metadata: { reason: data.reason ?? null },
    });

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Public: check the status of a previously submitted request. Requires both
// the request id and the matching email (see check_access_request_status in
// the migration for why that pair is safe to expose without auth). Rate
// limited by IP -- fails CLOSED, same reasoning as submitAccessRequest: this
// is an unauthenticated endpoint with no other barrier.
// ---------------------------------------------------------------------------

const StatusCheckInput = z.object({
  requestId: z.string().uuid(),
  email: Email,
});

export const checkAccessRequestStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => StatusCheckInput.parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    const ok = await checkRateLimit(
      clientKeyFromRequest(request, "access-request-status-ip"),
      10,
      3600,
    );
    if (!ok) throw new Error("RATE_LIMITED");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("check_access_request_status" as any, {
      _id: data.requestId,
      _email: data.email,
    });
    if (error) throw toStableError("access.status", error);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { found: false as const };
    return {
      found: true as const,
      status: row.status as string,
      reviewedAt: row.reviewed_at as string | null,
    };
  });
