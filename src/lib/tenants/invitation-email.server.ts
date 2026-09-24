// Server-only invitation notification via the internal Lovable Emails queue.
// Renders the branded `invitation` React Email template and enqueues it into
// the `transactional_emails` pgmq queue for delivery through Lovable Emails.

import { enqueueTransactionalEmail } from "@/lib/email/enqueue.server";

export type InvitationEmailResult =
  | { sent: true; provider: "lovable"; messageId: string }
  | { sent: false; reason: "SUPPRESSED" | "PROVIDER_ERROR"; detail?: string };

/** a***@domain — enough to correlate in ops without logging the address. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "***";
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***@${email.slice(at + 1)}`;
}

export async function sendInvitationEmailBestEffort(input: {
  email: string;
  /** Company name in each language (the e-mail is bilingual). */
  companyNameAr?: string | null;
  companyNameEn?: string | null;
  /** Legacy single name, used when the localized names are missing. */
  companyName?: string;
  acceptUrl: string;
  invitedByEmail?: string | null;
  role: string;
  /** ISO timestamp of the invitation's expiry. */
  expiresAt?: string | null;
  /** Used for the idempotency key; never put the accept URL/token in keys or logs. */
  invitationId?: string;
}): Promise<InvitationEmailResult> {
  // Ops paper trail without the recipient address or the single-use token.
  console.info("[invite]", {
    to: maskEmail(input.email),
    invitationId: input.invitationId ?? null,
    role: input.role,
  });

  // Dedupe accidental double submits within the same minute, while still
  // letting a deliberate resend a minute later go out.
  const bucket = Math.floor(Date.now() / 60_000);
  const result = await enqueueTransactionalEmail({
    templateName: "invitation",
    recipientEmail: input.email,
    // A resend / re-issue changes expiresAt, so it is never deduplicated away.
    idempotencyKey: input.invitationId
      ? `invite:${input.invitationId}:${input.expiresAt ?? ""}:${bucket}`
      : undefined,
    label: "invitation",
    templateData: {
      companyNameAr: input.companyNameAr || input.companyNameEn || input.companyName || null,
      companyNameEn: input.companyNameEn || input.companyNameAr || input.companyName || null,
      role: input.role,
      invitedByEmail: input.invitedByEmail ?? null,
      acceptUrl: input.acceptUrl,
      expiresAt: input.expiresAt ?? null,
    },
  });

  if (result.sent) return { sent: true, provider: "lovable", messageId: result.messageId };
  if (result.reason === "suppressed") return { sent: false, reason: "SUPPRESSED" };
  // Provider/driver text stays server side; the browser only sees the code.
  if (result.detail) console.error("[invite] enqueue failed", result.reason, result.detail);
  return { sent: false, reason: "PROVIDER_ERROR" };
}