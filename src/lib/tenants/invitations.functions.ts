import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/audit/audit.server";
import { toStableError } from "@/lib/ops/errors.server";

// `origin` is still accepted from older clients but is ignored: email links are
// always built from the server-side canonical origin (lib/ops/origin.server).
const LegacyOrigin = z.string().max(2048).optional();

const CreateInput = z.object({
  companyId: z.string().uuid(),
  email: z.string().email().max(200),
  role: z.enum(["finance", "shariah", "trader", "viewer"]),
  origin: LegacyOrigin,
});

export const createInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isOwner } = await supabase.rpc("is_company_owner", {
      _user_id: userId,
      _company_id: data.companyId,
    });
    if (!isOwner) throw new Error("FORBIDDEN");

    // Every invitation sends platform-branded mail: cap it per actor.
    const { checkRateLimit } = await import("@/lib/security/rate-limit.server");
    if (!(await checkRateLimit(`invite-create:actor:${userId}`, 30, 3600))) {
      throw new Error("RATE_LIMITED");
    }

    const { data: row, error } = await supabase
      .from("company_invitations")
      .insert({
        company_id: data.companyId,
        email: data.email.toLowerCase(),
        role: data.role,
        invited_by: userId,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("INVITATION_ALREADY_PENDING");
      throw toStableError("invitations.create", error);
    }

    const notification = await notifyInvite(supabase, row);
    await writeAudit(supabase, {
      actorId: userId, companyId: data.companyId, action: "invitation.create", entity: "company_invitations", entityId: row.id,
      metadata: { email: row.email, role: row.role },
    });
    return { ...row, notification };
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyInvite(supabase: any, invite: { id: string; company_id: string; email: string; role: string; token: string; invited_by: string }) {
  const { sendInvitationEmailBestEffort } = await import("./invitation-email.server");
  const { canonicalOrigin } = await import("@/lib/ops/origin.server");
  const { data: company } = await supabase.from("companies").select("name_en, name_ar").eq("id", invite.company_id).single();
  const co = (company ?? {}) as { name_en?: string; name_ar?: string };
  const url = `${canonicalOrigin()}/invitations?token=${encodeURIComponent(invite.token)}`;
  return await sendInvitationEmailBestEffort({
    email: invite.email,
    companyName: co.name_en || co.name_ar || "your company",
    acceptUrl: url,
    invitationId: invite.id,
    role: invite.role,
  });
}

export const listCompanyInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isOwner } = await supabase.rpc("is_company_owner", {
      _user_id: userId,
      _company_id: data.companyId,
    });
    if (!isOwner) throw new Error("FORBIDDEN");
    const { data: rows } = await supabase
      .from("company_invitations")
      .select("*")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false });
    return rows ?? [];
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ invitationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prev } = await supabase.from("company_invitations").select("company_id, email, role").eq("id", data.invitationId).maybeSingle();
    // RLS lets only the company's owners update; anyone else (e.g. the invitee,
    // who can read the row) matches no row. Nothing changed -> no audit row.
    const { data: revoked, error } = await supabase
      .from("company_invitations")
      .update({ status: "revoked" })
      .eq("id", data.invitationId)
      .eq("status", "pending")
      .select("id");
    if (error) throw toStableError("invitations.revoke", error);
    if (!revoked || revoked.length === 0) throw new Error(prev ? "FORBIDDEN" : "INVITATION_NOT_FOUND");
    await writeAudit(supabase, {
      actorId: userId, companyId: prev?.company_id ?? null, action: "invitation.revoke", entity: "company_invitations", entityId: data.invitationId,
      metadata: { email: prev?.email, role: prev?.role },
    });
    return { ok: true };
  });

const ResendInput = z.object({
  invitationId: z.string().uuid(),
  origin: LegacyOrigin,
});

/** Undo a revoke: returns a revoked, non-expired invitation back to pending. */
export const unrevokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ invitationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prev } = await supabase
      .from("company_invitations")
      .select("company_id, email, role, status, expires_at")
      .eq("id", data.invitationId)
      .maybeSingle();
    if (!prev) throw new Error("INVITATION_NOT_FOUND");
    const { data: isOwner } = await supabase.rpc("is_company_owner", {
      _user_id: userId,
      _company_id: prev.company_id,
    });
    if (!isOwner) throw new Error("FORBIDDEN");
    if (prev.status !== "revoked") throw new Error("INVITATION_NOT_REVOKED");
    if (new Date(prev.expires_at as string).getTime() < Date.now()) throw new Error("INVITATION_EXPIRED");
    const { data: restored, error } = await supabase
      .from("company_invitations")
      .update({ status: "pending" })
      .eq("id", data.invitationId)
      .eq("status", "revoked")
      .select("id");
    if (error) throw toStableError("invitations.unrevoke", error);
    if (!restored || restored.length === 0) throw new Error("INVITATION_NOT_REVOKED");
    await writeAudit(supabase, {
      actorId: userId, companyId: prev.company_id, action: "invitation.unrevoke", entity: "company_invitations", entityId: data.invitationId,
      metadata: { email: prev.email, role: prev.role },
    });
    return { ok: true };
  });

export const resendInvitationEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResendInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: invite, error } = await supabase
      .from("company_invitations")
      .select("*")
      .eq("id", data.invitationId)
      .single();
    if (error || !invite) throw new Error("INVITATION_NOT_FOUND");
    const { data: isOwner } = await supabase.rpc("is_company_owner", {
      _user_id: userId,
      _company_id: invite.company_id,
    });
    if (!isOwner) throw new Error("FORBIDDEN");
    if (invite.status !== "pending") throw new Error("INVITATION_NOT_PENDING");
    // Per-actor cap on resends so an owner cannot use the platform's mail
    // domain to spam an address: 10 per hour per actor, 3 per hour per invite.
    const { checkRateLimit } = await import("@/lib/security/rate-limit.server");
    const [actorOk, inviteOk] = await Promise.all([
      checkRateLimit(`invite-resend:actor:${userId}`, 10, 3600),
      checkRateLimit(`invite-resend:invite:${invite.id}`, 3, 3600),
    ]);
    if (!actorOk || !inviteOk) throw new Error("RATE_LIMITED");
    const notification = await notifyInvite(supabase, invite);
    await writeAudit(supabase, {
      actorId: userId, companyId: invite.company_id, action: "invitation.resend", entity: "company_invitations", entityId: invite.id,
      metadata: { email: invite.email, role: invite.role },
    });
    return { notification };
  });

export type MyInvitation = {
  id: string;
  role: string;
  token: string;
  status: string;
  expires_at: string;
  created_at: string;
  company_id: string;
  companies: { name_ar: string; name_en: string; slug: string } | null;
};

export const listMyInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyInvitation[]> => {
    // RLS returns only the pending invitations addressed to the caller's
    // verified email. An invitee is not a member of the inviting company yet
    // (a new company's founder is not a member of anything), so companies RLS
    // hides the company row: its display name is resolved with the service
    // role, only for the invitations already returned.
    const { data: rows, error } = await context.supabase
      .from("company_invitations")
      .select("id, role, token, status, expires_at, created_at, company_id")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw toStableError("invitations.listMine", error);
    const invitations = rows ?? [];
    const companyIds = Array.from(new Set(invitations.map((r) => r.company_id)));
    const names = new Map<string, { name_ar: string; name_en: string; slug: string }>();
    if (companyIds.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: companies, error: coErr } = await supabaseAdmin
        .from("companies")
        .select("id, name_ar, name_en, slug")
        .in("id", companyIds);
      if (coErr) throw toStableError("invitations.listMine.companies", coErr);
      for (const c of companies ?? []) names.set(c.id, { name_ar: c.name_ar, name_en: c.name_en, slug: c.slug });
    }
    return invitations.map((r) => ({ ...r, companies: names.get(r.company_id) ?? null }));
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const actorEmail = (claims as { email?: string } | null)?.email ?? "";
    if (!actorEmail) throw new Error("NOT_AUTHENTICATED");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: companyId, error } = await supabaseAdmin.rpc("accept_company_invitation", {
      _token: data.token,
      _actor_id: userId,
      _actor_email: actorEmail,
    });
    if (error) throw toStableError("invitations.accept", error);
    await writeAudit(supabase, {
      actorId: userId, companyId: companyId as string | null, action: "invitation.accept", entity: "company_invitations",
      metadata: {},
    });
    return { companyId };
  });