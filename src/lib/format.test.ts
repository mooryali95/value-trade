import { describe, expect, it } from "vitest";
import { cleanZero, formatCurrency, formatInt, formatPct, isolateLtr } from "./format";
import { formatNum } from "@/components/num";

describe("formatCurrency", () => {
  it("groups and keeps two decimals, Latin digits in both languages", () => {
    expect(formatCurrency(1234.5)).toBe("1,234.50");
    expect(formatCurrency(1234.5, false, "ar")).toBe("1,234.50");
    expect(formatCurrency(1234.5, false, "en")).toBe("1,234.50");
    expect(formatCurrency(-1234.56)).toBe("-1,234.56");
    expect(formatCurrency(5_000_000)).toBe("5,000,000.00");
  });

  it("never shows a negative zero", () => {
    expect(formatCurrency(-0.004)).toBe("0.00");
    expect(formatCurrency(-0)).toBe("0.00");
    expect(formatCurrency(-0.005)).toBe("-0.01");
  });

  it("compact notation", () => {
    expect(formatCurrency(1_234_567, true, "ar")).toBe("1.23M");
    expect(formatCurrency(-0.001, true)).toBe("0");
  });
});

describe("formatPct: the argument is already in percent", () => {
  it("12.5 means 12.50%, and positives are signed", () => {
    expect(formatPct(12.5)).toBe("+12.50%");
    expect(formatPct(-3)).toBe("-3.00%");
    expect(formatPct(0.1)).toBe("+0.10%");
    expect(formatPct(1234.5)).toBe("+1234.50%");
  });

  it("no sign on values that round to zero, and a dash when not finite", () => {
    expect(formatPct(-0.001)).toBe("0.00%");
    expect(formatPct(0.004)).toBe("0.00%");
    expect(formatPct(0)).toBe("0.00%");
    expect(formatPct(Number.NaN)).toBe("—");
    expect(formatPct(Infinity)).toBe("—");
  });

  it("custom decimals", () => {
    expect(formatPct(33.333, 1)).toBe("+33.3%");
  });
});

describe("formatInt and helpers", () => {
  it("groups whole numbers", () => {
    expect(formatInt(10_000_000)).toBe("10,000,000");
    expect(formatInt(10_000_000, true)).toBe("10M");
    expect(formatInt(-0.0001)).toBe("0");
  });

  it("cleanZero only zeroes values that round to zero", () => {
    expect(Object.is(cleanZero(-0.004), 0)).toBe(true);
    expect(cleanZero(-0.006)).toBe(-0.006);
    expect(cleanZero(-0.00004, 4)).toBe(0);
  });

  it("isolateLtr wraps in LRI/PDI", () => {
    expect(isolateLtr("-1.00")).toBe("⁦-1.00⁩");
  });
});

describe("formatNum (what <Num> renders)", () => {
  it("kinds and signs", () => {
    expect(formatNum(1234.5, "currency")).toBe("1,234.50");
    expect(formatNum(-1234.5, "currency", { signed: true })).toBe("-1,234.50");
    expect(formatNum(12.5, "currency", { signed: true })).toBe("+12.50");
    expect(formatNum(10.0033, "number", { decimals: 4 })).toBe("10.0033");
    expect(formatNum(12, "number")).toBe("12.00");
    expect(formatNum(300000, "qty")).toBe("300,000");
    expect(formatNum(2.5, "qty")).toBe("2.5");
    expect(formatNum(10, "pct")).toBe("10.00%");
    expect(formatNum(10, "pct", { signed: true })).toBe("+10.00%");
    expect(formatNum(-10, "pct")).toBe("-10.00%");
  });

  it("a dash for missing values and never a negative zero", () => {
    expect(formatNum(null)).toBe("—");
    expect(formatNum(undefined, "currency")).toBe("—");
    expect(formatNum(Number.NaN, "pct")).toBe("—");
    expect(formatNum(-0, "currency", { signed: true })).toBe("0.00");
    expect(formatNum(-0.001, "currency", { signed: true })).toBe("0.00");
    expect(formatNum(-0.001, "pct", { signed: true })).toBe("0.00%");
  });
});
