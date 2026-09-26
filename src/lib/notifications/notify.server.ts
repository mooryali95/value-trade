// Server-only: unified notifier for symbol-related events. Notifies:
//   - price alert owner (price_alerts.user_id)
//   - explicit watchers (symbol_watchers)
//   - position holders (positions)
// Honors notification_preferences per user.
//
// Only instruments listed on the market (brands.published) notify anyone:
// the ruling, price or position news of an unlisted (pre-listing or
// delisted) instrument is not public, and watch lists and alerts are
// self-service, so they must never become a way to receive it.

import { sendTransactionalWithRetry } from "@/lib/email/retry.server";

type PrefKey = "price_alerts_email" | "shariah_decisions_email" | "position_updates_email";

type Audience = "all" | "positions";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/** Rows per request (below the API's max_rows) and a hard stop per table. */
const PAGE = 500;
const MAX_PAGES = 200;

/** Symbols are stored upper-case (the database normalises them). */
export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** True only for an instrument that exists and is listed on the market. */
async function isListed(supabaseAdmin: Admin, symbol: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("brands")
    .select("symbol")
    .eq("symbol", symbol)
    .eq("published", true)
    .maybeSingle();
  if (error) {
    console.error("[notify] listing lookup failed", error.code ?? "unknown");
    return false;
  }
  return !!data;
}

/** Every user_id with a row for the symbol, paged by id (no silent truncation). */
async function userIdsOf(
  supabaseAdmin: Admin,
  table: "positions" | "symbol_watchers" | "price_alerts",
  symbol: string,
): Promise<string[]> {
  const out: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabaseAdmin.from(table).select("id, user_id").eq("symbol", symbol);
    if (table === "positions") q = q.gt("qty", 0);
    if (after) q = q.gt("id", after);
    const { data, error } = await q.order("id", { ascending: true }).limit(PAGE);
    if (error) {
      console.error("[notify] recipient lookup failed", table, error.code ?? "unknown");
      break;
    }
    const rows = (data ?? []) as Array<{ id: string; user_id: string | null }>;
    for (const r of rows) if (r?.user_id) out.push(r.user_id);
    if (rows.length < PAGE) break;
    after = rows[rows.length - 1].id;
  }
  return out;
}

async function interestedUserIds(supabaseAdmin: Admin, symbol: string, audience: Audience = "all"): Promise<string[]> {
  const tables = audience === "positions"
    ? (["positions"] as const)
    : (["symbol_watchers", "positions", "price_alerts"] as const);
  const lists = await Promise.all(tables.map((t) => userIdsOf(supabaseAdmin, t, symbol)));
  return Array.from(new Set(lists.flat()));
}

async function prefEnabledMap(userIds: string[], pref: PrefKey): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const overrides = new Map<string, boolean>();
  // In chunks: a long id list would exceed the URL and row limits.
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await supabaseAdmin
      .from("notification_preferences")
      .select(`user_id, ${pref}`)
      .in("user_id", userIds.slice(i, i + 200));
    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      overrides.set(String(row.user_id), Boolean(row[pref]));
    }
  }
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
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol || !(await isListed(supabaseAdmin, symbol))) return { notified: 0 };
  const userIds = input.onlyUserId
    ? [input.onlyUserId]
    : await interestedUserIds(supabaseAdmin, symbol, input.audience ?? "all");
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