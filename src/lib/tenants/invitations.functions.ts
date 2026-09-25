import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/audit/audit.server";
import { toStableError } from "@/lib/ops/errors.server";

/**
 * Company invitations.
 *
 * Every write goes through a SECURITY DEFINER function that only the service
 * role may execute (create_company_invitation, renew_company_invitation,
 * accept_company_invitation), called with the verified user id. API users
 * can read their company's invitations and revoke a pending one, nothing
 * else (see 20260926100000_invitation_lifecycle.sql).
 *
 * The invitation e-mail links to the public page /invite/<token>, which
 * works for people who have no account yet. Accepting requires a signed-in
 * account whose own, confirmed e-mail address is the invited one (checked
 * against auth.users, never against the JWT email claim).
 */

// `origin` is still accepted from older clients but is ignored: links are
// always built from the server-side canonical origin (lib/ops/origin.server).
const LegacyOrigin = z.string().max(2048).optional();

const CompanyRoleEnum = z.enum(["owner", "finance", "shariah", "trader", "viewer"]);

const CreateInput = z.object({
  companyId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(320),
  role: CompanyRoleEnum,
  origin: LegacyOrigin,
});

export type InvitationNotification = { sent: boolean; reason?: string };

export type CompanyInvitation = {
  id: string;
  email: string;
  role: string;
  /** Effective status: a pending invitation past its expiry reads "expired". */
  status: "pending" | "expired" | "accepted" | "revoked";
  expiresAt: string;
  createdAt: string;
  /** Link to the public invitation page; only while the invitation is pending. */
  inviteUrl: string | null;
};

type InvitationRow = {
  id: string;
  company_id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  expires_at: string;
  created_at: string;
  invited_by: string;
};

/** A function returning one composite row may come back as an object or a one-element array. */
function firstRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function toCompanyInvitation(row: InvitationRow): Promise<CompanyInvitation> {
  const { effectiveInvitationStatus, invitationUrl } = await import("./invitations.server");
  const status = effectiveInvitationStatus(row.status, row.expires_at) as CompanyInvitation["status"];
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    inviteUrl: status === "pending" ? invitationUrl(row.token) : null,
  };
}

export const createInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { invitationManager, adminRpc, notifyInvitation } = await import("./invitations.server");
    const manager = await invitationManager(userId, data.companyId);
    if (!manager.allowed) throw new Error("FORBIDDEN");
    if (data.role === "owner" && !manager.isAdmin) throw new Error("FORBIDDEN");

    // Every invitation sends platform-branded mail: cap it per actor.
    const { checkRateLimit } = await import("@/lib/security/rate-limit.server");
    if (!(await checkRateLimit(`invite-create:actor:${userId}`, 30, 3600))) {
      throw new Error("RATE_LIMITED");
    }

    const { data: result, error } = await adminRpc<InvitationRow | InvitationRow[]>("create_company_invitation", {
      _company_id: data.companyId,
      _email: data.email,
      _role: data.role,
      _actor_id: userId,
    });
    const row = firstRow(result);
    if (error || !row) throw toStableError("invitations.create", error);

    const notification = await notifyInvitation(row);
    await writeAudit(context.supabase, {
      actorId: userId, companyId: data.companyId, action: "invitation.create", entity: "company_invitations", entityId: row.id,
      metadata: { email: row.email, role: row.role, emailSent: notification.sent },
    });
    return { invitation: await toCompanyInvitation(row), notification: notification as InvitationNotification };
  });

export const listCompanyInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CompanyInvitation[]> => {
    const { invitationManager } = await import("./invitations.server");
    const manager = await invitationManager(context.userId, data.companyId);
    if (!manager.allowed) throw new Error("FORBIDDEN");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("company_invitations")
      .select("id, company_id, email, role, token, status, expires_at, created_at, invited_by")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw toStableError("invitations.list", error);
    return Promise.all(((rows ?? []) as InvitationRow[]).map(toCompanyInvitation));
  });

async function loadInvitation(invitationId: string): Promise<InvitationRow> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await supabaseAdmin
    .from("company_invitations")
    .select("id, company_id, email, role, token, status, expires_at, created_at, invited_by")
    .eq("id", invitationId)
    .maybeSingle();
  if (error) throw toStableError("invitations.load", error);
  if (!row) throw new Error("INVITATION_NOT_FOUND");
  return row as InvitationRow;
}

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ invitationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const prev = await loadInvitation(data.invitationId);
    const { invitationManager } = await import("./invitations.server");
    if (!(await invitationManager(userId, prev.company_id)).allowed) throw new Error("FORBIDDEN");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: revoked, error } = await supabaseAdmin
      .from("company_invitations")
      .update({ status: "revoked" })
      .eq("id", data.invitationId)
      .eq("status", "pending")
      .select("id");
    if (error) throw toStableError("invitations.revoke", error);
    if (!revoked || revoked.length === 0) throw new Error("INVITATION_NOT_PENDING");
    await writeAudit(context.supabase, {
      actorId: userId, companyId: prev.company_id, action: "invitation.revoke", entity: "company_invitations", entityId: data.invitationId,
      metadata: { email: prev.email, role: prev.role },
    });
    return { ok: true };
  });

/** Undo a revoke: returns a revoked, non-expired invitation back to pending. */
export const unrevokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ invitationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const prev = await loadInvitation(data.invitationId);
    const { invitationManager, adminRpc } = await import("./invitations.server");
    if (!(await invitationManager(userId, prev.company_id)).allowed) throw new Error("FORBIDDEN");
    if (prev.status !== "revoked") throw new Error("INVITATION_NOT_REVOKED");
    if (new Date(prev.expires_at).getTime() <= Date.now()) throw new Error("INVITATION_EXPIRED");
    const { data: member } = await adminRpc<boolean>("company_has_member_email", {
      _company_id: prev.company_id,
      _email: prev.email,
    });
    if (member === true) throw new Error("ALREADY_MEMBER");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: restored, error } = await supabaseAdmin
      .from("company_invitations")
      .update({ status: "pending" })
      .eq("id", data.invitationId)
      .eq("status", "revoked")
      .select("id");
    if (error) {
      // A newer invitation to the same address is pending.
      if (error.code === "23505") throw new Error("INVITATION_ALREADY_PENDING");
      throw toStableError("invitations.unrevoke", error);
    }
    if (!restored || restored.length === 0) throw new Error("INVITATION_NOT_REVOKED");
    await writeAudit(context.supabase, {
      actorId: userId, companyId: prev.company_id, action: "invitation.unrevoke", entity: "company_invitations", entityId: data.invitationId,
      metadata: { email: prev.email, role: prev.role },
    });
    return { ok: true };
  });

const ResendInput = z.object({
  invitationId: z.string().uuid(),
  /** New link (the old one stops working). An expired invitation always gets one. */
  reissue: z.boolean().optional(),
  origin: LegacyOrigin,
});

/**
 * Resend: extends a pending invitation by 7 days (same link) and e-mails it
 * again. Re-issue (or any expired invitation): new token, new 7 days; the
 * old link stops working.
 */
export const resendInvitationEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResendInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const prev = await loadInvitation(data.invitationId);
    const { invitationManager, adminRpc, notifyInvitation } = await import("./invitations.server");
    if (!(await invitationManager(userId, prev.company_id)).allowed) throw new Error("FORBIDDEN");
    // Per-actor cap on resends so the platform's mail domain cannot be used
    // to spam an address: 10 per hour per actor, 3 per hour per invitation.
    const { checkRateLimit } = await import("@/lib/security/rate-limit.server");
    const [actorOk, inviteOk] = await Promise.all([
      checkRateLimit(`invite-resend:actor:${userId}`, 10, 3600),
      checkRateLimit(`invite-resend:invite:${prev.id}`, 3, 3600),
    ]);
    if (!actorOk || !inviteOk) throw new Error("RATE_LIMITED");

    const { data: result, error } = await adminRpc<InvitationRow | InvitationRow[]>("renew_company_invitation", {
      _invitation_id: prev.id,
      _actor_id: userId,
      _rotate_token: data.reissue === true,
    });
    const row = firstRow(result);
    if (error || !row) throw toStableError("invitations.renew", error);
    const rotated = row.token !== prev.token;
    const notification = await notifyInvitation(row);
    await writeAudit(context.supabase, {
      actorId: userId, companyId: row.company_id, action: rotated ? "invitation.reissue" : "invitation.resend",
      entity: "company_invitations", entityId: row.id,
      metadata: { email: row.email, role: row.role, emailSent: notification.sent },
    });
    return { invitation: await toCompanyInvitation(row), notification: notification as InvitationNotification, reissued: rotated };
  });

export type MyInvitation = {
  id: string;
  role: string;
  token: string;
  /** "pending" or "expired" (a pending invitation past its expiry). */
  status: "pending" | "expired";
  expires_at: string;
  created_at: string;
  company_id: string;
  companies: { name_ar: string; name_en: string; slug: string } | null;
};

/**
 * Invitations addressed to the caller's own, confirmed e-mail address
 * (auth.users, not the JWT claim). Unconfirmed accounts get
 * EMAIL_NOT_CONFIRMED: an invitation token is a credential.
 */
export const listMyInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyInvitation[]> => {
    const { loadAccount } = await import("@/lib/account/platform-invite.server");
    const account = await loadAccount(context.userId);
    if (!account) throw new Error("NOT_AUTHENTICATED");
    if (!account.email) return [];
    if (!account.emailConfirmed) throw new Error("EMAIL_NOT_CONFIRMED");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("company_invitations")
      .select("id, role, token, status, expires_at, created_at, company_id")
      .eq("email", account.email)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw toStableError("invitations.listMine", error);
    const invitations = rows ?? [];
    const companyIds = Array.from(new Set(invitations.map((r) => r.company_id)));
    const names = new Map<string, { name_ar: string; name_en: string; slug: string }>();
    if (companyIds.length > 0) {
      const { data: companies, error: coErr } = await supabaseAdmin
        .from("companies")
        .select("id, name_ar, name_en, slug")
        .in("id", companyIds);
      if (coErr) throw toStableError("invitations.listMine.companies", coErr);
      for (const c of companies ?? []) names.set(c.id, { name_ar: c.name_ar, name_en: c.name_en, slug: c.slug });
    }
    const now = Date.now();
    return invitations.map((r) => ({
      ...r,
      status: new Date(r.expires_at).getTime() <= now ? ("expired" as const) : ("pending" as const),
      companies: names.get(r.company_id) ?? null,
    }));
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { loadAccount } = await import("@/lib/account/platform-invite.server");
    const account = await loadAccount(userId);
    if (!account || !account.email) throw new Error("NOT_AUTHENTICATED");
    if (!account.emailConfirmed) throw new Error("EMAIL_NOT_CONFIRMED");
    const { adminRpc } = await import("./invitations.server");
    const { data: companyId, error } = await adminRpc<string>("accept_company_invitation", {
      _token: data.token,
      _actor_id: userId,
      _actor_email: account.email,
    });
    if (error || !companyId) {
      const failure = toStableError("invitations.accept", error);
      if (failure.message === "INVITATION_EXPIRED") {
        // The function refuses without writing; record the expiry here, in
        // its own statement, so the row stops reading as pending. Best
        // effort: the caller gets INVITATION_EXPIRED either way.
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error: expErr } = await supabaseAdmin
            .from("company_invitations")
            .update({ status: "expired" })
            .eq("token", data.token)
            .eq("status", "pending")
            .lte("expires_at", new Date().toISOString());
          if (expErr) console.error("[invitations.accept] marking expired failed", expErr.code ?? "");
        } catch (err) {
          console.error("[invitations.accept] marking expired threw", err instanceof Error ? err.name : "unknown");
        }
      }
      throw failure;
    }
    await writeAudit(context.supabase, {
      actorId: userId, companyId, action: "invitation.accept", entity: "company_invitations",
      metadata: {},
    });
    return { companyId };
  });

// ---------------------------------------------------------------------------
// Public invitation page (/invite/<token>): no session required. The token
// is the secret; the invited address is masked before it leaves the server.
// ---------------------------------------------------------------------------

const TokenInput = z.object({ token: z.string().uuid() });

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export type InvitationPreview =
  | { found: false }
  | {
      found: true;
      status: "pending" | "expired" | "accepted" | "revoked";
      companyNameAr: string | null;
      companyNameEn: string | null;
      role: string | null;
      emailHint: string | null;
      expiresAt: string | null;
    };

type PreviewRow = {
  invitation_id: string;
  company_id: string;
  company_name_ar: string;
  company_name_en: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
};

async function previewRow(token: string): Promise<PreviewRow | null> {
  const { adminRpc } = await import("./invitations.server");
  const { data, error } = await adminRpc<PreviewRow[]>("invitation_preview", { _token: token });
  if (error) throw toStableError("invitations.preview", error);
  const rows = Array.isArray(data) ? data : [];
  return rows[0] ?? null;
}

export const getInvitationPreview = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TokenInput.parse(input))
  .handler(async ({ data }): Promise<InvitationPreview> => {
    const { checkRateLimit, clientKeyFromRequest } = await import("@/lib/security/rate-limit.server");
    if (!(await checkRateLimit(clientKeyFromRequest(getRequest(), "invite-preview-ip"), 60, 600))) {
      throw new Error("RATE_LIMITED");
    }
    const row = await previewRow(data.token);
    if (!row) return { found: false };
    const status = (["pending", "expired", "accepted", "revoked"].includes(row.status) ? row.status : "revoked") as
      | "pending"
      | "expired"
      | "accepted"
      | "revoked";
    if (status === "revoked") {
      return { found: true, status, companyNameAr: null, companyNameEn: null, role: null, emailHint: null, expiresAt: null };
    }
    const { maskEmail } = await import("./invitation-email.server");
    return {
      found: true,
      status,
      companyNameAr: row.company_name_ar ?? null,
      companyNameEn: row.company_name_en ?? null,
      role: row.role,
      emailHint: maskEmail(row.email),
      expiresAt: row.expires_at,
    };
  });

/**
 * E-mails the invited address a secure link to create the account (Supabase
 * Auth invitation) or, when an account already exists, to set a new
 * password. Either way the link lands on /auth/update-password, which then
 * returns to /invite/<token>. The address always comes from the invitation,
 * never from the browser.
 */
export const sendInvitationAccountLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TokenInput.parse(input))
  .handler(async ({ data }): Promise<{ sent: true }> => {
    const { checkRateLimit, clientKeyFromRequest } = await import("@/lib/security/rate-limit.server");
    const [ipOk, tokenOk] = await Promise.all([
      checkRateLimit(clientKeyFromRequest(getRequest(), "invite-account-link-ip"), 10, 3600),
      // The token is a credential: only its hash is used as the key.
      checkRateLimit(`invite-account-link:${await sha256Hex(data.token)}`, 3, 3600),
    ]);
    if (!ipOk || !tokenOk) throw new Error("RATE_LIMITED");

    const row = await previewRow(data.token);
    if (!row) throw new Error("INVITATION_NOT_FOUND");
    if (row.status === "expired") throw new Error("INVITATION_EXPIRED");
    if (row.status !== "pending") throw new Error("INVITATION_NOT_PENDING");

    const { sendAccountLink } = await import("@/lib/account/platform-invite.server");
    const result = await sendAccountLink(row.email, {
      next: `/invite/${data.token}`,
      fallbackToRecovery: true,
    });
    if (!result.sent) {
      throw new Error(result.reason === "RATE_LIMITED" ? "RATE_LIMITED" : "EMAIL_SEND_FAILED");
    }
    return { sent: true };
  });
