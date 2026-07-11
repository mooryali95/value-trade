// Server-only best-effort invitation notification.
// When RESEND_API_KEY is configured (via the Resend connector or a manual
// secret) we send a real email through the Lovable connector gateway.
// Otherwise we log the acceptance URL server-side and return a status the
// caller can surface to the UI so the owner can copy the link manually.

const LOVABLE_CONNECTOR_GATEWAY = "https://connector-gateway.lovable.dev";

export type InvitationEmailResult =
  | { sent: true; provider: "resend" }
  | { sent: false; reason: "EMAIL_NOT_CONFIGURED" | "PROVIDER_ERROR"; detail?: string };

export async function sendInvitationEmailBestEffort(input: {
  email: string;
  companyName: string;
  acceptUrl: string;
  invitedByEmail?: string | null;
  role: string;
}): Promise<InvitationEmailResult> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  // Always log so ops has a paper trail — the URL itself is single-use
  // and expires after 7 days.
  console.info("[invite]", {
    to: input.email,
    company: input.companyName,
    role: input.role,
    url: input.acceptUrl,
  });

  if (!lovableKey || !resendKey) {
    return { sent: false, reason: "EMAIL_NOT_CONFIGURED" };
  }

  try {
    const html = renderInvitationHtml(input);
    const res = await fetch(`${LOVABLE_CONNECTOR_GATEWAY}/resend/emails`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${lovableKey}`,
        "x-connection-api-key": resendKey,
      },
      body: JSON.stringify({
        from: "Value Unit <onboarding@resend.dev>",
        to: [input.email],
        subject: `Invitation to join ${input.companyName} on Value Unit`,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("[invite] provider error", res.status, detail);
      return { sent: false, reason: "PROVIDER_ERROR", detail: `${res.status}` };
    }
    return { sent: true, provider: "resend" };
  } catch (err) {
    console.error("[invite] send failed", err);
    return { sent: false, reason: "PROVIDER_ERROR", detail: err instanceof Error ? err.message : String(err) };
  }
}

function renderInvitationHtml(input: {
  email: string;
  companyName: string;
  acceptUrl: string;
  invitedByEmail?: string | null;
  role: string;
}) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#ffffff;padding:24px;color:#111827">
  <div style="max-width:520px;margin:auto">
    <h2 style="margin:0 0 12px">You're invited to ${esc(input.companyName)}</h2>
    <p style="margin:0 0 12px">You have been invited${input.invitedByEmail ? ` by ${esc(input.invitedByEmail)}` : ""} to join <b>${esc(input.companyName)}</b> on Value Unit as <b>${esc(input.role)}</b>.</p>
    <p style="margin:16px 0"><a href="${esc(input.acceptUrl)}" style="background:#111827;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Accept invitation</a></p>
    <p style="margin:12px 0;color:#6b7280;font-size:12px">Or copy this link into your browser:<br/><code style="word-break:break-all">${esc(input.acceptUrl)}</code></p>
    <p style="margin-top:24px;color:#6b7280;font-size:12px">This invitation expires in 7 days. If you were not expecting it, you can ignore this email.</p>
  </div>
</body></html>`;
}