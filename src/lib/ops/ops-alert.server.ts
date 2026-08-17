// Server-only: escalates operational problems to platform admins by email.
// Triggers when the smoke suite fails repeatedly, or when the alerts cron
// exceeds a latency budget. Every send is retried with backoff and logged.
import { sendTransactionalWithRetry } from "@/lib/email/retry.server";
import { logOpsRun } from "./run-log.server";

/** Consecutive smoke failures required before admins are emailed. */
export const SMOKE_FAIL_THRESHOLD = 2;
/** Cron duration budget in ms; above this admins are warned. */
export const CRON_LATENCY_BUDGET_MS = 15_000;

const APP_ORIGIN = "https://hub.sunkvalue.com";

async function adminEmails(): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "platform_admin");
  const emails: string[] = [];
  for (const r of roles ?? []) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(r.user_id as string);
      const email = data?.user?.email;
      if (email) emails.push(email);
    } catch {
      // ignore individual lookup failures
    }
  }
  return Array.from(new Set(emails));
}

async function notifyAdmins(input: {
  job: string;
  severity: "fail" | "warn";
  headline: string;
  detail: string;
  metricLabel: string;
  metricValue: string;
  idempotencyKey: string;
}): Promise<number> {
  const recipients = await adminEmails();
  let sent = 0;
  for (const email of recipients) {
    const r = await sendTransactionalWithRetry(
      {
        templateName: "ops-alert",
        recipientEmail: email,
        label: "ops-alert",
        idempotencyKey: `${input.idempotencyKey}:${email}`,
        templateData: {
          job: input.job,
          severity: input.severity,
          headline: input.headline,
          detail: input.detail,
          metricLabel: input.metricLabel,
          metricValue: input.metricValue,
          viewUrl: `${APP_ORIGIN}/admin/ops`,
        },
      },
      { job: "ops-alert-email", attempts: 4 },
    );
    if (r.sent) sent += 1;
  }
  return sent;
}

/**
 * Inspect the latest ops_run_log rows for the given job and escalate when the
 * repeat-failure or latency thresholds are crossed. Never throws.
 */
export async function maybeAlertAdmins(job: "smoke" | "cron-alerts"): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: runs } = await supabaseAdmin
      .from("ops_run_log")
      .select("id, job, status, detail, duration_ms, created_at")
      .eq("job", job)
      .order("created_at", { ascending: false })
      .limit(SMOKE_FAIL_THRESHOLD);

    const list = runs ?? [];
    if (list.length === 0) return;
    const newest = list[0]!;

    if (job === "smoke") {
      const consecutive = list.filter((r) => r.status === "fail").length;
      if (list.length < SMOKE_FAIL_THRESHOLD || consecutive < SMOKE_FAIL_THRESHOLD) return;
      const sent = await notifyAdmins({
        job,
        severity: "fail",
        headline: "فشل متكرر في اختبار الدخان بعد النشر",
        detail: newest.detail ?? "—",
        metricLabel: "فشل متتالٍ",
        metricValue: String(consecutive),
        idempotencyKey: `ops-alert:smoke:${newest.id}`,
      });
      await logOpsRun({
        job: "ops-alert",
        status: "warn",
        detail: `smoke failed ${consecutive}× consecutively · notified ${sent} admin(s)`,
        metrics: { trigger: "smoke_repeat_fail", consecutive, notified: sent },
      });
      return;
    }

    const duration = newest.duration_ms ?? 0;
    if (newest.status !== "fail" && duration <= CRON_LATENCY_BUDGET_MS) return;
    const sent = await notifyAdmins({
      job,
      severity: newest.status === "fail" ? "fail" : "warn",
      headline:
        newest.status === "fail"
          ? "فشل فحص التنبيهات السعرية المجدول"
          : "تجاوز زمن استجابة الـ Cron الحد المسموح",
      detail: newest.detail ?? "—",
      metricLabel: "زمن التنفيذ",
      metricValue: `${duration} ms (budget ${CRON_LATENCY_BUDGET_MS} ms)`,
      idempotencyKey: `ops-alert:cron:${newest.id}`,
    });
    await logOpsRun({
      job: "ops-alert",
      status: newest.status === "fail" ? "fail" : "warn",
      detail: `cron ${newest.status} · ${duration} ms · notified ${sent} admin(s)`,
      metrics: { trigger: "cron_latency", durationMs: duration, notified: sent },
    });
  } catch (err) {
    console.warn("[ops-alert] escalation failed", err);
  }
}
