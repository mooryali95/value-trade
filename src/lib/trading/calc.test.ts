import { describe, it, expect } from "vitest";
import { applyFill, positionValue, unrealizedPnl, weight } from "./calc";

describe("applyFill", () => {
  it("opens a position from flat", () => {
    expect(applyFill({ qty: 0, avgPrice: 0 }, "buy", 10, 25)).toEqual({ qty: 10, avgPrice: 25 });
  });

  it("weights the average price across buys", () => {
    const after = applyFill({ qty: 10, avgPrice: 20 }, "buy", 10, 30);
    expect(after).toEqual({ qty: 20, avgPrice: 25 });
  });

  it("keeps the average price on partial sells", () => {
    expect(applyFill({ qty: 20, avgPrice: 25 }, "sell", 5, 40)).toEqual({ qty: 15, avgPrice: 25 });
  });

  it("zeroes the average price when fully closed", () => {
    expect(applyFill({ qty: 5, avgPrice: 25 }, "sell", 5, 40)).toEqual({ qty: 0, avgPrice: 0 });
  });

  it("clamps oversells to zero instead of going negative", () => {
    expect(applyFill({ qty: 5, avgPrice: 25 }, "sell", 50, 40)).toEqual({ qty: 0, avgPrice: 0 });
  });

  it("ignores non-positive quantities", () => {
    const pos = { qty: 7, avgPrice: 12 };
    expect(applyFill(pos, "buy", 0, 99)).toEqual(pos);
    expect(applyFill(pos, "sell", -3, 99)).toEqual(pos);
  });

  it("rounds the average price to 4 decimals", () => {
    const after = applyFill({ qty: 1, avgPrice: 1 }, "buy", 2, 2);
    expect(after.avgPrice).toBe(1.6667);
  });
});

describe("portfolio math", () => {
  it("values positions at last price", () => {
    expect(positionValue(3, 33.333)).toBe(100);
  });

  it("computes unrealized pnl in both directions", () => {
    expect(unrealizedPnl(10, 20, 25)).toBe(50);
    expect(unrealizedPnl(10, 20, 15)).toBe(-50);
    expect(unrealizedPnl(0, 20, 15)).toBeCloseTo(0);
  });

  it("computes allocation weights and guards zero totals", () => {
    expect(weight(25, 100)).toBe(25);
    expect(weight(1, 3)).toBe(33.33);
    expect(weight(10, 0)).toBe(0);
  });
});
