import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

// The route uses BRANDS to price symbols and supabaseAdmin to read/write alerts.
// We mock both so the test is isolated and deterministic.

vi.mock("@/lib/mock-data", () => ({
  BRANDS: [
    { symbol: "NOOR001", price: 100 },
    { symbol: "MADA002", price: 50 },
  ],
}));

const updateEq = vi.fn().mockResolvedValue({ error: null });
const updateChain = vi.fn(() => ({ eq: updateEq }));
const eqActive = vi.fn().mockResolvedValue({
  data: [
    { id: "a1", symbol: "NOOR001", direction: "above", target_price: 90 }, // fires (100>=90)
    { id: "a2", symbol: "NOOR001", direction: "below", target_price: 90 }, // no
    { id: "a3", symbol: "MADA002", direction: "below", target_price: 60 }, // fires (50<=60)
  ],
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: eqActive })),
      update: updateChain,
    })),
  },
}));

describe("POST /api/public/cron-alerts", () => {
  const secret = "test-secret";
  beforeEach(() => {
    process.env.CRON_ALERTS_SECRET = secret;
    updateEq.mockClear();
    updateChain.mockClear();
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

  it("fires the two alerts whose conditions are met, ignores the third", async () => {
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
    const json = (await res.json()) as { scanned: number; triggered: number };
    expect(json.scanned).toBe(3);
    expect(json.triggered).toBe(2);
    expect(updateChain).toHaveBeenCalledTimes(2);
    const calls = updateChain.mock.calls as unknown as Array<[{ active: boolean; triggered_at: string }]>;
    const arg = calls[0][0];
    expect(arg.active).toBe(false);
    expect(typeof arg.triggered_at).toBe("string");
  });
});