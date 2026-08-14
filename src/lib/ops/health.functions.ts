import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type HealthCheck = {
  key: string;
  status: "ok" | "warn" | "fail";
  latencyMs: number;
  detail: string;
};

/**
 * Operational health for platform admins: reachability + latency per critical
 * table, email delivery failures, and the freshness of the alerts cron.
 */
export const getPlatformHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "platform_admin",
    });
    if (!isAdmin) throw new Error("FORBIDDEN_ADMIN_REQUIRED");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tables = [
      "companies",
      "company_members",
      "product_submissions",
      "orders",
      "positions",
      "cash_ledger",
      "shariah_decisions",
      "price_alerts",
      "email_send_log",
    ] as const;

    const checks: HealthCheck[] = [];
    let rowsTotal = 0;

    for (const table of tables) {
      const started = Date.now();
      const { count, error } = await supabaseAdmin
        .from(table)
        .select("*", { count: "exact", head: true });
      const latencyMs = Date.now() - started;
      rowsTotal += count ?? 0;
      checks.push({
        key: table,
        status: error ? "fail" : latencyMs > 1500 ? "warn" : "ok",
        latencyMs,
        detail: error ? error.message : `${count ?? 0}`,
      });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [failed, sent, alerts, triggered] = await Promise.all([
      supabaseAdmin
        .from("email_send_log")
        .select("*", { count: "exact", head: true })
        .eq("status", "failed")
        .gte("created_at", since),
      supabaseAdmin
        .from("email_send_log")
        .select("*", { count: "exact", head: true })
        .eq("status", "sent")
        .gte("created_at", since),
      supabaseAdmin.from("price_alerts").select("*", { count: "exact", head: true }).eq("active", true),
      supabaseAdmin
        .from("price_alerts")
        .select("triggered_at")
        .not("triggered_at", "is", null)
        .order("triggered_at", { ascending: false })
        .limit(1),
    ]);

    const failedCount = failed.count ?? 0;
    const sentCount = sent.count ?? 0;
    const lastTriggered = triggered.data?.[0]?.triggered_at ?? null;

    return {
      checkedAt: new Date().toISOString(),
      checks,
      rowsTotal,
      slowest: checks.reduce((a, b) => (b.latencyMs > a.latencyMs ? b : a), checks[0]!),
      email: {
        sent24h: sentCount,
        failed24h: failedCount,
        status: failedCount === 0 ? "ok" : failedCount > 5 ? "fail" : "warn",
      },
      alerts: { active: alerts.count ?? 0, lastTriggeredAt: lastTriggered },
    };
  });
