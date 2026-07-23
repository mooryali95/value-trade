// Server-only: notify position holders of a symbol about a data update.
// Uses the unified notifier with audience='positions' so only holders receive
// the email (respects notification_preferences.position_updates_email).

import { notifySymbolEvent } from "@/lib/notifications/notify.server";

export async function notifyPositionHolders(input: {
  symbol: string;
  eventId: string; // unique id for this update (drives idempotency)
  headline: string;
  detail?: string;
  viewUrl?: string;
}): Promise<{ notified: number }> {
  return notifySymbolEvent({
    symbol: input.symbol,
    pref: "position_updates_email",
    templateName: "position-update",
    audience: "positions",
    idempotencyPrefix: `position-update:${input.eventId}`,
    label: "position-update",
    templateData: {
      symbol: input.symbol,
      headline: input.headline,
      detail: input.detail ?? "",
      viewUrl: input.viewUrl ?? "https://hub.sunkvalue.com/portfolio",
    },
  });
}