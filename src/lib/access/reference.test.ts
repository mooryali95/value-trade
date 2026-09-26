import { describe, expect, it } from "vitest";
import { normalizeReference } from "./reference";

describe("normalizeReference", () => {
  it.each([
    ["VU-7KQ2-M9XD", "VU-7KQ2-M9XD"],
    ["vu-7kq2-m9xd", "VU-7KQ2-M9XD"],
    [" vu 7kq2 m9xd ", "VU-7KQ2-M9XD"],
    ["7KQ2M9XD", "VU-7KQ2-M9XD"],
    ["VU7KQ2M9XD", "VU-7KQ2-M9XD"],
    ["3F2504E0-4F89-11D3-9A0C-0305E82C3301", "3f2504e0-4f89-11d3-9a0c-0305e82c3301"],
  ])("%j -> %s", (input, out) => {
    expect(normalizeReference(input)).toBe(out);
  });

  it.each(["", "VU-7KQ2", "VU-7KQ2-M9XDZ", "VU-0OQ2-M9XD", "VU-1IQ2-M9XD", "VU-7KQ2-M9X%", "not a reference"])("rejects %j", (input) => {
    expect(normalizeReference(input)).toBeNull();
  });
});
