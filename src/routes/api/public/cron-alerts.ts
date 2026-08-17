import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { BRANDS } from "@/lib/mock-data";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit.server";

/** Constant-time string compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Public endpoint intended to be called by pg_cron or an external scheduler.
// Accepts either an HMAC signature over the raw body (CRON_ALERTS_SECRET) or a
// service-role bearer token (used by the in-database pg_cron schedule), then
// scans active price_alerts against the latest quote and marks any that fire.
export const Route = createFileRoute("/api/public/cron-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const secret = process.env.CRON_ALERTS_SECRET;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!secret && !serviceKey) return new Response("Not configured", { status: 503 });

        // 30 requests / minute per source IP. pg_cron hits this at most once/min.
        const ok = await checkRateLimit(clientKeyFromRequest(request, "cron-alerts"), 30, 60);
        if (!ok) return new Response("Rate limit exceeded", { status: 429 });

        const signature = request.headers.get("x-signature") ?? "";
        const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        const body = await request.text();
        const hmacOk =
          !!secret &&
          signature.length > 0 &&
          safeEqual(signature, createHmac("sha256", secret).update(body).digest("hex"));
        const bearerOk = !!serviceKey && bearer.length > 0 && safeEqual(bearer, serviceKey);
        if (!hmacOk && !bearerOk) {
          return new Response("Invalid signature", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { notifySymbolEvent } = await import("@/lib/notifications/notify.server");
        const { logOpsRun } = await import("@/lib/ops/run-log.server");
        const { data: alerts } = await supabaseAdmin
          .from("price_alerts")
          .select("id, user_id, symbol, direction, target_price")
          .eq("active", true);

        const priceBySymbol = new Map(BRANDS.map((b) => [b.symbol, b.price] as const));
        let triggered = 0;
        let emailed = 0;
        for (const a of alerts ?? []) {
          const p = priceBySymbol.get(a.symbol);
          if (p === undefined) continue;
          const target = Number(a.target_price);
          const fires = a.direction === "above" ? p >= target : p <= target;
          if (!fires) continue;
          await supabaseAdmin
            .from("price_alerts")
            .update({ active: false, triggered_at: new Date().toISOString() })
            .eq("id", a.id);
          triggered += 1;
          try {
            const r = await notifySymbolEvent({
              symbol: a.symbol,
              pref: "price_alerts_email",
              templateName: "price-alert",
              idempotencyPrefix: `price-alert:${a.id}`,
              label: "price-alert",
              onlyUserId: a.user_id, // alert-owner only; watchers/positions get shariah/other events
              templateData: {
                symbol: a.symbol,
                direction: a.direction,
                targetPrice: target.toFixed(2),
                currentPrice: p.toFixed(2),
                currency: "SAR",
                viewUrl: "https://hub.sunkvalue.com/portfolio",
              },
            });
            emailed += r.notified;
          } catch (err) {
            console.error("[cron-alerts] email enqueue failed", { alertId: a.id, err });
          }
        }

        const scanned = alerts?.length ?? 0;
        await logOpsRun({
          job: "cron-alerts",
          status: "ok",
          detail: `scanned ${scanned} · triggered ${triggered} · emailed ${emailed}`,
          metrics: { scanned, triggered, emailed, auth: bearerOk ? "bearer" : "hmac" },
          durationMs: Date.now() - startedAt,
        });
        const { maybeAlertAdmins } = await import("@/lib/ops/ops-alert.server");
        await maybeAlertAdmins("cron-alerts");

        return new Response(JSON.stringify({ scanned, triggered, emailed }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});