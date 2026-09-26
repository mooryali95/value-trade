import { describe, it, expect } from "vitest";
import { auditDetailItems, humanizeKey } from "./audit-details";
import { ar } from "@/lib/i18n/ar";

describe("auditDetailItems", () => {
  it("labels known keys and translates known values", () => {
    const items = auditDetailItems({ symbol: "SMPA", changed: true, cancelledOrders: 0, role: "finance", status: "non_halal" });
    expect(items).toEqual([
      { key: "symbol", label: "e2_colSymbol", value: { type: "ltr", text: "SMPA" } },
      { key: "status", label: "fl_auditKey_status", value: { type: "label", key: "e2_shariahNonHalal" } },
      { key: "changed", label: "fl_auditKey_changed", value: { type: "label", key: "fl_yes" } },
      { key: "cancelledOrders", label: "fl_auditKey_cancelledOrders", value: { type: "number", value: 0, kind: "qty" } },
      { key: "role", label: "role", value: { type: "label", key: "r_roleFinance" } },
    ]);
  });

  it("shows the symbol first and 'from' before 'to', whatever the stored key order", () => {
    expect(auditDetailItems({ to: "finance", targetUserId: "x", from: "viewer" }).map((i) => i.key)).toEqual(["from", "to", "targetUserId"]);
  });

  it("reads nested objects as nested items and ids as short identifiers", () => {
    const [from, sub] = auditDetailItems({
      from: { name_ar: "علامة", name_en: "Brand", sector: "retail" },
      submissionId: "3f2a9c1b-1111-4222-8333-444455556666",
    });
    expect(from.value).toEqual({
      type: "group",
      items: [
        { key: "name_ar", label: "nameAr", value: { type: "text", text: "علامة" } },
        { key: "name_en", label: "nameEn", value: { type: "text", text: "Brand" } },
        { key: "sector", label: "sector", value: { type: "sector", sector: "retail" } },
      ],
    });
    expect(sub.value).toEqual({ type: "id", id: "3f2a9c1b-1111-4222-8333-444455556666" });
  });

  it("keeps unknown keys and values readable, never a JSON dump at the top level", () => {
    expect(auditDetailItems({ someNewField: "value" })).toEqual([
      { key: "someNewField", label: null, value: { type: "text", text: "value" } },
    ]);
    expect(humanizeKey("someNewField")).toBe("some new field");
    expect(auditDetailItems(null)).toEqual([]);
    expect(auditDetailItems({})).toEqual([]);
  });

  it("every label key exists in the dictionary", () => {
    const meta = {
      symbol: "A", brandSymbol: "A", slug: "a", status: "halal", previousStatus: "halal", previousRuling: "halal",
      changeReason: "x", reason: "x", changed: false, cancelledOrders: 1, from: 1, to: 2, referencePrice: 1, price: 1,
      qty: 1, amount: 1, submissionId: "x", issuanceId: "x", holderId: "x", rulingRecorded: true, rulingId: "x",
      brandId: "x", targetUserId: "x", invitationId: "x", role: "owner", email: "a@b.c", emailSent: true,
      accountExists: false, kind: "investor", name_ar: "x", name_en: "x", sector: "x",
    };
    for (const it of auditDetailItems(meta)) {
      expect(it.label, it.key).not.toBeNull();
      expect(Object.prototype.hasOwnProperty.call(ar, it.label!), it.key).toBe(true);
      if (it.value.type === "label") expect(Object.prototype.hasOwnProperty.call(ar, it.value.key), it.key).toBe(true);
    }
  });
});
