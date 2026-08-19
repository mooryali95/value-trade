import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const OriginSchema = z.object({
  origin: z
    .string()
    .url()
    .refine(
      (v) =>
        /^https:\/\/[a-z0-9.-]+\.lovable\.app$/.test(v) ||
        /^https:\/\/([a-z0-9-]+\.)*sunkvalue\.com$/.test(v) ||
        /^http:\/\/localhost:\d+$/.test(v),
      "ORIGIN_NOT_ALLOWED",
    ),
  sendEmail: z.boolean().default(true),
});

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "platform_admin",
  });
  if (!isAdmin) throw new Error("FORBIDDEN_ADMIN_REQUIRED");
}

/** Runs the post-deploy smoke suite and returns a pass/fail report. */
export const runSmokeSuite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => OriginSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { runSmoke } = await import("./smoke.server");
    const email = (context.claims as { email?: string } | null)?.email ?? null;
    return runSmoke({
      userId: context.userId,
      email,
      origin: data.origin,
      sendEmail: data.sendEmail,
    });
  });

/** Last runs of every operational job (cron scan + smoke suite). */
export const getOpsRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: runs } = await supabaseAdmin
      .from("ops_run_log")
      .select("id, job, status, detail, metrics, duration_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    const list = runs ?? [];
    const latest = (job: string) => list.find((r) => r.job === job) ?? null;
    const { count: activeAlerts } = await supabaseAdmin
      .from("price_alerts")
      .select("*", { count: "exact", head: true })
      .eq("active", true);

    return {
      checkedAt: new Date().toISOString(),
      runs: list,
      lastCron: latest("cron-alerts"),
      lastSmoke: latest("smoke"),
      activeAlerts: activeAlerts ?? 0,
    };
  });

const RunsQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  job: z.string().optional(),
  status: z.enum(["all", "ok", "warn", "fail"]).default("all"),
  limit: z.number().int().min(1).max(2000).default(500),
});

/** Filtered ops_run_log rows plus KPIs and a 7-day daily series. */
export const listOpsRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunsQuery.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("ops_run_log")
      .select("id, job, status, detail, metrics, duration_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.from) q = q.gte("created_at", new Date(data.from).toISOString());
    if (data.to) q = q.lte("created_at", new Date(data.to).toISOString());
    if (data.job) q = q.eq("job", data.job);
    if (data.status !== "all") q = q.eq("status", data.status);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const items = rows ?? [];

    const durations = items
      .map((r) => r.duration_ms ?? 0)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const p = (frac: number) =>
      durations.length === 0 ? 0 : durations[Math.min(durations.length - 1, Math.floor(durations.length * frac))]!;
    const ok = items.filter((r) => r.status === "ok").length;
    const warn = items.filter((r) => r.status === "warn").length;
    const fail = items.filter((r) => r.status === "fail").length;

    const num = (m: unknown, key: string) => {
      const v = (m as Record<string, unknown> | null)?.[key];
      return typeof v === "number" ? v : 0;
    };
    const alertsAffected = items.reduce(
      (sum, r) => sum + num(r.metrics, "triggered") + num(r.metrics, "emailed"),
      0,
    );

    // 7-day daily buckets (UTC), oldest first.
    const days: { day: string; total: number; ok: number; fail: number; avgMs: number }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 86_400_000);
      const day = d.toISOString().slice(0, 10);
      const dayRows = items.filter((r) => (r.created_at ?? "").slice(0, 10) === day);
      const dayDur = dayRows.map((r) => r.duration_ms ?? 0).filter((n) => n > 0);
      days.push({
        day,
        total: dayRows.length,
        ok: dayRows.filter((r) => r.status === "ok").length,
        fail: dayRows.filter((r) => r.status === "fail").length,
        avgMs: dayDur.length ? Math.round(dayDur.reduce((a, b) => a + b, 0) / dayDur.length) : 0,
      });
    }

    const jobsRes = await supabaseAdmin.from("ops_run_log").select("job").limit(2000);
    const jobs = Array.from(new Set((jobsRes.data ?? []).map((r) => r.job as string))).sort();

    return {
      items,
      jobs,
      kpis: {
        total: items.length,
        ok,
        warn,
        fail,
        successRate: items.length ? Math.round((ok / items.length) * 100) : 0,
        avgMs: durations.length
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0,
        p95Ms: p(0.95),
        maxMs: durations.length ? durations[durations.length - 1]! : 0,
        alertsAffected,
      },
      days,
    };
  });
/** Full detail for a single ops_run_log row, plus its nearest siblings. */
export const getOpsRunDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: run, error } = await supabaseAdmin
      .from("ops_run_log")
      .select("id, job, status, detail, metrics, duration_ms, created_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run) throw new Error("RUN_NOT_FOUND");

    const { data: siblings } = await supabaseAdmin
      .from("ops_run_log")
      .select("id, status, created_at")
      .eq("job", run.job)
      .order("created_at", { ascending: false })
      .limit(10);

    const m = (run.metrics ?? {}) as Record<string, unknown>;
    const rawChecks = Array.isArray(m['checks']) ? (m['checks'] as Record<string, unknown>[]) : [];
    const steps = rawChecks.map((c, i) => ({
      index: i + 1,
      key: String(c['k'] ?? c['key'] ?? `step-${i + 1}`),
      status: String(c['s'] ?? c['status'] ?? "ok"),
      detail: c['detail'] ? String(c['detail']) : null,
      durationMs: typeof c['durationMs'] === "number" ? (c['durationMs'] as number) : null,
    }));
    const metricEntries = Object.entries(m)
      .filter(([k]) => k !== "checks")
      .map(([key, value]) => ({
        key,
        value: typeof value === "object" && value !== null ? JSON.stringify(value) : String(value),
      }));

    return { run, steps, metricEntries, siblings: siblings ?? [] };
  });

/** Current editable operational thresholds. */
export const getOpsThresholds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as never);
    const { getOpsSettings } = await import("./settings.server");
    return getOpsSettings();
  });

const ThresholdsSchema = z.object({
  smokeFailThreshold: z.number().int().min(1).max(20),
  cronLatencyBudgetMs: z.number().int().min(500).max(600_000),
  alertMaxPerWindow: z.number().int().min(1).max(50),
  alertWindowMinutes: z.number().int().min(1).max(1440),
  emailRetryAttempts: z.number().int().min(1).max(6),
});

/** Updates thresholds without a deploy; the change is logged in ops_run_log. */
export const updateOpsThresholds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ThresholdsSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { saveOpsSettings } = await import("./settings.server");
    return saveOpsSettings(data, context.userId);
  });
