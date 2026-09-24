import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

// The route prices symbols from public.trades (last trade) with a fallback to
// brands.reference_price, and reads/writes alerts through supabaseAdmin. We
// mock the admin client per table so the test is isolated and deterministic.

const alertRows = [
  { id: "a1", user_id: "u1", symbol: "NOOR001", direction: "above", target_price: 90 }, // fires (trade 100 >= 90)
  { id: "a2", user_id: "u1", symbol: "NOOR001", direction: "below", target_price: 90 }, // no
  { id: "a3", user_id: "u2", symbol: "MADA002", direction: "below", target_price: 60 }, // fires (ref 50 <= 60)
  { id: "a4", user_id: "u3", symbol: "GHOST", direction: "above", target_price: 1 }, // no price -> skipped
];
const lastTrade: Record<string, number> = { NOOR001: 100 };
const referencePrice: Record<string, number> = { NOOR001: 999, MADA002: 50 };

const updateChain = vi.fn();
const tradesEq = vi.fn();

function alertsTable() {
  return {
    select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: alertRows, error: null }) })),
    update: (patch: unknown) => {
      updateChain(patch);
      const chain = {
        eq: vi.fn(() => chain),
        select: vi.fn().mockResolvedValue({ data: [{ id: "x" }], error: null }),
      };
      return chain;
    },
  };
}

function tradesTable() {
  let symbol = "";
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((_c: string, v: string) => {
      symbol = v;
      tradesEq(v);
      return chain;
    }),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({
      data: symbol in lastTrade ? { price: lastTrade[symbol] } : null,
      error: null,
    })),
  };
  return chain;
}

function brandsTable() {
  return {
    select: vi.fn(() => ({
      in: vi.fn(async (_c: string, symbols: string[]) => ({
        data: symbols
          .filter((s) => s in referencePrice)
          .map((s) => ({ symbol: s, reference_price: referencePrice[s] })),
        error: null,
      })),
    })),
  };
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === "price_alerts") return alertsTable();
      if (table === "trades") return tradesTable();
      if (table === "brands") return brandsTable();
      throw new Error(`unexpected table ${table}`);
    }),
  },
}));

vi.mock("@/lib/security/rate-limit.server", () => ({
  checkRateLimit: vi.fn(async () => true),
  clientKeyFromRequest: (_r: Request, scope: string) => `${scope}:test`,
}));
const notifySymbolEvent = vi.fn(async (_i: { templateData: { currentPrice: string } }) => ({ notified: 1 }));
vi.mock("@/lib/notifications/notify.server", () => ({ notifySymbolEvent }));
vi.mock("@/lib/ops/run-log.server", () => ({ logOpsRun: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/ops-alert.server", () => ({ maybeAlertAdmins: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/origin.server", () => ({ canonicalOrigin: () => "https://hub.sunkvalue.com" }));

describe("POST /api/public/cron-alerts", () => {
  const secret = "test-secret";
  beforeEach(() => {
    process.env.CRON_ALERTS_SECRET = secret;
    updateChain.mockClear();
    tradesEq.mockClear();
    notifySymbolEvent.mockClear();
  });

  async function getHandler() {
    const mod = await import("./cron-alerts");
    // Route.options is the object passed to createFileRoute
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (mod.Route as any).options.server.handlers.POST as (ctx: { request: Request }) => Promise<Response>;
  }

  function sign(body: string) {
    return createHmac("sha256", secret).update(body).digest("hex");
  }

  it("rejects unsigned requests with 401", async () => {
    const handler = await getHandler();
    const res = await handler({ request: new Request("http://x/api/public/cron-alerts", { method: "POST", body: "{}" }) });
    expect(res.status).toBe(401);
  });

  it("rejects invalid signature with 401", async () => {
    const handler = await getHandler();
    const res = await handler({
      request: new Request("http://x/api/public/cron-alerts", {
        method: "POST",
        body: "{}",
        headers: { "x-signature": "deadbeef" },
      }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 503 when neither an HMAC secret nor a service key is configured", async () => {
    delete process.env.CRON_ALERTS_SECRET;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const handler = await getHandler();
    const res = await handler({ request: new Request("http://x", { method: "POST", body: "{}" }) });
    expect(res.status).toBe(503);
    process.env.CRON_ALERTS_SECRET = secret;
    if (serviceKey) process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  });

  it("prices from the last trade, falls back to the reference price, skips unpriced symbols", async () => {
    const handler = await getHandler();
    const body = "{}";
    const res = await handler({
      request: new Request("http://x/api/public/cron-alerts", {
        method: "POST",
        body,
        headers: { "x-signature": sign(body) },
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { scanned: number; triggered: number; emailed: number };
    expect(json.scanned).toBe(4);
    expect(json.triggered).toBe(2);
    expect(json.emailed).toBe(2);
    expect(updateChain).toHaveBeenCalledTimes(2);
    const calls = updateChain.mock.calls as unknown as Array<[{ active: boolean; triggered_at: string }]>;
    const arg = calls[0][0];
    expect(arg.active).toBe(false);
    expect(typeof arg.triggered_at).toBe("string");
    // One last-trade lookup per distinct symbol.
    expect(tradesEq).toHaveBeenCalledTimes(3);
    const prices = notifySymbolEvent.mock.calls.map((c) => c[0].templateData.currentPrice).sort();
    expect(prices).toEqual(["100.00", "50.00"]);
  });

  it("accepts the service-role bearer token", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-key";
    const handler = await getHandler();
    const res = await handler({
      request: new Request("http://x/api/public/cron-alerts", {
        method: "POST",
        body: "{}",
        headers: { authorization: "Bearer svc-key" },
      }),
    });
    expect(res.status).toBe(200);
    const wrong = await handler({
      request: new Request("http://x/api/public/cron-alerts", {
        method: "POST",
        body: "{}",
        headers: { authorization: "Bearer svc-ke" },
      }),
    });
    expect(wrong.status).toBe(401);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
});
