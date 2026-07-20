// Server-only invitation notification via the internal Lovable Emails queue.
// Renders the branded `invitation` React Email template and enqueues it into
// the `transactional_emails` pgmq queue for delivery through Lovable Emails.

import { enqueueTransactionalEmail } from "@/lib/email/enqueue.server";

export type InvitationEmailResult =
  | { sent: true; provider: "lovable"; messageId: string }
  | { sent: false; reason: "SUPPRESSED" | "PROVIDER_ERROR"; detail?: string };

export async function sendInvitationEmailBestEffort(input: {
  email: string;
  companyName: string;
  acceptUrl: string;
  invitedByEmail?: string | null;
  role: string;
}): Promise<InvitationEmailResult> {
  // Ops paper trail — the URL itself is single-use and expires after 7 days.
  console.info("[invite]", {
    to: input.email,
    company: input.companyName,
    role: input.role,
    url: input.acceptUrl,
  });

  const result = await enqueueTransactionalEmail({
    templateName: "invitation",
    recipientEmail: input.email,
    idempotencyKey: `invite:${input.acceptUrl}`,
    label: "invitation",
    templateData: {
      companyName: input.companyName,
      role: input.role,
      invitedByEmail: input.invitedByEmail ?? null,
      acceptUrl: input.acceptUrl,
    },
  });

  if (result.sent) return { sent: true, provider: "lovable", messageId: result.messageId };
  if (result.reason === "suppressed") return { sent: false, reason: "SUPPRESSED" };
  return { sent: false, reason: "PROVIDER_ERROR", detail: result.detail };
}