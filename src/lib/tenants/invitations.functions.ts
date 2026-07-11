import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CreateInput = z.object({
  companyId: z.string().uuid(),
  email: z.string().email().max(200),
  role: z.enum(["finance", "shariah", "trader", "viewer"]),
  origin: z.string().url().optional(),
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
      throw new Error(error.message);
    }

    const notification = await notifyInvite(supabase, row, data.origin);
    return { ...row, notification };
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyInvite(supabase: any, invite: { id: string; company_id: string; email: string; role: string; token: string; invited_by: string }, origin?: string) {
  const { sendInvitationEmailBestEffort } = await import("./invitation-email.server");
  const { data: company } = await supabase.from("companies").select("name_en, name_ar").eq("id", invite.company_id).single();
  const co = (company ?? {}) as { name_en?: string; name_ar?: string };
  const base = origin ?? process.env.PUBLIC_APP_ORIGIN ?? "";
  const url = `${base}/invitations?token=${invite.token}`;
  return await sendInvitationEmailBestEffort({
    email: invite.email,
    companyName: co.name_en || co.name_ar || "your company",
    acceptUrl: url,
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
    const { error } = await context.supabase
      .from("company_invitations")
      .update({ status: "revoked" })
      .eq("id", data.invitationId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ResendInput = z.object({
  invitationId: z.string().uuid(),
  origin: z.string().url().optional(),
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
    const notification = await notifyInvite(supabase, invite, data.origin);
    return { notification };
  });

export const listMyInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // RLS filters by auth.jwt() email match; we also join company for display.
    const { data: rows } = await context.supabase
      .from("company_invitations")
      .select("id, role, token, status, expires_at, created_at, company_id, companies:companies!inner(name_ar, name_en, slug)")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    return rows ?? [];
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: companyId, error } = await context.supabase.rpc("accept_company_invitation", { _token: data.token });
    if (error) throw new Error(error.message);
    return { companyId };
  });