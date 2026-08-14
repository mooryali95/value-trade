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
