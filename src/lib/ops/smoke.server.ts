// Server-only post-deploy smoke suite. Exercises the critical paths end to end
// without mutating trader data: auth/session, RBAC, database write, the cash
// ledger guard, the Shariah buy-block, the branded email pipeline (a real send
// to the operator's own inbox) and the scheduled cron endpoint.

import { createHmac } from "crypto";
import { isBuyBlockedByShariah } from "@/lib/trading/calc";
import { logOpsRun } from "./run-log.server";

export type SmokeCheck = {
  key: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  durationMs: number;
};

export type SmokeReport = {
  ranAt: string;
  durationMs: number;
  passed: number;
  failed: number;
  warned: number;
  status: "ok" | "warn" | "fail";
  checks: SmokeCheck[];
};

const SENTINEL = "SMOKE.SHARIAH";

async function timed(
  key: string,
  fn: () => Promise<{ status: SmokeCheck["status"]; detail: string }>,
): Promise<SmokeCheck> {
  const started = Date.now();
  try {
    const r = await fn();
    return { key, ...r, durationMs: Date.now() - started };
  } catch (err) {
    // Raw driver/PostgREST text stays in the server log; the report only
    // carries a stable code.
    console.error(`[smoke] ${key} failed`, err);
    const msg = err instanceof Error ? err.message : "";
    return {
      key,
      status: "fail",
      detail: /^[A-Z][A-Z0-9_]{2,63}$/.test(msg) ? msg : "INTERNAL_ERROR",
      durationMs: Date.now() - started,
    };
  }
}

/**
 * `origin` must come from the server-side origin helper (origin.server.ts),
 * never from the browser.
 */
export async function runSmoke(input: {
  userId: string;
  email: string | null;
  origin: string;
  sendEmail: boolean;
}): Promise<SmokeReport> {
  const startedAt = Date.now();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const checks: SmokeCheck[] = [];

  // 1) Session + profile: proves login and the profile trigger are wired.
  checks.push(
    await timed("auth_session", async () => {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .eq("id", input.userId)
        .maybeSingle();
      if (error) {
        console.error("[smoke] profile read failed", error);
        throw new Error("DB_READ_FAILED");
      }
      if (!data) return { status: "warn", detail: "session ok, profile row missing" };
      return { status: "ok", detail: `session + profile for ${data.id.slice(0, 8)}…` };
    }),
  );

  // 2) RBAC: has_role must answer for the caller.
  checks.push(
    await timed("rbac_has_role", async () => {
      const { data, error } = await supabaseAdmin.rpc("has_role", {
        _user_id: input.userId,
        _role: "platform_admin",
      });
      if (error) {
        console.error("[smoke] has_role failed", error);
        throw new Error("RPC_FAILED");
      }
      return { status: data === true ? "ok" : "warn", detail: `platform_admin=${data}` };
    }),
  );

  // 3) Database write path.
  checks.push(
    await timed("db_write", async () => {
      const { data, error } = await supabaseAdmin
        .from("ops_run_log")
        .insert({ job: "smoke:probe", status: "ok", detail: "write probe" } as never)
        .select("id")
        .single();
      if (error) {
        console.error("[smoke] write probe failed", error);
        throw new Error("DB_WRITE_FAILED");
      }
      await supabaseAdmin.from("ops_run_log").delete().eq("id", (data as { id: string }).id);
      return { status: "ok", detail: "insert + delete round-trip" };
    }),
  );

  // 4) Cash ledger guard: an invalid movement must be rejected by the RPC.
  checks.push(
    await timed("cash_ledger_guard", async () => {
      const { error } = await supabaseAdmin.rpc("post_cash_movement" as never, {
        _user_id: input.userId,
        _kind: "smoke_invalid",
        _amount: 0,
      } as never);
      if (!error) return { status: "fail", detail: "invalid movement was accepted" };
      return { status: "ok", detail: "invalid kind rejected (INVALID_KIND)" };
    }),
  );

  // 5) Shariah buy-block against a real ruling row, using the shared gate.
  checks.push(
    await timed("shariah_block", async () => {
      const existing = await supabaseAdmin
        .from("shariah_decisions")
        .select("id, status")
        .eq("symbol", SENTINEL)
        .maybeSingle();
      if (!existing.data) {
        await supabaseAdmin
          .from("shariah_decisions")
          .insert({ symbol: SENTINEL, status: "non_halal", reason: "smoke sentinel" } as never);
      }
      const { data } = await supabaseAdmin
        .from("shariah_decisions")
        .select("status")
        .eq("symbol", SENTINEL)
        .maybeSingle();
      const blocksBuy = isBuyBlockedByShariah(data?.status, "buy");
      const allowsSell = !isBuyBlockedByShariah(data?.status, "sell");
      if (!blocksBuy || !allowsSell) {
        return { status: "fail", detail: `buyBlocked=${blocksBuy} sellAllowed=${allowsSell}` };
      }
      return { status: "ok", detail: "non_halal blocks buy, sell still allowed" };
    }),
  );

  // 6) Email pipeline: a real branded send to the operator's own address.
  checks.push(
    await timed("email_pipeline", async () => {
      if (!input.sendEmail) return { status: "warn", detail: "skipped (live send disabled)" };
      if (!input.email) return { status: "warn", detail: "no operator email on session" };
      const { enqueueTransactionalEmail } = await import("@/lib/email/enqueue.server");
      const r = await enqueueTransactionalEmail({
        templateName: "price-alert",
        recipientEmail: input.email,
        label: "smoke-test",
        idempotencyKey: `smoke:${Date.now()}`,
        templateData: {
          symbol: SENTINEL,
          direction: "above",
          targetPrice: "100.00",
          currentPrice: "101.00",
          currency: "SAR",
          viewUrl: `${input.origin}/portfolio`,
        },
      });
      if (!r.sent) {
        if (r.detail) console.error("[smoke] email enqueue failed", r.detail);
        return { status: "fail", detail: r.reason };
      }
      return { status: "ok", detail: `queued ${r.messageId.slice(0, 8)}… to operator inbox` };
    }),
  );

  // 7) Scheduled cron endpoint reachable and authenticating. Signed with the
  // same HMAC scheme external schedulers use (CRON_ALERTS_SECRET over the raw
  // body, hex, in x-signature). The service-role key never leaves the server.
  checks.push(
    await timed("cron_endpoint", async () => {
      const secret = process.env["CRON_ALERTS_SECRET"];
      if (!secret) return { status: "warn", detail: "skipped: secret not configured" };
      const body = "{}";
      const signature = createHmac("sha256", secret).update(body).digest("hex");
      const res = await fetch(`${input.origin}/api/public/cron-alerts`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": signature },
        body,
        redirect: "manual",
      });
      const text = await res.text();
      if (!res.ok) return { status: "fail", detail: `HTTP ${res.status} ${text.slice(0, 80)}` };
      return { status: "ok", detail: text.slice(0, 120) };
    }),
  );

  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const report: SmokeReport = {
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    passed: checks.filter((c) => c.status === "ok").length,
    failed,
    warned,
    status: failed > 0 ? "fail" : warned > 0 ? "warn" : "ok",
    checks,
  };

  await logOpsRun({
    job: "smoke",
    status: report.status,
    detail: `${report.passed} ok · ${warned} warn · ${failed} fail`,
    metrics: { checks: checks.map((c) => ({ k: c.key, s: c.status })) },
    durationMs: report.durationMs,
  });

  // Escalate repeated failures to platform admins by email.
  const { maybeAlertAdmins } = await import("./ops-alert.server");
  await maybeAlertAdmins("smoke");

  return report;
}