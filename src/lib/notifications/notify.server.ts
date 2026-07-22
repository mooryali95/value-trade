// Server-only: unified notifier for symbol-related events. Notifies:
//   - price alert owner (price_alerts.user_id)
//   - explicit watchers (symbol_watchers)
//   - position holders (positions)
// Honors notification_preferences per user.

import { enqueueTransactionalEmail } from "@/lib/email/enqueue.server";

type PrefKey = "price_alerts_email" | "shariah_decisions_email" | "position_updates_email";

async function interestedUserIds(symbol: string): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [watchers, positions, alerts] = await Promise.all([
    supabaseAdmin.from("symbol_watchers").select("user_id").eq("symbol", symbol),
    supabaseAdmin.from("positions").select("user_id").eq("symbol", symbol),
    supabaseAdmin.from("price_alerts").select("user_id").eq("symbol", symbol),
  ]);
  const set = new Set<string>();
  for (const list of [watchers.data, positions.data, alerts.data]) {
    for (const r of list ?? []) if (r?.user_id) set.add(r.user_id as string);
  }
  return Array.from(set);
}

async function prefEnabledMap(userIds: string[], pref: PrefKey): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("notification_preferences")
    .select(`user_id, ${pref}`)
    .in("user_id", userIds);
  const overrides = new Map<string, boolean>();
  for (const row of (data ?? []) as any[]) overrides.set(row.user_id, Boolean(row[pref]));
  // Default = true when no row exists
  return new Set(userIds.filter((u) => overrides.get(u) ?? true));
}

export async function notifySymbolEvent(input: {
  symbol: string;
  pref: PrefKey;
  templateName: string;
  idempotencyPrefix: string;
  templateData: Record<string, unknown>;
  label?: string;
  onlyUserId?: string; // if set, restrict to this user (e.g. price alert owner)
}): Promise<{ notified: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const userIds = input.onlyUserId
    ? [input.onlyUserId]
    : await interestedUserIds(input.symbol);
  const allowed = await prefEnabledMap(userIds, input.pref);
  let notified = 0;
  for (const uid of userIds) {
    if (!allowed.has(uid)) continue;
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
      const email = u?.user?.email;
      if (!email) continue;
      const r = await enqueueTransactionalEmail({
        templateName: input.templateName,
        recipientEmail: email,
        idempotencyKey: `${input.idempotencyPrefix}:${uid}`,
        label: input.label ?? input.templateName,
        templateData: input.templateData,
      });
      if (r.sent) notified += 1;
    } catch (err) {
      console.error("[notify] enqueue failed", { uid, err });
    }
  }
  return { notified };
}