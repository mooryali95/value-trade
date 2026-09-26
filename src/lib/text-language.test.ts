import { describe, expect, it } from "vitest";
import { textLanguage } from "./text-language";

describe("textLanguage", () => {
  it("tells Arabic from English text", () => {
    expect(textLanguage("ملاحظة: النشاط مباح ولا توجد إيرادات محرّمة جوهرية.")).toBe("ar");
    expect(textLanguage("40% revenue from interest-bearing financing")).toBe("en");
    expect(textLanguage("SMPA · النشاط مباح")).toBe("ar");
    expect(textLanguage("123 — 456")).toBeNull();
  });
});
