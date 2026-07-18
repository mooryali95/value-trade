import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { BRANDS } from "@/lib/mock-data";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit.server";

// Public endpoint intended to be called by pg_cron or an external scheduler.
// Verifies an HMAC signature over the request body, then scans active
// price_alerts against the latest mock quote and marks any that fire.
export const Route = createFileRoute("/api/public/cron-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CRON_ALERTS_SECRET;
        if (!secret) return new Response("Not configured", { status: 503 });

        // 30 requests / minute per source IP. pg_cron hits this at most once/min.
        const ok = await checkRateLimit(clientKeyFromRequest(request, "cron-alerts"), 30, 60);
        if (!ok) return new Response("Rate limit exceeded", { status: 429 });

        const signature = request.headers.get("x-signature") ?? "";
        const body = await request.text();
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const sig = Buffer.from(signature);
        const exp = Buffer.from(expected);
        if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
          return new Response("Invalid signature", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: alerts } = await supabaseAdmin
          .from("price_alerts")
          .select("id, symbol, direction, target_price")
          .eq("active", true);

        const priceBySymbol = new Map(BRANDS.map((b) => [b.symbol, b.price] as const));
        let triggered = 0;
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
        }

        return new Response(JSON.stringify({ scanned: alerts?.length ?? 0, triggered }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});