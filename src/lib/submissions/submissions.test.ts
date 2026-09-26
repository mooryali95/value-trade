import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { _middleware: true, server: () => ({}) },
}));

import { lifecycleError, parseListingInput, parseReviewInput } from "./submissions.functions";

const SUB = "7a1d6a5e-2b1c-4c8e-9a47-0c2f5d8e1b7a";
const USER = "3f1d6a5e-2b1c-4c8e-9a47-0c2f5d8e1b7a";

describe("listing approval input", () => {
  it("needs a real reference price on the 0.01 tick, at least 0.05", () => {
    expect(parseListingInput({ submissionId: SUB, referencePrice: 12.5 })).toEqual({ submissionId: SUB, referencePrice: 12.5 });
    for (const p of [0, 0.04, 10.005, -1, Number.NaN, "12", 1_000_000_001]) {
      expect(() => parseListingInput({ submissionId: SUB, referencePrice: p })).toThrow(/^INVALID_PRICE$/);
    }
    expect(() => parseListingInput({ submissionId: "x", referencePrice: 10 })).toThrow(/^SUBMISSION_NOT_FOUND$/);
  });

  it("a first allocation needs a holder and whole units; the issue price is optional", () => {
    expect(parseListingInput({ submissionId: SUB, referencePrice: 10, holderId: USER, qty: 1000 })).toEqual({
      submissionId: SUB,
      referencePrice: 10,
      holderId: USER,
      qty: 1000,
    });
    expect(parseListingInput({ submissionId: SUB, referencePrice: 10, holderId: USER, qty: 5, issuePrice: 9.5, note: "  seed  " })).toMatchObject({
      issuePrice: 9.5,
      note: "seed",
    });
    expect(() => parseListingInput({ submissionId: SUB, referencePrice: 10, holderId: USER, qty: 1.5 })).toThrow(/^INVALID_QTY$/);
    expect(() => parseListingInput({ submissionId: SUB, referencePrice: 10, holderId: "nope", qty: 1 })).toThrow(/^USER_NOT_FOUND$/);
    expect(() => parseListingInput({ submissionId: SUB, referencePrice: 10, qty: 5 })).toThrow(/^INVALID_INPUT$/);
    expect(() => parseListingInput({ submissionId: SUB, referencePrice: 10, holderId: USER, qty: 5, issuePrice: 0 })).toThrow(/^INVALID_PRICE$/);
  });
});

describe("Shariah review input", () => {
  it("a rejection carries a reason of 10+ characters", () => {
    expect(() => parseReviewInput({ submissionId: SUB, status: "rejected", reason: "too short" })).toThrow(/^REJECTION_REASON_REQUIRED$/);
    expect(parseReviewInput({ submissionId: SUB, status: "rejected", reason: "Documents are incomplete." }).status).toBe("rejected");
    expect(parseReviewInput({ submissionId: SUB, status: "approved", replaceRuling: true }).replaceRuling).toBe(true);
    expect(() => parseReviewInput({ submissionId: SUB, status: "listed" })).toThrow(/^INVALID_INPUT$/);
  });
});

describe("database errors reaching the browser", () => {
  it("lifecycle codes pass through; anything else is a stable code", () => {
    expect(lifecycleError("t", { message: "SHARIAH_NOT_HALAL" }).message).toBe("SHARIAH_NOT_HALAL");
    expect(lifecycleError("t", { message: "duplicate key", code: "23505" }).message).toBe("SYMBOL_TAKEN");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(lifecycleError("t", { message: 'permission denied for table brands', code: "42501" }).message).toBe("INTERNAL_ERROR");
    spy.mockRestore();
  });
});
