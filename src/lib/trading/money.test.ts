import { describe, expect, it } from "vitest";
import {
  centsToFixed,
  centsToNumber,
  mulCents,
  prorataCents,
  qty4ToNumber,
  roundDivHalfAway,
  roundMoney,
  toCents,
  toQty4,
  toScaled,
} from "./money";

describe("roundDivHalfAway (PostgreSQL round() semantics)", () => {
  it("rounds halves away from zero in both directions", () => {
    expect(roundDivHalfAway(5n, 2n)).toBe(3n);
    expect(roundDivHalfAway(-5n, 2n)).toBe(-3n);
    expect(roundDivHalfAway(5n, -2n)).toBe(-3n);
    expect(roundDivHalfAway(4n, 3n)).toBe(1n);
    expect(roundDivHalfAway(-4n, 3n)).toBe(-1n);
    expect(roundDivHalfAway(0n, 7n)).toBe(0n);
  });

  it("refuses a zero divisor", () => {
    expect(() => roundDivHalfAway(1n, 0n)).toThrow(RangeError);
  });
});

describe("toScaled / toCents / toQty4", () => {
  it("reads numbers and numeric strings as the decimal they print as", () => {
    expect(toCents(1.005)).toBe(101n); // the printed decimal 1.005, not the binary 1.00499...
    expect(toCents("1.005")).toBe(101n);
    expect(toCents("-1.005")).toBe(-101n);
    expect(toCents("3001000.00")).toBe(300100000n);
    expect(toCents(0.1 + 0.2)).toBe(30n);
    expect(toQty4("300000.0000")).toBe(3000000000n);
    expect(toScaled("10.00333333", 4)).toBe(100033n);
    expect(toScaled(1e-7, 4)).toBe(0n);
    expect(toScaled("-0", 2)).toBe(0n);
  });

  it("returns null for anything that is not a finite decimal", () => {
    for (const bad of [null, undefined, Number.NaN, Infinity, "abc", "1e5", "", "1.2.3", 1e21]) {
      expect(toCents(bad as never)).toBeNull();
    }
  });
});

describe("mulCents = round(qty x price, 2), the ledger amount of a fill", () => {
  it("matches hand-computed fills", () => {
    expect(mulCents(100_000, 10.01)).toBe(100_100_000n);
    expect(mulCents(99_999, 10.02)).toBe(100_198_998n); // 1,001,989.98
    expect(mulCents(3, 1.005)).toBe(302n); // 3.015 -> 3.02 (half away from zero)
    expect(mulCents(1, 0.01)).toBe(1n);
  });
});

describe("prorataCents = money_prorata(amount, part, whole)", () => {
  const q = (n: number) => toQty4(n) as bigint;
  it("rounds the share of the cost half away from zero, like the SQL helper", () => {
    expect(prorataCents(201n, q(1), q(2))).toBe(101n); // 1.005 -> 1.01
    expect(prorataCents(3001n, q(1), q(3))).toBe(1000n); // 10.0033 -> 10.00
    expect(prorataCents(2001n, q(1), q(2))).toBe(1001n); // 10.005 -> 10.01
    expect(prorataCents(-201n, q(1), q(2))).toBe(-101n);
    expect(prorataCents(5n, q(1), q(3))).toBe(2n); // 0.0167 -> 0.02
    expect(prorataCents(300099000n, q(99_999), q(299_999))).toBe(100032333n); // 1,000,323.33
    expect(prorataCents(123n, q(1), 0n)).toBe(0n);
  });
});

describe("conversions never produce -0", () => {
  it("centsToNumber / qty4ToNumber / roundMoney", () => {
    expect(Object.is(centsToNumber(0n), 0)).toBe(true);
    expect(Object.is(centsToNumber(-0n), 0)).toBe(true);
    expect(Object.is(qty4ToNumber(0n), 0)).toBe(true);
    expect(Object.is(roundMoney(-0.004), 0)).toBe(true);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(Number.NaN)).toBe(0);
    expect(centsToNumber(300100000n)).toBe(3_001_000);
  });

  it("centsToFixed prints exact two-decimal strings", () => {
    expect(centsToFixed(0n)).toBe("0.00");
    expect(centsToFixed(-5n)).toBe("-0.05");
    expect(centsToFixed(-99997n)).toBe("-999.97");
    expect(centsToFixed(300000003n)).toBe("3000000.03");
  });
});
