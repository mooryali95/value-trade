import { describe, it, expect } from "vitest";
import {
  applyFill,
  isValidLimitPrice,
  isValidOrderQty,
  MAX_ORDER_QTY,
  parseModifyInput,
  parseOrderIdInput,
  parseOrderInput,
  pnlPct,
  positionValue,
  toEngineResult,
  tradingErrorCode,
  unrealizedFromCost,
  unrealizedPnl,
  weight,
} from "./calc";

describe("applyFill (mirrors public.apply_trade_position)", () => {
  it("opens a position from flat", () => {
    expect(applyFill({ qty: 0, costBasis: 0 }, "buy", 10, 25)).toEqual({ qty: 10, costBasis: 250, avgPrice: 25 });
  });

  it("adds the exact fill amount to the cost basis", () => {
    const after = applyFill({ qty: 10, costBasis: 200 }, "buy", 10, 30);
    expect(after).toEqual({ qty: 20, costBasis: 500, avgPrice: 25 });
  });

  it("keeps the cost basis exact where a rounded average would drift (M1)", () => {
    // 100,000 @ 10.01 + 200,000 @ 10.00 = 3,001,000.00 paid; avg 10.0033 x qty would say 3,000,990.
    const a = applyFill({ qty: 0, costBasis: 0 }, "buy", 100_000, 10.01);
    const b = applyFill(a, "buy", 200_000, 10.0);
    expect(b).toEqual({ qty: 300_000, costBasis: 3_001_000, avgPrice: 10.0033 });
  });

  it("removes the pro-rata cost on partial sells, to the cent", () => {
    expect(applyFill({ qty: 20, costBasis: 500 }, "sell", 5, 40)).toEqual({ qty: 15, costBasis: 375, avgPrice: 25 });
    // 1 of 3 units costing 30.01: round(10.00333) = 10.00 leaves the lot, 20.01 stays for 2 units.
    expect(applyFill({ qty: 3, costBasis: 30.01 }, "sell", 1, 11)).toEqual({ qty: 2, costBasis: 20.01, avgPrice: 10.005 });
    // Half a cent rounds away from zero: 3 units costing 0.05, sell 1 -> round(0.016667) = 0.02.
    expect(applyFill({ qty: 3, costBasis: 0.05 }, "sell", 1, 1)).toEqual({ qty: 2, costBasis: 0.03, avgPrice: 0.015 });
    expect(applyFill({ qty: 2, costBasis: 0.05 }, "sell", 1, 1)).toEqual({ qty: 1, costBasis: 0.02, avgPrice: 0.02 });
  });

  it("removes the whole cost when fully closed", () => {
    expect(applyFill({ qty: 5, costBasis: 125 }, "sell", 5, 40)).toEqual({ qty: 0, costBasis: 0, avgPrice: 0 });
  });

  it("closes instead of going negative on an oversell", () => {
    expect(applyFill({ qty: 5, costBasis: 125 }, "sell", 50, 40)).toEqual({ qty: 0, costBasis: 0, avgPrice: 0 });
  });

  it("ignores non-positive quantities", () => {
    const pos = { qty: 7, costBasis: 84 };
    expect(applyFill(pos, "buy", 0, 99)).toEqual({ ...pos, avgPrice: 12 });
    expect(applyFill(pos, "sell", -3, 99)).toEqual({ ...pos, avgPrice: 12 });
  });

  it("derives the average price to 4 decimals", () => {
    const after = applyFill({ qty: 1, costBasis: 1 }, "buy", 2, 2);
    expect(after.costBasis).toBe(5);
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
    expect(Object.is(unrealizedPnl(0, 20, 15), 0)).toBe(true);
    // Exact half cent rounds away from zero (float math gave 0.00 or 0.01 by luck).
    expect(unrealizedPnl(1, 1.005, 1.01)).toBe(0.01);
    expect(unrealizedPnl(1, 1.01, 1.005)).toBe(-0.01);
  });

  it("computes unrealized pnl from the exact cost basis", () => {
    expect(unrealizedFromCost(300_000, 3_001_000, 10.01)).toBe(2_000);
    expect(unrealizedFromCost(3, 30.01, 10)).toBe(-0.01);
  });

  it("expresses a P/L in percent of cost and guards a zero cost", () => {
    expect(pnlPct(10, 100)).toBe(10);
    expect(pnlPct(-5, 100)).toBe(-5);
    expect(pnlPct(1, 0)).toBeNull();
    expect(pnlPct(1, -3)).toBeNull();
  });

  it("computes allocation weights and guards zero totals", () => {
    expect(weight(25, 100)).toBe(25);
    expect(weight(1, 3)).toBe(33.33);
    expect(weight(10, 0)).toBe(0);
  });
});

describe("order quantity (K1: whole units)", () => {
  it("accepts positive integers up to the cap", () => {
    expect(isValidOrderQty(1)).toBe(true);
    expect(isValidOrderQty(250)).toBe(true);
    expect(isValidOrderQty(MAX_ORDER_QTY)).toBe(true);
  });

  it("rejects fractions, zero, negatives, overflow and non-numbers", () => {
    for (const bad of [0, -1, 1.5, 0.0001, MAX_ORDER_QTY + 1, Number.NaN, Infinity, "10", null, undefined]) {
      expect(isValidOrderQty(bad)).toBe(false);
    }
  });
});

describe("limit price (K1: > 0, tick 0.01)", () => {
  it("accepts whole cents, including values that are inexact in binary", () => {
    for (const ok of [0.01, 0.1, 1, 12.6, 100.07, 101.46, 0.83, 99999.99]) {
      expect(isValidLimitPrice(ok)).toBe(true);
    }
  });

  it("rejects sub-cent prices, zero, negatives and non-finite values", () => {
    for (const bad of [0, -1, 0.001, 0.005, 100.075, 100.001, Number.NaN, Infinity, "100", null]) {
      expect(isValidLimitPrice(bad)).toBe(false);
    }
  });
});

describe("parseOrderInput", () => {
  const base = { symbolSlug: "noo001", side: "buy", type: "limit", qty: 10, price: 100.5 };

  it("accepts a valid limit order", () => {
    expect(parseOrderInput(base)).toEqual(base);
  });

  it("drops the price of a market order", () => {
    expect(parseOrderInput({ ...base, type: "market", price: 123.456 })).toEqual({
      symbolSlug: "noo001",
      side: "buy",
      type: "market",
      qty: 10,
    });
  });

  it("throws stable codes instead of validation dumps", () => {
    expect(() => parseOrderInput({ ...base, qty: 1.5 })).toThrow(/^INVALID_QTY$/);
    expect(() => parseOrderInput({ ...base, qty: -5 })).toThrow(/^INVALID_QTY$/);
    expect(() => parseOrderInput({ ...base, qty: "5" })).toThrow(/^INVALID_QTY$/);
    expect(() => parseOrderInput({ ...base, price: 100.123 })).toThrow(/^INVALID_PRICE$/);
    expect(() => parseOrderInput({ ...base, price: undefined })).toThrow(/^INVALID_PRICE$/);
    expect(() => parseOrderInput({ ...base, symbolSlug: "a,b)" })).toThrow(/^INSTRUMENT_NOT_FOUND$/);
    expect(() => parseOrderInput({ ...base, symbolSlug: "" })).toThrow(/^INSTRUMENT_NOT_FOUND$/);
    expect(() => parseOrderInput({ ...base, side: "short" })).toThrow(/^INVALID_INPUT$/);
    expect(() => parseOrderInput(null)).toThrow();
  });
});

describe("parseOrderIdInput / parseModifyInput", () => {
  const id = "3f1d6a5e-2b1c-4c8e-9a47-0c2f5d8e1b7a";

  it("accepts a uuid order id", () => {
    expect(parseOrderIdInput({ orderId: id })).toEqual({ orderId: id });
  });

  it("reads a malformed order id as ORDER_NOT_OPEN", () => {
    expect(() => parseOrderIdInput({ orderId: "1 OR 1=1" })).toThrow(/^ORDER_NOT_OPEN$/);
    expect(() => parseOrderIdInput(undefined)).toThrow(/^ORDER_NOT_OPEN$/);
  });

  it("validates the new price and quantity of a modify", () => {
    expect(parseModifyInput({ orderId: id, price: 101.5, qty: 20 })).toEqual({ orderId: id, price: 101.5, qty: 20 });
    expect(() => parseModifyInput({ orderId: id, price: 101.5, qty: 2.5 })).toThrow(/^INVALID_QTY$/);
    expect(() => parseModifyInput({ orderId: id, price: 101.555, qty: 2 })).toThrow(/^INVALID_PRICE$/);
  });
});

describe("tradingErrorCode", () => {
  it("passes through engine codes", () => {
    expect(tradingErrorCode("INSUFFICIENT_CASH")).toBe("INSUFFICIENT_CASH");
    expect(tradingErrorCode("ORDER_NOT_OPEN")).toBe("ORDER_NOT_OPEN");
    expect(tradingErrorCode(" SHARIAH_BLOCKED ")).toBe("SHARIAH_BLOCKED");
    expect(tradingErrorCode("SELF_TRADE")).toBe("SELF_TRADE");
  });

  it("never leaks raw database text", () => {
    expect(tradingErrorCode('duplicate key value violates unique constraint "orders_pkey"')).toBe("INTERNAL_ERROR");
    expect(tradingErrorCode("permission denied for table orders")).toBe("INTERNAL_ERROR");
    expect(tradingErrorCode("SOME_OTHER_CODE")).toBe("INTERNAL_ERROR");
    expect(tradingErrorCode(undefined)).toBe("INTERNAL_ERROR");
  });
});

describe("toEngineResult", () => {
  it("normalizes a match_order row", () => {
    expect(
      toEngineResult([{ order_id: "o1", filled_qty: "150.0000", avg_price: "100.6667", status: "filled" }]),
    ).toEqual({ orderId: "o1", status: "filled", filledQty: 150, filledPrice: 100.6667 });
  });

  it("reports an unfilled market order as cancelled with filledQty 0", () => {
    expect(toEngineResult([{ order_id: "o2", filled_qty: 0, avg_price: null, status: "cancelled" }])).toEqual({
      orderId: "o2",
      status: "cancelled",
      filledQty: 0,
      filledPrice: null,
    });
  });

  it("returns null when the engine returned no row", () => {
    expect(toEngineResult([])).toBeNull();
    expect(toEngineResult(null)).toBeNull();
  });
});
