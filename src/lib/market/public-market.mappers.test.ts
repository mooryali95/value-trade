import { describe, expect, it } from "vitest";
import {
  mapCandleRow,
  mapCompanyProfile,
  mapInstrumentDetailRow,
  mapInstrumentRow,
  mapRows,
  mapRulingRow,
  mapSummaryRow,
  mapTradeRow,
  parseCandlesInput,
  parseCompanyInput,
  parseSlugInput,
  parseTradesInput,
  toIso,
  toNumber,
  bandReferenceOf,
  type InstrumentRow,
  type OverviewRow,
} from "./public-market.mappers";

// Rows as PostgREST may deliver them: numerics as numbers or strings,
// timestamptz with an offset.
const overviewRow = (over: Partial<Record<keyof OverviewRow, unknown>> = {}) =>
  ({
    symbol: "ACME",
    slug: "acme",
    name_ar: "أكمي",
    name_en: "Acme",
    sector: "retail",
    asset_class: "brand",
    company_id: "7b0c3f7e-5d1a-4a53-9a55-0c1f9f3a2b10",
    company_name_ar: "شركة أكمي",
    company_name_en: "Acme Co",
    reference_price: "50.00",
    last_price: "51.0000",
    change_24h_pct: "-1.92",
    volume_24h_units: "24",
    volume_24h_value: 1304,
    trades_24h: 2,
    last_trade_at: "2026-09-24 10:15:00.123456+03",
    shariah_status: "halal",
    ...over,
  }) as unknown as OverviewRow;

const detailRow = (over: Partial<Record<keyof InstrumentRow, unknown>> = {}) =>
  ({
    ...(overviewRow() as object),
    day_open: "55",
    day_high: 55,
    day_low: "51",
    band_reference: "52",
    band_low: "41.60",
    band_high: "62.40",
    ...over,
  }) as unknown as InstrumentRow;

describe("scalar helpers", () => {
  it("toNumber converts Postgres numerics and rejects non-finite values", () => {
    expect(toNumber("100.50")).toBe(100.5);
    expect(toNumber(7)).toBe(7);
    expect(toNumber("0")).toBe(0);
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber("NaN")).toBeNull();
    expect(toNumber("Infinity")).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber("abc")).toBeNull();
    expect(toNumber({})).toBeNull();
  });

  it("toIso normalizes timestamptz to ISO 8601 UTC", () => {
    expect(toIso("2026-09-24 10:15:00+03")).toBe("2026-09-24T07:15:00.000Z");
    expect(toIso("2026-09-24T07:15:00Z")).toBe("2026-09-24T07:15:00.000Z");
    expect(toIso(null)).toBeNull();
    expect(toIso("not a date")).toBeNull();
    expect(toIso(12)).toBeNull();
  });
});

describe("mapInstrumentRow", () => {
  it("maps a board row to camelCase numbers", () => {
    expect(mapInstrumentRow(overviewRow())).toEqual({
      symbol: "ACME",
      slug: "acme",
      nameAr: "أكمي",
      nameEn: "Acme",
      sector: "retail",
      assetClass: "brand",
      companyId: "7b0c3f7e-5d1a-4a53-9a55-0c1f9f3a2b10",
      companyNameAr: "شركة أكمي",
      companyNameEn: "Acme Co",
      referencePrice: 50,
      lastPrice: 51,
      change24hPct: -1.92,
      volume24hUnits: 24,
      volume24hValue: 1304,
      trades24h: 2,
      lastTradeAt: "2026-09-24T07:15:00.123Z",
      shariahStatus: "halal",
    });
  });

  it("keeps 'no trade yet' as null, never a made-up price", () => {
    const m = mapInstrumentRow(
      overviewRow({
        last_price: null,
        change_24h_pct: null,
        volume_24h_units: 0,
        volume_24h_value: "0",
        trades_24h: 0,
        last_trade_at: null,
        shariah_status: null,
        company_id: null,
        company_name_ar: null,
        company_name_en: null,
        sector: null,
      }),
    );
    expect(m).toMatchObject({
      lastPrice: null,
      change24hPct: null,
      volume24hUnits: 0,
      volume24hValue: 0,
      trades24h: 0,
      lastTradeAt: null,
      shariahStatus: null,
      companyId: null,
      sector: null,
      referencePrice: 50,
    });
  });

  it("drops rows it cannot map faithfully", () => {
    expect(mapInstrumentRow(overviewRow({ symbol: "" }))).toBeNull();
    expect(mapInstrumentRow(overviewRow({ slug: null }))).toBeNull();
    expect(mapInstrumentRow(overviewRow({ reference_price: null }))).toBeNull();
    expect(mapInstrumentRow(overviewRow({ reference_price: "0" }))).toBeNull();
  });

  it("only passes known Shariah statuses", () => {
    expect(mapInstrumentRow(overviewRow({ shariah_status: "non_halal" }))?.shariahStatus).toBe("non_halal");
    expect(mapInstrumentRow(overviewRow({ shariah_status: "reviewing" }))?.shariahStatus).toBe("reviewing");
    expect(mapInstrumentRow(overviewRow({ shariah_status: "restricted" }))?.shariahStatus).toBeNull();
  });

  it("never carries fields outside the public contract", () => {
    const m = mapInstrumentRow(overviewRow({ brand_id: "x", user_id: "y" } as never));
    expect(Object.keys(m ?? {})).not.toContain("brand_id");
    expect(Object.keys(m ?? {})).not.toContain("user_id");
  });
});

describe("mapInstrumentDetailRow", () => {
  it("adds today's range and the engine band", () => {
    expect(mapInstrumentDetailRow(detailRow())).toMatchObject({
      symbol: "ACME",
      dayOpen: 55,
      dayHigh: 55,
      dayLow: 51,
      bandLow: 41.6,
      bandHigh: 62.4,
    });
    expect(bandReferenceOf(detailRow())).toBe(52);
  });

  it("no trade today -> null range", () => {
    expect(mapInstrumentDetailRow(detailRow({ day_open: null, day_high: null, day_low: null }))).toMatchObject({
      dayOpen: null,
      dayHigh: null,
      dayLow: null,
    });
  });

  it("an instrument without a valid band is not presented as tradable", () => {
    expect(mapInstrumentDetailRow(detailRow({ band_low: null }))).toBeNull();
    expect(mapInstrumentDetailRow(detailRow({ band_high: null }))).toBeNull();
    expect(mapInstrumentDetailRow(detailRow({ band_low: "70", band_high: "60" }))).toBeNull();
    expect(bandReferenceOf(detailRow({ band_reference: null }))).toBeNull();
  });
});

describe("other rows", () => {
  it("summary defaults to zero counts when empty", () => {
    expect(mapSummaryRow(null)).toEqual({ listedCount: 0, trades24h: 0, volume24hValue: 0, lastTradeAt: null });
    expect(
      mapSummaryRow({ listed_count: 3, trades_24h: "2", volume_24h_value: "1304.00", last_trade_at: "2026-09-24T07:15:00Z" } as never),
    ).toEqual({ listedCount: 3, trades24h: 2, volume24hValue: 1304, lastTradeAt: "2026-09-24T07:15:00.000Z" });
  });

  it("candles", () => {
    expect(
      mapCandleRow({
        bucket_start: "2026-01-10 06:00:00+00",
        open_price: "10",
        high_price: "12",
        low_price: "9",
        close_price: "9",
        volume_units: "6",
        trade_count: 3,
      } as never),
    ).toEqual({ time: "2026-01-10T06:00:00.000Z", open: 10, high: 12, low: 9, close: 9, volume: 6 });
    expect(mapCandleRow({ bucket_start: null, open_price: 1 } as never)).toBeNull();
  });

  it("trades carry price, quantity and time only", () => {
    expect(mapTradeRow({ price: "51.00", qty: "4", traded_at: "2026-09-24T07:15:00Z" } as never)).toEqual({
      price: 51,
      qty: 4,
      tradedAt: "2026-09-24T07:15:00.000Z",
    });
    expect(mapTradeRow({ price: null, qty: 1, traded_at: "2026-09-24T07:15:00Z" } as never)).toBeNull();
  });

  it("Shariah rulings keep the status and reason, drop unknown statuses", () => {
    expect(
      mapRulingRow({
        symbol: "ACME",
        slug: "acme",
        name_ar: "أكمي",
        name_en: "Acme",
        status: "halal",
        reason: "",
        effective_at: "2026-09-24T07:15:00Z",
      } as never),
    ).toEqual({
      symbol: "ACME",
      slug: "acme",
      nameAr: "أكمي",
      nameEn: "Acme",
      status: "halal",
      reason: null,
      effectiveAt: "2026-09-24T07:15:00.000Z",
    });
    expect(mapRulingRow({ symbol: "ACME", slug: "acme", status: "restricted", effective_at: "2026-09-24T07:15:00Z" } as never)).toBeNull();
  });

  it("company profile needs the company row", () => {
    const inst = mapRows([overviewRow()], mapInstrumentRow);
    expect(mapCompanyProfile({ id: "c-1", name_ar: "ا", name_en: "A", sector: null } as never, inst)).toEqual({
      id: "c-1",
      nameAr: "ا",
      nameEn: "A",
      sector: null,
      instruments: inst,
    });
    expect(mapCompanyProfile(null, inst)).toBeNull();
  });

  it("mapRows drops unmappable rows and tolerates null", () => {
    expect(mapRows([overviewRow(), overviewRow({ symbol: "" })], mapInstrumentRow)).toHaveLength(1);
    expect(mapRows(null, mapInstrumentRow)).toEqual([]);
  });
});

describe("input parsing", () => {
  it("slug: identifiers only, malformed = not found", () => {
    expect(parseSlugInput({ slug: " Acme " })).toEqual({ slug: "Acme" });
    expect(parseSlugInput({ slug: "a,b" })).toEqual({ slug: null });
    expect(parseSlugInput({ slug: "x".repeat(65) })).toEqual({ slug: null });
    expect(parseSlugInput(undefined)).toEqual({ slug: null });
  });

  it("candles: interval required, limit clamped to 500", () => {
    expect(parseCandlesInput({ symbol: "acme", interval: "1d" })).toEqual({ symbol: "ACME", interval: "1d", limit: 200 });
    expect(parseCandlesInput({ symbol: "acme", interval: "1h", limit: 10_000 })).toMatchObject({ limit: 500 });
    expect(parseCandlesInput({ symbol: "a b", interval: "1h" }).symbol).toBeNull();
    expect(() => parseCandlesInput({ symbol: "acme", interval: "5m" })).toThrow(/^INVALID_INPUT$/);
    expect(() => parseCandlesInput({ symbol: "acme", interval: "1h", limit: 0 })).toThrow(/^INVALID_INPUT$/);
    expect(() => parseCandlesInput({ symbol: "acme", interval: "1h", limit: 1.5 })).toThrow(/^INVALID_INPUT$/);
  });

  it("trades: limit defaults to 20, clamped to 50", () => {
    expect(parseTradesInput({ symbol: "acme" })).toEqual({ symbol: "ACME", limit: 20 });
    expect(parseTradesInput({ symbol: "acme", limit: 1000 })).toEqual({ symbol: "ACME", limit: 50 });
    expect(() => parseTradesInput({ symbol: "acme", limit: -1 })).toThrow(/^INVALID_INPUT$/);
  });

  it("company: uuid only", () => {
    expect(parseCompanyInput({ id: "7B0C3F7E-5D1A-4A53-9A55-0C1F9F3A2B10" })).toEqual({
      id: "7b0c3f7e-5d1a-4a53-9a55-0c1f9f3a2b10",
    });
    expect(parseCompanyInput({ id: "acme" })).toEqual({ id: null });
  });
});
