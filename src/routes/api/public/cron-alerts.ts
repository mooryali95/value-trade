import { createFileRoute } from "@tanstack/react-router";
import { cronSignature, isFreshCronTimestamp } from "@/lib/ops/cron-signature";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit.server";
import { bearerToken, safeEqualSecret as safeEqual } from "@/lib/ops/timing-safe.server";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/**
 * Real market prices for the given symbols: the last trade price from
 * public.trades (latest by time), for instruments listed on the market
 * (brands.published) only. An instrument that is not listed, or has not
 * traded yet, has no market price: its alerts stay pending (a reference
 * price is not a traded price and never fires an alert).
 */
async function currentPrices(supabaseAdmin: Admin, symbols: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (symbols.length === 0) return prices;

  const { data: listed, error: listedError } = await supabaseAdmin
    .from("brands")
    .select("symbol")
    .eq("published", true)
    .in("symbol", symbols);
  if (listedError) {
    console.error("[cron-alerts] listed instruments lookup failed", { code: listedError.code });
    return prices;
  }

  const lastTrades = await Promise.all(
    (listed ?? []).map(async ({ symbol }) => {
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
  return prices;
}

/** Alerts read per request, in id order (below the API's max_rows). */
const ALERT_PAGE = 500;
/** Hard stop for one run (ALERT_PAGE x MAX_ALERT_PAGES alerts). */
const MAX_ALERT_PAGES = 200;

// Public endpoint intended to be called by pg_cron or an external scheduler.
// Accepts either a timestamped HMAC signature (CRON_ALERTS_SECRET, see
// cronSignature) or a service-role bearer token (used by the in-database
// pg_cron schedule), then scans every active price_alert, page by page,
// against the last traded price of listed instruments and marks any that
// fire.
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
        const timestamp = (request.headers.get("x-timestamp") ?? "").trim();
        const bearer = bearerToken(request.headers.get("authorization"));
        const body = await request.text();
        const hmacOk =
          !!secret &&
          signature.length > 0 &&
          isFreshCronTimestamp(timestamp) &&
          safeEqual(signature, cronSignature(secret, timestamp, body));
        const bearerOk = !!serviceKey && bearer.length > 0 && safeEqual(bearer, serviceKey);
        if (!hmacOk && !bearerOk) {
          return new Response("Invalid signature", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { notifySymbolEvent } = await import("@/lib/notifications/notify.server");
        const { logOpsRun } = await import("@/lib/ops/run-log.server");
        const { canonicalOrigin } = await import("@/lib/ops/origin.server");
        type Alert = { id: string; user_id: string; symbol: string; direction: string; target_price: number };
        const priceBySymbol = new Map<string, number>();
        const priced = new Set<string>();
        let scanned = 0;
        let triggered = 0;
        let emailed = 0;
        let after: string | null = null;
        for (let page = 0; page < MAX_ALERT_PAGES; page++) {
          let query = supabaseAdmin
            .from("price_alerts")
            .select("id, user_id, symbol, direction, target_price")
            .eq("active", true);
          if (after) query = query.gt("id", after);
          const { data: alertRows, error: alertsError } = await query.order("id", { ascending: true }).limit(ALERT_PAGE);
          if (alertsError) {
            console.error("[cron-alerts] alert scan failed", { code: alertsError.code });
            await logOpsRun({
              job: "cron-alerts",
              status: "fail",
              detail: "alert scan failed",
              metrics: { scanned, triggered, emailed, auth: bearerOk ? "bearer" : "hmac" },
              durationMs: Date.now() - startedAt,
            });
            return new Response(JSON.stringify({ error: "INTERNAL_ERROR" }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          }
          const alerts = (alertRows ?? []) as Alert[];
          scanned += alerts.length;

          // Prices of the symbols not looked up yet in this run.
          const unpriced = Array.from(new Set(alerts.map((a) => a.symbol))).filter((sym) => !priced.has(sym));
          for (const sym of unpriced) priced.add(sym);
          for (const [sym, price] of await currentPrices(supabaseAdmin, unpriced)) priceBySymbol.set(sym, price);

          for (const a of alerts) {
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
                  // No currency: the platform names none (see the legal pages).
                  currency: "",
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
          if (alerts.length < ALERT_PAGE) break;
          after = alerts[alerts.length - 1].id;
        }

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