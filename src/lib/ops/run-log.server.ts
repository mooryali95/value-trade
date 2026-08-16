// Server-only: append a row to public.ops_run_log. Never throws — observability
// must not be able to fail the job it is observing.
export type RunStatus = "ok" | "warn" | "fail";

export async function logOpsRun(input: {
  job: string;
  status: RunStatus;
  detail?: string;
  metrics?: Record<string, unknown>;
  durationMs?: number;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("ops_run_log").insert({
      job: input.job,
      status: input.status,
      detail: input.detail ?? null,
      metrics: (input.metrics ?? {}) as never,
      duration_ms: input.durationMs ?? null,
    } as never);
  } catch (err) {
    console.warn("[ops-run-log] insert failed", err);
  }
}