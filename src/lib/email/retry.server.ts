// Server-only: retry wrapper around the transactional email enqueue path.
// Failed sends are retried with exponential backoff (plus jitter) up to a
// bounded number of attempts; the final reason is recorded in ops_run_log.
import { enqueueTransactionalEmail, type EnqueueResult } from "@/lib/email/enqueue.server";
import { logOpsRun } from "@/lib/ops/run-log.server";

export type RetryOptions = {
  /** Total attempts including the first one. Default 3, max 6. */
  attempts?: number;
  /** Base backoff in ms; attempt n waits base * 2^(n-1). Default 400ms. */
  baseDelayMs?: number;
  /** Job name used for the ops_run_log entry. */
  job?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendTransactionalWithRetry(
  input: Parameters<typeof enqueueTransactionalEmail>[0],
  options: RetryOptions = {},
): Promise<EnqueueResult & { attempts: number }> {
  const attempts = Math.min(Math.max(options.attempts ?? 3, 1), 6);
  const base = options.baseDelayMs ?? 400;
  let last: EnqueueResult = { sent: false, reason: "error", detail: "not attempted" };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      last = await enqueueTransactionalEmail(input);
    } catch (err) {
      last = { sent: false, reason: "error", detail: err instanceof Error ? err.message : String(err) };
    }
    if (last.sent) {
      if (attempt > 1) {
        await logOpsRun({
          job: options.job ?? "email-retry",
          status: "warn",
          detail: `${input.templateName} → ${input.recipientEmail} succeeded on attempt ${attempt}`,
          metrics: { template: input.templateName, attempts: attempt, outcome: "sent" },
        });
      }
      return { ...last, attempts: attempt };
    }
    // Permanent outcomes must not be retried.
    if (last.reason === "suppressed" || last.reason === "template_not_found") break;
    if (attempt < attempts) await sleep(base * 2 ** (attempt - 1) + Math.floor(Math.random() * 120));
  }

  await logOpsRun({
    job: options.job ?? "email-retry",
    status: last.reason === "suppressed" ? "warn" : "fail",
    detail: `${input.templateName} → ${input.recipientEmail} gave up after ${attempts}: ${last.reason}${
      last.detail ? ` (${last.detail})` : ""
    }`,
    metrics: {
      template: input.templateName,
      attempts,
      outcome: last.reason,
      detail: last.detail ?? null,
    },
  });

  return { ...last, attempts };
}
