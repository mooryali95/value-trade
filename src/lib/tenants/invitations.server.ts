// Server-only helpers shared by the invitation server functions.

import { canonicalOrigin } from "@/lib/ops/origin.server";
import { sendInvitationEmailBestEffort, type InvitationEmailResult } from "./invitation-email.server";

export type InvitationRecord = {
  id: string;
  company_id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  expires_at: string;
  created_at?: string;
  invited_by?: string;
};

/** Public landing page of an invitation (works with or without an account). */
export function invitationUrl(token: string): string {
  return `${canonicalOrigin()}/invite/${encodeURIComponent(token)}`;
}

/** "pending" rows past their expiry read as "expired". */
export function effectiveInvitationStatus(status: string, expiresAt: string, now = Date.now()): string {
  if (status === "pending" && new Date(expiresAt).getTime() <= now) return "expired";
  return status;
}

/** Sends the branded, bilingual invitation e-mail. Never throws. */
export async function notifyInvitation(invite: InvitationRecord): Promise<InvitationEmailResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name_en, name_ar")
      .eq("id", invite.company_id)
      .maybeSingle();
    const co = (company ?? {}) as { name_en?: string | null; name_ar?: string | null };
    return await sendInvitationEmailBestEffort({
      email: invite.email,
      companyNameAr: co.name_ar ?? null,
      companyNameEn: co.name_en ?? null,
      acceptUrl: invitationUrl(invite.token),
      invitationId: invite.id,
      role: invite.role,
      expiresAt: invite.expires_at,
    });
  } catch (err) {
    console.error("[invite] notify threw", err instanceof Error ? err.name : "unknown");
    return { sent: false, reason: "PROVIDER_ERROR" };
  }
}

/**
 * Whether `userId` manages invitations of `companyId`: an owner of the
 * company, or a platform admin (who has no membership in a company created
 * from an approved access request until its founder accepts).
 */
export async function invitationManager(
  userId: string,
  companyId: string,
): Promise<{ allowed: boolean; isOwner: boolean; isAdmin: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [ownerRes, adminRes] = await Promise.all([
    supabaseAdmin.rpc("is_company_owner", { _user_id: userId, _company_id: companyId }),
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "platform_admin" }),
  ]);
  if (ownerRes.error || adminRes.error) {
    console.error("[invite] permission lookup failed", (ownerRes.error ?? adminRes.error)?.code ?? "");
    throw new Error("INTERNAL_ERROR");
  }
  const isOwner = ownerRes.data === true;
  const isAdmin = adminRes.data === true;
  return { allowed: isOwner || isAdmin, isOwner, isAdmin };
}
