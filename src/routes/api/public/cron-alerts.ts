import { createFileRoute } from "@tanstack/react-router";
import { createHmac } from "crypto";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit.server";
import { bearerToken, safeEqualSecret as safeEqual } from "@/lib/ops/timing-safe.server";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/**
 * Real market prices for the given symbols: the last trade price from
 * public.trades (latest by time), else brands.reference_price. Symbols with
 * neither are omitted (their alerts are skipped this run).
 */
async function currentPrices(supabaseAdmin: Admin, symbols: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (symbols.length === 0) return prices;

  const lastTrades = await Promise.all(
    symbols.map(async (symbol) => {
      const { data, error } = await supabaseAdmin
        .from("trades")
        .select("price")
        .eq("symbol", symbol)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("[cron-alerts] last trade lookup failed", { symbol, code: error.code });
        return [symbol, null] as const;
      }
      return [symbol, data ? Number(data.price) : null] as const;
    }),
  );
  for (const [symbol, price] of lastTrades) {
    if (price !== null && Number.isFinite(price) && price > 0) prices.set(symbol, price);
  }

  const missing = symbols.filter((s) => !prices.has(s));
  if (missing.length > 0) {
    const { data: brands, error } = await supabaseAdmin
      .from("brands")
      .select("symbol, reference_price")
      .in("symbol", missing);
    if (error) {
      console.error("[cron-alerts] reference price lookup failed", { code: error.code });
    }
    for (const b of brands ?? []) {
      const p = Number(b.reference_price);
      if (Number.isFinite(p) && p > 0) prices.set(b.symbol, p);
    }
  }
  return prices;
}

// Public endpoint intended to be called by pg_cron or an external scheduler.
// Accepts either an HMAC signature over the raw body (CRON_ALERTS_SECRET) or a
// service-role bearer token (used by the in-database pg_cron schedule), then
// scans active price_alerts against the latest market price (last trade, else
// the instrument's reference price) and marks any that fire.
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
        const bearer = bearerToken(request.headers.get("authorization"));
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
        const { canonicalOrigin } = await import("@/lib/ops/origin.server");
        const { data: alerts, error: alertsError } = await supabaseAdmin
          .from("price_alerts")
          .select("id, user_id, symbol, direction, target_price")
          .eq("active", true);
        if (alertsError) {
          console.error("[cron-alerts] alert scan failed", { code: alertsError.code });
          await logOpsRun({
            job: "cron-alerts",
            status: "fail",
            detail: "alert scan failed",
            metrics: { auth: bearerOk ? "bearer" : "hmac" },
            durationMs: Date.now() - startedAt,
          });
          return new Response(JSON.stringify({ error: "INTERNAL_ERROR" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const symbols = Array.from(new Set((alerts ?? []).map((a) => a.symbol)));
        const priceBySymbol = await currentPrices(supabaseAdmin, symbols);
        let triggered = 0;
        let emailed = 0;
        for (const a of alerts ?? []) {
          const p = priceBySymbol.get(a.symbol);
          if (p === undefined) continue;
          const target = Number(a.target_price);
          const fires = a.direction === "above" ? p >= target : p <= target;
          if (!fires) continue;
          // Only the run that flips active=true -> false notifies, so two
          // overlapping runs cannot double-send.
          const { data: flipped, error: flipError } = await supabaseAdmin
            .from("price_alerts")
            .update({ active: false, triggered_at: new Date().toISOString() })
            .eq("id", a.id)
            .eq("active", true)
            .select("id");
          if (flipError) {
            console.error("[cron-alerts] alert update failed", { alertId: a.id, code: flipError.code });
            continue;
          }
          if (!flipped || flipped.length === 0) continue;
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
                viewUrl: `${canonicalOrigin()}/portfolio`,
              },
            });
            emailed += r.notified;
          } catch (err) {
            console.error("[cron-alerts] email enqueue failed", {
              alertId: a.id,
              err: err instanceof Error ? err.name : "unknown",
            });
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