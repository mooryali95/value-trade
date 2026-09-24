import { beforeEach, describe, expect, it, vi } from "vitest";

// The public market API reads through the publishable-key client only
// (never the service role), calls the capped public_* database functions and
// maps failures to a stable code.

type Rpc = { data: unknown; error: { code?: string; message?: string } | null };
const calls: { name: string; args: unknown }[] = [];
const responses: Record<string, Rpc> = {};

vi.mock("@/lib/trading/book.server", () => ({
  getPublicClient: () => ({
    rpc: async (name: string, args?: unknown) => {
      calls.push({ name, args });
      return responses[name] ?? { data: [], error: null };
    },
  }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    throw new Error("public market data must not use the service role");
  },
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const api: Record<string, unknown> = {
      _validator: undefined as undefined | ((i: unknown) => unknown),
      middleware() {
        return api;
      },
      inputValidator(v: (i: unknown) => unknown) {
        api._validator = v;
        return api;
      },
      handler(h: (ctx: { data: unknown }) => unknown) {
        return async (input?: { data?: unknown }) => {
          const validator = api._validator as ((i: unknown) => unknown) | undefined;
          return h({ data: validator ? validator(input?.data) : input?.data });
        };
      },
    };
    return api;
  },
}));

import {
  getCandles,
  getMarketOverview,
  getPublicCompanyProfile,
  getPublicInstrument,
  getPublicShariahRulings,
  getRecentTrades,
} from "./public-market.functions";
import { getTradeInstrument } from "@/lib/instruments/instrument.functions";

const call = <T,>(fn: (i: never) => Promise<T>, data?: unknown) => fn({ data } as never);

const ROW = {
  symbol: "ACME",
  slug: "acme",
  name_ar: "أكمي",
  name_en: "Acme",
  sector: null,
  asset_class: "brand",
  company_id: null,
  company_name_ar: null,
  company_name_en: null,
  reference_price: "50",
  last_price: null,
  change_24h_pct: null,
  volume_24h_units: "0",
  volume_24h_value: "0",
  trades_24h: 0,
  last_trade_at: null,
  shariah_status: null,
};

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(responses)) delete responses[k];
});

describe("public market server functions", () => {
  it("overview: instruments and summary from the public functions", async () => {
    responses.public_market_overview = { data: [ROW], error: null };
    responses.public_market_summary = {
      data: [{ listed_count: 1, trades_24h: 0, volume_24h_value: "0", last_trade_at: null }],
      error: null,
    };
    const res = await call(getMarketOverview);
    expect(res.instruments).toHaveLength(1);
    expect(res.instruments[0]).toMatchObject({ symbol: "ACME", referencePrice: 50, lastPrice: null });
    expect(res.summary).toEqual({ listedCount: 1, trades24h: 0, volume24hValue: 0, lastTradeAt: null });
    expect(calls.map((c) => c.name).sort()).toEqual(["public_market_overview", "public_market_summary"]);
  });

  it("an empty market is empty, not filled in", async () => {
    responses.public_market_summary = { data: [], error: null };
    const res = await call(getMarketOverview);
    expect(res).toEqual({ instruments: [], summary: { listedCount: 0, trades24h: 0, volume24hValue: 0, lastTradeAt: null } });
  });

  it("database failures surface as MARKET_DATA_UNAVAILABLE", async () => {
    responses.public_market_overview = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(call(getMarketOverview)).rejects.toThrow(/^MARKET_DATA_UNAVAILABLE$/);
    responses.public_candles = { data: null, error: { code: "57014" } };
    await expect(call(getCandles, { symbol: "ACME", interval: "1d" })).rejects.toThrow(/^MARKET_DATA_UNAVAILABLE$/);
  });

  it("instrument: slug passed through, unknown -> null, malformed never queried", async () => {
    responses.public_instrument = {
      data: [{ ...ROW, day_open: null, day_high: null, day_low: null, band_reference: "50", band_low: "40", band_high: "60" }],
      error: null,
    };
    await expect(call(getPublicInstrument, { slug: "Acme" })).resolves.toMatchObject({ symbol: "ACME", bandLow: 40, bandHigh: 60 });
    expect(calls).toEqual([{ name: "public_instrument", args: { _slug: "Acme" } }]);
    responses.public_instrument = { data: [], error: null };
    await expect(call(getPublicInstrument, { slug: "nope" })).resolves.toBeNull();
    calls.length = 0;
    await expect(call(getPublicInstrument, { slug: "a;drop" })).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("getTradeInstrument is a thin alias over the same loader", async () => {
    responses.public_instrument = {
      data: [{ ...ROW, shariah_status: "halal", day_open: null, day_high: null, day_low: null, band_reference: "52", band_low: "41.60", band_high: "62.40" }],
      error: null,
    };
    await expect(call(getTradeInstrument, { symbol: "acme" })).resolves.toMatchObject({
      symbol: "ACME",
      bandLow: 41.6,
      bandHigh: 62.4,
      bandReference: 52,
      shariah: "halal",
      shariahStatus: "halal",
    });
    expect(calls).toEqual([{ name: "public_instrument", args: { _slug: "acme" } }]);
  });

  it("candles and trades: symbol upper-cased, limits capped before the call", async () => {
    responses.public_candles = {
      data: [{ bucket_start: "2026-01-10T06:00:00Z", open_price: 10, high_price: 12, low_price: 9, close_price: 9, volume_units: 6, trade_count: 3 }],
      error: null,
    };
    await expect(call(getCandles, { symbol: "acme", interval: "1h", limit: 9999 })).resolves.toEqual([
      { time: "2026-01-10T06:00:00.000Z", open: 10, high: 12, low: 9, close: 9, volume: 6 },
    ]);
    expect(calls[0]).toEqual({ name: "public_candles", args: { _symbol: "ACME", _interval: "1h", _limit: 500 } });
    await call(getRecentTrades, { symbol: "acme", limit: 9999 });
    expect(calls[1]).toEqual({ name: "public_recent_trades", args: { _symbol: "ACME", _limit: 50 } });
    calls.length = 0;
    await expect(call(getRecentTrades, { symbol: "" })).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
    await expect(call(getCandles, { symbol: "ACME", interval: "1w" })).rejects.toThrow(/^INVALID_INPUT$/);
  });

  it("rulings and company profile", async () => {
    responses.public_shariah_rulings = {
      data: [{ symbol: "ACME", slug: "acme", name_ar: "أ", name_en: "A", status: "reviewing", reason: null, effective_at: "2026-09-24T07:00:00Z" }],
      error: null,
    };
    await expect(call(getPublicShariahRulings)).resolves.toHaveLength(1);
    const id = "7b0c3f7e-5d1a-4a53-9a55-0c1f9f3a2b10";
    responses.public_company_profile = { data: [{ id, name_ar: "ش", name_en: "Co", sector: "retail" }], error: null };
    responses.public_market_overview = { data: [{ ...ROW, company_id: id }], error: null };
    await expect(call(getPublicCompanyProfile, { id })).resolves.toMatchObject({ id, nameEn: "Co", instruments: [{ symbol: "ACME" }] });
    expect(calls).toContainEqual({ name: "public_market_overview", args: { _company_id: id } });
    responses.public_company_profile = { data: [], error: null };
    await expect(call(getPublicCompanyProfile, { id })).resolves.toBeNull();
    calls.length = 0;
    await expect(call(getPublicCompanyProfile, { id: "not-a-uuid" })).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
