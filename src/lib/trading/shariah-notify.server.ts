// Server-only: notify interested users when a shariah decision changes.
// "Interested" = users with any price_alert (any status) on the same symbol.

import { enqueueTransactionalEmail } from "@/lib/email/enqueue.server";

export async function notifyShariahDecision(input: {
  decisionId: string;
  symbol: string;
  status: "halal" | "non_halal" | "reviewing";
  reason?: string | null;
  reviewerName?: string | null;
}): Promise<{ notified: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: interested } = await supabaseAdmin
    .from("price_alerts")
    .select("user_id")
    .eq("symbol", input.symbol);

  const userIds = Array.from(new Set((interested ?? []).map((r) => r.user_id).filter(Boolean)));
  let notified = 0;
  for (const uid of userIds) {
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
      const email = u?.user?.email;
      if (!email) continue;
      const r = await enqueueTransactionalEmail({
        templateName: "shariah-decision",
        recipientEmail: email,
        idempotencyKey: `shariah-decision:${input.decisionId}:${uid}`,
        label: "shariah-decision",
        templateData: {
          symbol: input.symbol,
          status: input.status,
          reason: input.reason ?? undefined,
          reviewerName: input.reviewerName ?? undefined,
          viewUrl: "https://hub.sunkvalue.com/shariah",
        },
      });
      if (r.sent) notified += 1;
    } catch (err) {
      console.error("[shariah-notify] enqueue failed", { uid, err });
    }
  }
  return { notified };
}