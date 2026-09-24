// Server-only: e-mail links that let a person create (or recover) a Value Unit
// account with a password. The links come from Supabase Auth
// (admin inviteUserByEmail / resetPasswordForEmail) and are delivered by the
// auth e-mail hook (src/routes/lovable/email/auth/webhook.ts) with the
// branded `invite` / `recovery` templates. They always point at the
// canonical origin, never at an origin supplied by the browser.

import { canonicalOrigin } from "@/lib/ops/origin.server";
import { maskEmail } from "@/lib/tenants/invitation-email.server";

export type AccountLinkResult =
  | { sent: true; kind: "invite" | "recovery" }
  | { sent: false; reason: "ALREADY_REGISTERED" | "RATE_LIMITED" | "PROVIDER_ERROR" };

/** Only same-site paths ("/x"), never "//host" or "/\host". */
function safePath(next: string): string {
  return /^\/(?![/\\])[^\\\s]*$/.test(next) ? next : "/";
}

/**
 * Where the e-mail link lands: the set-password page, which then continues
 * to `next` (e.g. "/invite/<token>" to accept a company invitation).
 */
export function accountLinkRedirect(flow: "invite" | "recovery", next: string): string {
  return `${canonicalOrigin()}/auth/update-password?flow=${flow}&next=${encodeURIComponent(safePath(next))}`;
}

type AuthErr = { code?: string; status?: number; message?: string } | null | undefined;

function isAlreadyRegistered(error: AuthErr): boolean {
  if (!error) return false;
  if (error.code === "email_exists" || error.code === "user_already_exists") return true;
  return error.status === 422 && /already|registered|exists/i.test(error.message ?? "");
}

function isRateLimited(error: AuthErr): boolean {
  if (!error) return false;
  return (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit"
  );
}

/**
 * Sends a Supabase Auth invitation (set-password link) to `email`. When an
 * account already exists: with `fallbackToRecovery`, a password-reset link is
 * sent instead (same landing page); otherwise ALREADY_REGISTERED is returned
 * so the caller can send its own notice.
 */
export async function sendAccountLink(
  email: string,
  opts: { next: string; fallbackToRecovery: boolean; data?: Record<string, unknown> },
): Promise<AccountLinkResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const address = email.trim().toLowerCase();
  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(address, {
    redirectTo: accountLinkRedirect("invite", opts.next),
    data: opts.data ?? {},
  });
  if (!error) {
    console.info("[account-link] invite sent", { to: maskEmail(address) });
    return { sent: true, kind: "invite" };
  }
  if (isRateLimited(error)) return { sent: false, reason: "RATE_LIMITED" };
  if (!isAlreadyRegistered(error)) {
    console.error("[account-link] invite failed", error.status ?? "", error.code ?? "");
    return { sent: false, reason: "PROVIDER_ERROR" };
  }
  if (!opts.fallbackToRecovery) return { sent: false, reason: "ALREADY_REGISTERED" };

  const { error: recErr } = await supabaseAdmin.auth.resetPasswordForEmail(address, {
    redirectTo: accountLinkRedirect("recovery", opts.next),
  });
  if (!recErr) {
    console.info("[account-link] recovery sent", { to: maskEmail(address) });
    return { sent: true, kind: "recovery" };
  }
  if (isRateLimited(recErr)) return { sent: false, reason: "RATE_LIMITED" };
  console.error("[account-link] recovery failed", recErr.status ?? "", recErr.code ?? "");
  return { sent: false, reason: "PROVIDER_ERROR" };
}

/** The verified account behind a user id: its e-mail and whether it is confirmed. */
export async function loadAccount(
  userId: string,
): Promise<{ email: string | null; emailConfirmed: boolean } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  const u = data.user as { email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null };
  return {
    email: u.email ? u.email.trim().toLowerCase() : null,
    emailConfirmed: !!u.email_confirmed_at,
  };
}
