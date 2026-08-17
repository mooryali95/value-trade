// Server-only: unified notifier for symbol-related events. Notifies:
//   - price alert owner (price_alerts.user_id)
//   - explicit watchers (symbol_watchers)
//   - position holders (positions)
// Honors notification_preferences per user.

import { sendTransactionalWithRetry } from "@/lib/email/retry.server";

type PrefKey = "price_alerts_email" | "shariah_decisions_email" | "position_updates_email";

type Audience = "all" | "positions";

async function interestedUserIds(symbol: string, audience: Audience = "all"): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (audience === "positions") {
    const { data } = await supabaseAdmin
      .from("positions")
      .select("user_id")
      .eq("symbol", symbol);
    const set = new Set<string>();
    for (const r of data ?? []) if (r?.user_id) set.add(r.user_id as string);
    return Array.from(set);
  }
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
  audience?: Audience; // 'positions' restricts to position holders only
}): Promise<{ notified: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const userIds = input.onlyUserId
    ? [input.onlyUserId]
    : await interestedUserIds(input.symbol, input.audience ?? "all");
  const allowed = await prefEnabledMap(userIds, input.pref);
  let notified = 0;
  for (const uid of userIds) {
    if (!allowed.has(uid)) continue;
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
      const email = u?.user?.email;
      if (!email) continue;
      // Retry with exponential backoff; the give-up reason lands in ops_run_log.
      const r = await sendTransactionalWithRetry(
        {
          templateName: input.templateName,
          recipientEmail: email,
          idempotencyKey: `${input.idempotencyPrefix}:${uid}`,
          label: input.label ?? input.templateName,
          templateData: input.templateData,
        },
        { job: `email-retry:${input.label ?? input.templateName}`, attempts: 3 },
      );
      if (r.sent) notified += 1;
    } catch (err) {
      console.error("[notify] enqueue failed", { uid, err });
    }
  }
  return { notified };
}