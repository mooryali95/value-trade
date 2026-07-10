import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

/**
 * End-to-end integration test for the price-alert flow:
 *   1. A trader places two orders (buy NOOR001 above target, sell MADA002 below target).
 *   2. Matching price alerts are created for the two symbols.
 *   3. The scheduled cron endpoint is invoked with a valid HMAC signature.
 *   4. The alerts whose target is met are marked inactive with a `triggered_at`
 *      timestamp that falls within the invocation window; the third alert stays active.
 *
 * The database and mock-data provider are stubbed so the test is deterministic
 * and does not require network or a real Supabase instance.
 */

vi.mock("@/lib/mock-data", () => ({
  BRANDS: [
    { symbol: "NOOR001", price: 120 },
    { symbol: "MADA002", price: 40 },
  ],
}));

type Order = {
  id: string;
  user_id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  status: string;
  created_at: string;
};
type Alert = {
  id: string;
  user_id: string;
  symbol: string;
  direction: "above" | "below";
  target_price: number;
  active: boolean;
  triggered_at: string | null;
};

const state: { orders: Order[]; alerts: Alert[] } = { orders: [], alerts: [] };

const supabaseAdmin = {
  from(table: "orders" | "price_alerts") {
    return {
      select() {
        return {
          eq(_col: string, val: unknown) {
            const rows = table === "orders"
              ? state.orders
              : state.alerts.filter((a) => a.active === val);
            return Promise.resolve({ data: rows, error: null });
          },
        };
      },
      insert(row: Order | Alert) {
        if (table === "orders") state.orders.push(row as Order);
        else state.alerts.push(row as Alert);
        return Promise.resolve({ data: row, error: null });
      },
      update(patch: Partial<Alert>) {
        return {
          eq(col: string, val: unknown) {
            for (const a of state.alerts) {
              if ((a as unknown as Record<string, unknown>)[col] === val) Object.assign(a, patch);
            }
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  },
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

async function getCronHandler() {
  const mod = await import("@/routes/api/public/cron-alerts");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod.Route as any).options.server.handlers.POST as (ctx: { request: Request }) => Promise<Response>;
}

function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("integration: order -> price_alert -> cron", () => {
  const SECRET = "int-test-secret";
  const USER = "00000000-0000-0000-0000-0000000000aa";
  const NOW = () => new Date().toISOString();

  beforeEach(() => {
    process.env.CRON_ALERTS_SECRET = SECRET;
    state.orders = [];
    state.alerts = [];
  });

  it("fires only the alerts whose price target was met after orders execute", async () => {
    // 1) Trader places two orders (recorded in the in-memory store).
    await supabaseAdmin.from("orders").insert({
      id: "o1", user_id: USER, symbol: "NOOR001", side: "buy",
      qty: 10, price: 120, status: "filled", created_at: NOW(),
    });
    await supabaseAdmin.from("orders").insert({
      id: "o2", user_id: USER, symbol: "MADA002", side: "sell",
      qty: 5, price: 40, status: "filled", created_at: NOW(),
    });

    // 2) Alerts seeded relative to the mocked live prices (NOOR=120, MADA=40).
    await supabaseAdmin.from("price_alerts").insert({
      id: "al-noor", user_id: USER, symbol: "NOOR001",
      direction: "above", target_price: 100, active: true, triggered_at: null,
    });
    await supabaseAdmin.from("price_alerts").insert({
      id: "al-mada", user_id: USER, symbol: "MADA002",
      direction: "below", target_price: 50, active: true, triggered_at: null,
    });
    await supabaseAdmin.from("price_alerts").insert({
      id: "al-noop", user_id: USER, symbol: "NOOR001",
      direction: "below", target_price: 10, active: true, triggered_at: null,
    });

    // 3) Trigger the scheduled scan.
    const handler = await getCronHandler();
    const body = JSON.stringify({ ts: Date.now() });
    const before = Date.now();
    const res = await handler({
      request: new Request("http://x/api/public/cron-alerts", {
        method: "POST",
        body,
        headers: { "x-signature": sign(body, SECRET) },
      }),
    });
    const after = Date.now();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { scanned: number; triggered: number };
    expect(json.scanned).toBe(3);
    expect(json.triggered).toBe(2);

    // 4) Alerts that met their target are inactive with a triggered_at inside the window.
    const noor = state.alerts.find((a) => a.id === "al-noor")!;
    const mada = state.alerts.find((a) => a.id === "al-mada")!;
    const noop = state.alerts.find((a) => a.id === "al-noop")!;

    for (const a of [noor, mada]) {
      expect(a.active).toBe(false);
      expect(a.triggered_at).not.toBeNull();
      const ts = new Date(a.triggered_at!).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    }
    expect(noop.active).toBe(true);
    expect(noop.triggered_at).toBeNull();
  });
});