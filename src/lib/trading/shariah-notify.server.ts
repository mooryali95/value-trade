// Server-only: notify interested users when a shariah decision changes.
// "Interested" = union of position holders, explicit symbol_watchers, and
// users with a price_alert on the same symbol. Respects notification_preferences.

import { notifySymbolEvent } from "@/lib/notifications/notify.server";

export async function notifyShariahDecision(input: {
  decisionId: string;
  symbol: string;
  status: "halal" | "non_halal" | "reviewing";
  reason?: string | null;
  reviewerName?: string | null;
}): Promise<{ notified: number }> {
  return notifySymbolEvent({
    symbol: input.symbol,
    pref: "shariah_decisions_email",
    templateName: "shariah-decision",
    idempotencyPrefix: `shariah-decision:${input.decisionId}`,
    label: "shariah-decision",
    templateData: {
      symbol: input.symbol,
      status: input.status,
      reason: input.reason ?? undefined,
      reviewerName: input.reviewerName ?? undefined,
      viewUrl: "https://hub.sunkvalue.com/shariah",
    },
  });
}