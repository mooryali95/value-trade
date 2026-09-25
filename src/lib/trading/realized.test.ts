import { describe, it, expect } from "vitest";
import { computeRealized, type FilledOrder } from "./realized";

function order(o: Partial<FilledOrder> & { id: string }): FilledOrder {
  return {
    symbol: "AAA",
    asset_class: "brand",
    side: "buy",
    qty: 10,
    filled_price: 100,
    filled_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    ...o,
  };
}

describe("computeRealized", () => {
  it("realizes profit against the weighted average cost", () => {
    const res = computeRealized([
      order({ id: "1", qty: 10, filled_price: 20, filled_at: "2026-01-01T00:00:00.000Z" }),
      order({ id: "2", qty: 10, filled_price: 30, filled_at: "2026-01-02T00:00:00.000Z" }),
      order({ id: "3", side: "sell", qty: 10, filled_price: 40, filled_at: "2026-01-03T00:00:00.000Z" }),
    ]);
    expect(res.totals.realized).toBe(150);
    expect(res.trades[0]?.costBasis).toBe(250);
    expect(res.trades[0]?.returnPct).toBe(60);
    expect(res.totals.wins).toBe(1);
  });

  it("realizes losses and reports them separately", () => {
    const res = computeRealized([
      order({ id: "1", qty: 5, filled_price: 100 }),
      order({ id: "2", side: "sell", qty: 5, filled_price: 80, filled_at: "2026-01-02T00:00:00.000Z" }),
    ]);
    expect(res.totals.realized).toBe(-100);
    expect(res.totals.losses).toBe(1);
  });

  it("ignores sells with nothing held", () => {
    const res = computeRealized([order({ id: "1", side: "sell", qty: 5, filled_price: 80 })]);
    expect(res.trades).toHaveLength(0);
    expect(res.totals.realized).toBe(0);
  });

  it("keeps per-symbol aggregation independent", () => {
    const res = computeRealized([
      order({ id: "1", symbol: "AAA", qty: 10, filled_price: 10 }),
      order({ id: "2", symbol: "BBB", qty: 10, filled_price: 50 }),
      order({ id: "3", symbol: "AAA", side: "sell", qty: 10, filled_price: 15, filled_at: "2026-01-02T00:00:00.000Z" }),
      order({ id: "4", symbol: "BBB", side: "sell", qty: 10, filled_price: 40, filled_at: "2026-01-03T00:00:00.000Z" }),
    ]);
    expect(res.bySymbol.find((s) => s.symbol === "AAA")?.realized).toBe(50);
    expect(res.bySymbol.find((s) => s.symbol === "BBB")?.realized).toBe(-100);
    expect(res.totals.realized).toBe(-50);
  });

  it("ignores unpriced fills", () => {
    const res = computeRealized([order({ id: "1", filled_price: null })]);
    expect(res.totals.costBasis).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 (M2): exact cents, carried lot cost, engine order, Riyadh days.
// ---------------------------------------------------------------------------
import { filterFills, remainingLots, riyadhDayRange, summarize, computeRealizedFills, timeKey } from "./realized";
import { applyFill } from "./calc";
import { mulCents, toCents } from "./money";
import { summarizePortfolio, valuePosition } from "./valuation";

function fill(
  i: number,
  side: "buy" | "sell",
  qty: number,
  price: number,
  at: string,
  extra: Partial<FilledOrder> = {},
): FilledOrder {
  return {
    id: `o${i}`,
    symbol: "AAA",
    asset_class: "brand",
    side,
    qty,
    filled_price: price,
    filled_at: at,
    created_at: at,
    source: "trade",
    fill_id: `t${String(i).padStart(6, "0")}`,
    ...extra,
  };
}

/** Deterministic pseudo-random numbers (LCG), so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Microsecond timestamps like PostgREST prints them. */
function ts(micro: number): string {
  const ms = Math.floor(micro / 1000);
  const iso = new Date(Date.UTC(2026, 8, 24, 6, 0, 0) + ms).toISOString(); // ...T06:00:00.123Z
  const us = String(micro % 1000).padStart(3, "0");
  return iso.replace(/\.(\d{3})Z$/, `.$1${us}+00:00`);
}

describe("realized results reconcile with cash to the cent (M2)", () => {
  it("formula audit repro: buy 1 @ 1.00 + 1 @ 1.01, sell 1 @ 1.10 twice = 0.19", () => {
    const r = computeRealized([
      fill(1, "buy", 1, 1.0, "2026-01-01T00:00:01+00:00"),
      fill(2, "buy", 1, 1.01, "2026-01-01T00:00:02+00:00"),
      fill(3, "sell", 1, 1.1, "2026-01-01T00:00:03+00:00"),
      fill(4, "sell", 1, 1.1, "2026-01-01T00:00:04+00:00"),
    ]);
    expect(r.totals.realized).toBe(0.19);
    expect(r.totals.costBasis).toBe(2.01);
    expect(r.totals.proceeds).toBe(2.2);
    // Per exit: 1.10 - round(2.01 / 2) = 0.09, then 1.10 - 1.00 = 0.10.
    expect(r.trades.map((t) => t.realized).sort()).toEqual([0.09, 0.1]);
  });

  it("the m_money.sh round trip: 300,000 bought for 3,001,000.00, sold in odd lots = -999.97", () => {
    const fills = [
      fill(1, "buy", 100_000, 10.01, ts(1)),
      fill(2, "buy", 200_000, 10.0, ts(2)),
      fill(3, "sell", 1, 10.05, ts(3)),
      fill(4, "sell", 99_999, 10.02, ts(4)),
      fill(5, "sell", 200_000, 9.99, ts(5)),
    ];
    const r = computeRealized(fills);
    expect(r.totals.realized).toBe(-999.97);
    expect(r.totals.costBasis).toBe(3_001_000);
    expect(r.trades.map((t) => [t.costBasis, t.realized])).toEqual([
      [2_000_666.67, -2_666.67],
      [1_000_323.33, 1_666.65],
      [10, 0.05],
    ]);
    // Before the last sale the lot equals the database's positions.cost_basis.
    expect(remainingLots(fills.slice(0, 4)).get("AAA")).toEqual({ qty: 200_000, costBasis: 2_000_666.67 });
  });

  it("thirds: cost 30.01 for 3 units, sold one by one at 11 = 1.00 + 0.99 + 1.00", () => {
    const r = computeRealized([
      fill(1, "buy", 1, 10.01, ts(1)),
      fill(2, "buy", 2, 10.0, ts(2)),
      fill(3, "sell", 1, 11, ts(3)),
      fill(4, "sell", 1, 11, ts(4)),
      fill(5, "sell", 1, 11, ts(5)),
    ]);
    // Costs removed: round(30.01 / 3) = 10.00, round(20.01 / 2) = 10.01, then 10.00.
    expect(r.trades.map((t) => t.realized)).toEqual([1, 0.99, 1]);
    expect(r.totals.realized).toBe(2.99);
  });

  it("property: for random histories, realized + unrealized = cash flow + market value (cents), and the lot equals apply_trade_position", () => {
    const rand = rng(20260926);
    let checked = 0;
    for (let trial = 0; trial < 3000; trial++) {
      const fills: FilledOrder[] = [];
      const cashFlow = new Map<string, bigint>(); // sells - buys, cents
      const mirror = new Map<string, { qty: number; costBasis: number }>(); // SQL apply_trade_position
      let micro = 0;
      const n = 2 + Math.floor(rand() * 14);
      for (let k = 0; k < n; k++) {
        const symbol = rand() < 0.5 ? "AAA" : "BBB";
        const held = mirror.get(symbol)?.qty ?? 0;
        const price = Math.round((0.05 + rand() * 60) * 100) / 100;
        micro += 1 + Math.floor(rand() * 2_000_000);
        const sell = held > 0 && rand() < 0.45;
        const qty = sell
          ? (rand() < 0.3 ? held : 1 + Math.floor(rand() * held))
          : 1 + Math.floor(rand() * (rand() < 0.2 ? 200_000 : 50));
        const issuance = !sell && rand() < 0.15;
        fills.push(
          fill(k, sell ? "sell" : "buy", qty, price, ts(micro), {
            symbol,
            source: issuance ? "issuance" : "trade",
            // A few fills share an order id (partial fills of one order).
            id: `o${sell ? Math.floor(k / 2) : k}-${symbol}`,
          }),
        );
        const amount = mulCents(qty, price);
        cashFlow.set(symbol, (cashFlow.get(symbol) ?? 0n) + (sell ? amount : -amount));
        const next = applyFill(mirror.get(symbol) ?? { qty: 0, costBasis: 0 }, sell ? "sell" : "buy", qty, price);
        mirror.set(symbol, { qty: next.qty, costBasis: next.costBasis });
      }
      // Replay order must not depend on the input order.
      const shuffled = fills.slice().sort(() => rand() - 0.5);
      const realizedFills = computeRealizedFills(shuffled);
      const lots = remainingLots(shuffled);
      for (const symbol of ["AAA", "BBB"]) {
        const m = mirror.get(symbol) ?? { qty: 0, costBasis: 0 };
        const lot = lots.get(symbol) ?? { qty: 0, costBasis: 0 };
        expect(lot).toEqual({ qty: m.qty, costBasis: m.costBasis });

        const realizedCents = realizedFills
          .filter((f) => f.symbol === symbol)
          .reduce((s, f) => s + f.proceedsCents - f.costCents, 0n);
        const mark = Math.round((0.05 + rand() * 60) * 100) / 100;
        const valued = valuePosition({
          symbol, asset_class: "brand", qty: m.qty, cost_basis: m.costBasis, avg_price: 0, reserved_qty: 0,
          last_price: mark, last_trade_at: null, band_reference: null, published: true, slug: null,
          name_ar: null, name_en: null, updated_at: null,
        });
        const unrealizedCents = m.qty > 0 ? (toCents(valued.unrealized_pnl) as bigint) : 0n;
        const marketValueCents = m.qty > 0 ? (toCents(valued.market_value) as bigint) : 0n;
        expect(realizedCents + unrealizedCents).toBe((cashFlow.get(symbol) ?? 0n) + marketValueCents);
        if (m.qty === 0) expect(realizedCents).toBe(cashFlow.get(symbol) ?? 0n);
        checked++;
      }
    }
    expect(checked).toBe(6000);
  });

  it("totals from summarize() equal the sum of the exits, and wins/losses count exits (orders), not fills", () => {
    const fills = [
      fill(1, "buy", 10, 10, ts(1)),
      // One sell order, two executions: -1.00 and +3.00 -> one winning exit.
      fill(2, "sell", 1, 9, ts(2), { id: "sell-1" }),
      fill(3, "sell", 1, 13, ts(3), { id: "sell-1" }),
      fill(4, "sell", 2, 8, ts(4), { id: "sell-2" }),
      fill(5, "sell", 1, 10, ts(5), { id: "sell-3" }),
    ];
    const r = computeRealized(fills);
    expect(r.trades).toHaveLength(3);
    expect(r.trades.find((t) => t.orderId === "sell-1")).toMatchObject({ fills: 2, qty: 2, realized: 2, exitPrice: 11 });
    expect(r.totals).toMatchObject({ wins: 1, losses: 1, flat: 1, realized: -2 });
    const sum = r.trades.reduce((s, t) => s + Math.round(t.realized * 100), 0);
    expect(sum).toBe(Math.round(r.totals.realized * 100));
    // Newest exit first.
    expect(r.trades.map((t) => t.orderId)).toEqual(["sell-3", "sell-2", "sell-1"]);
  });

  it("the same order id on two symbols stays two exits (unique rows)", () => {
    const r = computeRealized([
      fill(1, "buy", 1, 10, ts(1), { symbol: "AAA" }),
      fill(2, "buy", 1, 10, ts(2), { symbol: "BBB" }),
      fill(3, "sell", 1, 11, ts(3), { symbol: "AAA", id: "same" }),
      fill(4, "sell", 1, 12, ts(4), { symbol: "BBB", id: "same" }),
    ]);
    expect(r.trades.map((t) => `${t.symbol}:${t.orderId}`).sort()).toEqual(["AAA:same", "BBB:same"]);
  });
});

describe("chronological replay (Date.parse with microseconds, not string order)", () => {
  it("orders fractional seconds correctly", () => {
    expect(timeKey("2026-09-24T10:00:00+00:00")).toBeLessThan(timeKey("2026-09-24T10:00:00.5+00:00"));
    expect(timeKey("2026-09-24T10:00:00.123456+00:00") - timeKey("2026-09-24T10:00:00.123455+00:00")).toBe(1);
    expect(timeKey("2026-09-24T13:00:00+03:00")).toBe(timeKey("2026-09-24T10:00:00Z"));
    expect(Number.isNaN(timeKey("not a date"))).toBe(true);
  });

  it("a buy at .5s is replayed after a sell at the whole second", () => {
    // String order would put "...00:00+00:00" after "...00:00.5+00:00" ("+" > ".").
    const r = computeRealized([
      fill(1, "buy", 1, 10, "2026-09-24T09:59:59+00:00"),
      fill(2, "sell", 1, 12, "2026-09-24T10:00:00+00:00"),
      fill(3, "buy", 1, 20, "2026-09-24T10:00:00.5+00:00"),
    ]);
    expect(r.totals.realized).toBe(2);
    expect(remainingLots([
      fill(1, "buy", 1, 10, "2026-09-24T09:59:59+00:00"),
      fill(2, "sell", 1, 12, "2026-09-24T10:00:00+00:00"),
      fill(3, "buy", 1, 20, "2026-09-24T10:00:00.5+00:00"),
    ]).get("AAA")).toEqual({ qty: 1, costBasis: 20 });
  });

  it("at the same instant an issuance or buy replays before a sell", () => {
    const at = "2026-09-24T10:00:00.000001+00:00";
    const r = computeRealized([
      fill(1, "sell", 1, 12, at),
      fill(2, "buy", 1, 10, at, { source: "issuance" }),
    ]);
    expect(r.totals.realized).toBe(2);
  });
});

describe("Asia/Riyadh day filters", () => {
  it("a day is [00:00, 24:00) Riyadh time (UTC+3)", () => {
    const { fromMs, toMs } = riyadhDayRange("2026-09-25", "2026-09-25");
    expect(new Date(fromMs as number).toISOString()).toBe("2026-09-24T21:00:00.000Z");
    expect(new Date(toMs as number).toISOString()).toBe("2026-09-25T20:59:59.999Z");
    expect(riyadhDayRange("2026-13-45", "x")).toEqual({ fromMs: null, toMs: null });
  });

  it("a sale at 00:30 Riyadh (21:30 UTC the day before) belongs to the Riyadh day", () => {
    const fills = computeRealizedFills([
      fill(1, "buy", 2, 10, "2026-09-24T12:00:00+00:00"),
      fill(2, "sell", 1, 11, "2026-09-24T21:30:00+00:00", { id: "late" }),
      fill(3, "sell", 1, 12, "2026-09-24T20:59:59.999999+00:00", { id: "early" }),
    ]);
    expect(summarize(filterFills(fills, { from: "2026-09-25", to: "2026-09-25" })).trades.map((t) => t.orderId)).toEqual(["late"]);
    expect(summarize(filterFills(fills, { to: "2026-09-24" })).trades.map((t) => t.orderId)).toEqual(["early"]);
    expect(filterFills(fills, { symbol: " aaa " })).toHaveLength(2);
    expect(filterFills(fills, { symbol: "BBB" })).toHaveLength(0);
  });
});

describe("valuation (H1/H2)", () => {
  const row = (o: Partial<Parameters<typeof valuePosition>[0]>) =>
    valuePosition({
      symbol: "AAA", asset_class: "brand", qty: 10, cost_basis: 1000, avg_price: 100, reserved_qty: 0,
      last_price: null, last_trade_at: null, band_reference: null, published: true, slug: "aaa",
      name_ar: null, name_en: null, updated_at: null, ...o,
    });

  it("values at the last trade, in percent of cost (avg 100 -> last 110 = +10%, not +0.10%)", () => {
    const p = row({ last_price: 110, band_reference: 90 });
    expect(p).toMatchObject({ mark_source: "last", mark_price: 110, market_value: 1100, unrealized_pnl: 100, unrealized_pct: 10 });
  });

  it("falls back to the band reference price, labelled as such", () => {
    expect(row({ band_reference: "95.5" })).toMatchObject({ mark_source: "reference", mark_price: 95.5, market_value: 955, unrealized_pnl: -45 });
  });

  it("never values at cost: no price means no value and no P/L", () => {
    expect(row({ band_reference: 0 })).toMatchObject({ mark_source: "none", mark_price: null, market_value: null, unrealized_pnl: null, unrealized_pct: null });
  });

  it("a zero cost basis has no percentage", () => {
    expect(row({ cost_basis: 0, avg_price: 0, last_price: 5 }).unrealized_pct).toBeNull();
  });

  it("totals leave unpriced holdings out and count them", () => {
    const s = summarizePortfolio(
      [row({ last_price: 110 }), row({ symbol: "BBB", cost_basis: 30.01, qty: 3, last_price: 10 }), row({ symbol: "CCC" })],
      500.5,
      45,
      455.5,
    );
    expect(s).toEqual({
      cash: 500.5,
      reserved: 45,
      buyingPower: 455.5,
      marketValue: 1130,
      pricedCostBasis: 1030.01,
      unrealizedPnl: 99.99,
      unrealizedPct: (9999 / 103001) * 100,
      totalValue: 1630.5,
      unpricedCount: 1,
    });
  });
});
