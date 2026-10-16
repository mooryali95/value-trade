import { describe, expect, it } from "vitest";
import { validateOfferingDetails } from "./offering-schema";

const base = { summary: "s", issue_size_units: "1000", offering_price: "10", risk_factors: "r" };

describe("offering details", () => {
  it("sukuk requires a maturity date", () => {
    expect(() => validateOfferingDetails("sukuk", { ...base, sukuk_structure: "Ijara", profit_rate_pct: "5" })).toThrow("INVALID_INPUT");
  });
  it("accepts a complete fund offering", () => {
    expect(validateOfferingDetails("fund", { ...base, fund_manager: "X", fund_type: "open" }).fund_manager).toBe("X");
  });
  it("rejects fields from another class", () => {
    expect(() => validateOfferingDetails("stock", { ...base, nominal_value: "10", shares_outstanding: "5", fund_manager: "X" })).toThrow("INVALID_INPUT");
  });
  it("brand units stay optional", () => {
    expect(validateOfferingDetails("brand", {})).toEqual({});
  });
});
