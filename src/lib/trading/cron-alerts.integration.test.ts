import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

/**
 * End-to-end integration test for the price-alert flow:
 *   1. A trader's orders execute, producing trades (NOOR001 @ 120, MADA002 @ 40).
 *   2. Matching price alerts are created for the two symbols.
 *   3. The scheduled cron endpoint is invoked with a valid HMAC signature.
 *   4. The alerts whose target is met are marked inactive with a `triggered_at`
 *      timestamp that falls within the invocation window; the third alert stays active.
 *
 * The database is stubbed so the test is deterministic and does not require
 * network or a real Supabase instance. The cron prices symbols from the latest
 * row in public.trades, for listed (published) instruments only: a reference
 * price or an unlisted instrument never fires an alert.
 */

vi.mock("@/lib/security/rate-limit.server", () => ({
  checkRateLimit: async () => true,
  clientKeyFromRequest: (_r: Request, scope: string) => `${scope}:test`,
}));
vi.mock("@/lib/notifications/notify.server", () => ({
  notifySymbolEvent: async () => ({ notified: 0 }),
}));
vi.mock("@/lib/ops/run-log.server", () => ({ logOpsRun: async () => undefined }));
vi.mock("@/lib/ops/ops-alert.server", () => ({ maybeAlertAdmins: async () => undefined }));

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

type Trade = { symbol: string; price: number; created_at: string };
type Brand = { symbol: string; published: boolean; reference_price: number };

const state: { orders: Order[]; alerts: Alert[]; trades: Trade[]; brands: Brand[] } = {
  orders: [],
  alerts: [],
  trades: [],
  brands: [],
};

function brandsQuery() {
  let published: unknown;
  const q = {
    select: () => q,
    eq: (_c: string, v: unknown) => { published = v; return q; },
    in: async (_c: string, symbols: string[]) => ({
      data: state.brands
        .filter((b) => b.published === published && symbols.includes(b.symbol))
        .map((b) => ({ symbol: b.symbol })),
      error: null,
    }),
  };
  return q;
}

function tradesQuery() {
  let symbol = "";
  const q = {
    select: () => q,
    eq: (_c: string, v: string) => { symbol = v; return q; },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => {
      const rows = state.trades
        .filter((t) => t.symbol === symbol)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { data: rows[0] ? { price: rows[0].price } : null, error: null };
    },
  };
  return q;
}

const supabaseAdmin = {
  from(table: "orders" | "price_alerts" | "trades" | "brands") {
    if (table === "trades") return tradesQuery();
    if (table === "brands") return brandsQuery();
    return {
      // Alerts are read page by page: eq(active) -> gt(id)? -> order(id) -> limit(n).
      select() {
        let active: unknown;
        let after: string | null = null;
        let limit = Infinity;
        const page = {
          eq(_col: string, val: unknown) { active = val; return page; },
          gt(_col: string, val: string) { after = val; return page; },
          order() { return page; },
          limit(n: number) {
            limit = n;
            const rows = table === "orders"
              ? state.orders
              : state.alerts
                  .filter((a) => a.active === active && (after === null || a.id > after))
                  .sort((a, b) => a.id.localeCompare(b.id))
                  .slice(0, limit);
            return Promise.resolve({ data: rows, error: null });
          },
        };
        return page;
      },
      insert(row: Order | Alert) {
        if (table === "orders") state.orders.push(row as Order);
        else state.alerts.push(row as Alert);
        return Promise.resolve({ data: row, error: null });
      },
      update(patch: Partial<Alert>) {
        const filters: { col: string; val: unknown }[] = [];
        const chain = {
          eq(col: string, val: unknown) {
            filters.push({ col, val });
            return chain;
          },
          select() {
            const hit = state.alerts.filter((a) =>
              filters.every((f) => (a as unknown as Record<string, unknown>)[f.col] === f.val),
            );
            for (const a of hit) Object.assign(a, patch);
            return Promise.resolve({ data: hit.map((a) => ({ id: a.id })), error: null });
          },
        };
        return chain;
      },
    };
  },
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

/** Seeds the in-memory store (what the trader's orders and alerts wrote). */
function seed(table: "orders" | "price_alerts", row: Order | Alert) {
  if (table === "orders") state.orders.push(row as Order);
  else state.alerts.push(row as Alert);
}

async function getCronHandler() {
  const mod = await import("@/routes/api/public/cron-alerts");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod.Route as any).options.server.handlers.POST as (ctx: { request: Request }) => Promise<Response>;
}

/** The scheduler's headers: x-timestamp and the HMAC of "<timestamp>.<body>". */
function signed(body: string, secret: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "x-timestamp": timestamp,
    "x-signature": createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"),
  };
}

describe("integration: order -> price_alert -> cron", () => {
  const SECRET = "int-test-secret";
  const USER = "00000000-0000-0000-0000-0000000000aa";
  const NOW = () => new Date().toISOString();

  beforeEach(() => {
    process.env.CRON_ALERTS_SECRET = SECRET;
    state.orders = [];
    state.alerts = [];
    state.trades = [];
    state.brands = [];
  });

  it("fires only the alerts whose price target was met after orders execute", async () => {
    // 1) Trader places two orders (recorded in the in-memory store).
    seed("orders", {
      id: "o1", user_id: USER, symbol: "NOOR001", side: "buy",
      qty: 10, price: 120, status: "filled", created_at: NOW(),
    });
    seed("orders", {
      id: "o2", user_id: USER, symbol: "MADA002", side: "sell",
      qty: 5, price: 40, status: "filled", created_at: NOW(),
    });

    // Both instruments are listed; the executed orders' trades set the
    // market price (NOOR=120, MADA=40).
    state.brands.push({ symbol: "NOOR001", published: true, reference_price: 100 });
    state.brands.push({ symbol: "MADA002", published: true, reference_price: 45 });
    state.trades.push({ symbol: "NOOR001", price: 120, created_at: NOW() });
    state.trades.push({ symbol: "MADA002", price: 40, created_at: NOW() });

    // 2) Alerts seeded relative to the last trade prices (NOOR=120, MADA=40).
    seed("price_alerts", {
      id: "al-noor", user_id: USER, symbol: "NOOR001",
      direction: "above", target_price: 100, active: true, triggered_at: null,
    });
    seed("price_alerts", {
      id: "al-mada", user_id: USER, symbol: "MADA002",
      direction: "below", target_price: 50, active: true, triggered_at: null,
    });
    seed("price_alerts", {
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
        headers: signed(body, SECRET),
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
  it("never fires on a reference price or on an instrument that is not listed", async () => {
    // Listed but never traded: its reference price (100) is not a market price.
    state.brands.push({ symbol: "LIST001", published: true, reference_price: 100 });
    // Traded, then taken off the market.
    state.brands.push({ symbol: "DELI001", published: false, reference_price: 20 });
    state.trades.push({ symbol: "DELI001", price: 150, created_at: NOW() });
    seed("price_alerts", {
      id: "al-ref", user_id: USER, symbol: "LIST001",
      direction: "above", target_price: 50, active: true, triggered_at: null,
    });
    seed("price_alerts", {
      id: "al-delisted", user_id: USER, symbol: "DELI001",
      direction: "above", target_price: 100, active: true, triggered_at: null,
    });

    const handler = await getCronHandler();
    const body = JSON.stringify({ ts: Date.now() });
    const res = await handler({
      request: new Request("http://x/api/public/cron-alerts", {
        method: "POST",
        body,
        headers: signed(body, SECRET),
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { scanned: number; triggered: number };
    expect(json).toMatchObject({ scanned: 2, triggered: 0 });
    for (const a of state.alerts) {
      expect(a.active).toBe(true);
      expect(a.triggered_at).toBeNull();
    }
  });

  it("scans every active alert, past the API's row limit", async () => {
    state.brands.push({ symbol: "NOOR001", published: true, reference_price: 100 });
    state.trades.push({ symbol: "NOOR001", price: 120, created_at: NOW() });
    for (let i = 0; i < 1234; i++) {
      seed("price_alerts", {
        id: `al-${String(i).padStart(5, "0")}`, user_id: USER, symbol: "NOOR001",
        direction: i === 1233 ? "above" : "below", target_price: 100, active: true, triggered_at: null,
      });
    }
    const handler = await getCronHandler();
    const body = "{}";
    const res = await handler({
      request: new Request("http://x/api/public/cron-alerts", { method: "POST", body, headers: signed(body, SECRET) }),
    });
    expect(res.status).toBe(200);
    // The one alert that fires is the last one by id (on the third page).
    expect(await res.json()).toMatchObject({ scanned: 1234, triggered: 1 });
    expect(state.alerts.find((a) => a.id === "al-01233")!.active).toBe(false);
  });
});
