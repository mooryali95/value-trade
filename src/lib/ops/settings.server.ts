// Server-only: operational thresholds, editable from /admin/ops without a deploy.
import { logOpsRun } from "./run-log.server";

export type OpsSettings = {
  smokeFailThreshold: number;
  cronLatencyBudgetMs: number;
  alertMaxPerWindow: number;
  alertWindowMinutes: number;
  emailRetryAttempts: number;
  updatedAt: string | null;
};

export const OPS_SETTINGS_DEFAULTS: OpsSettings = {
  smokeFailThreshold: 2,
  cronLatencyBudgetMs: 15_000,
  alertMaxPerWindow: 2,
  alertWindowMinutes: 60,
  emailRetryAttempts: 3,
  updatedAt: null,
};

/** Reads the single settings row; falls back to defaults on any failure. */
export async function getOpsSettings(): Promise<OpsSettings> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ops_settings")
      .select(
        "smoke_fail_threshold, cron_latency_budget_ms, alert_max_per_window, alert_window_minutes, email_retry_attempts, updated_at",
      )
      .eq("id", 1)
      .maybeSingle();
    if (!data) return OPS_SETTINGS_DEFAULTS;
    return {
      smokeFailThreshold: data.smoke_fail_threshold,
      cronLatencyBudgetMs: data.cron_latency_budget_ms,
      alertMaxPerWindow: data.alert_max_per_window,
      alertWindowMinutes: data.alert_window_minutes,
      emailRetryAttempts: data.email_retry_attempts,
      updatedAt: data.updated_at,
    };
  } catch {
    return OPS_SETTINGS_DEFAULTS;
  }
}

/** Persists new thresholds and records the change in ops_run_log. */
export async function saveOpsSettings(
  patch: Partial<Omit<OpsSettings, "updatedAt">>,
  actorId: string,
): Promise<OpsSettings> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const row: Record<string, unknown> = { id: 1, updated_by: actorId };
  if (patch.smokeFailThreshold !== undefined) row['smoke_fail_threshold'] = patch.smokeFailThreshold;
  if (patch.cronLatencyBudgetMs !== undefined) row['cron_latency_budget_ms'] = patch.cronLatencyBudgetMs;
  if (patch.alertMaxPerWindow !== undefined) row['alert_max_per_window'] = patch.alertMaxPerWindow;
  if (patch.alertWindowMinutes !== undefined) row['alert_window_minutes'] = patch.alertWindowMinutes;
  if (patch.emailRetryAttempts !== undefined) row['email_retry_attempts'] = patch.emailRetryAttempts;

  const { error } = await supabaseAdmin.from("ops_settings").upsert(row as never, { onConflict: "id" });
  if (error) {
    console.error("[ops-settings] save failed", error);
    throw new Error("INTERNAL_ERROR");
  }

  await logOpsRun({
    job: "ops-settings",
    status: "ok",
    detail: `thresholds updated by ${actorId}`,
    metrics: { ...patch, actor: actorId },
  });
  return getOpsSettings();
}
