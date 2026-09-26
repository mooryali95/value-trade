import { describe, expect, it } from "vitest";
import { z } from "zod";
import { browserErrorCode, toBrowserError } from "./browser-error";

describe("toBrowserError", () => {
  it("keeps stable codes as they are", () => {
    const e = new Error("INSUFFICIENT_CASH");
    expect(toBrowserError(e)).toBe(e);
    expect(browserErrorCode("RATE_LIMITED")).toBe("RATE_LIMITED");
  });

  it("maps the auth middleware's sentences to NOT_AUTHENTICATED", () => {
    for (const m of [
      "Unauthorized: No authorization header provided",
      "Unauthorized: Invalid token",
      "Unauthorized: Only Bearer tokens are supported",
    ]) {
      expect((toBrowserError(new Error(m)) as Error).message).toBe("NOT_AUTHENTICATED");
    }
  });

  it("maps validator issue dumps to INVALID_INPUT", () => {
    const parsed = z.object({ email: z.string().email() }).safeParse({ email: "nope" });
    expect(parsed.success).toBe(false);
    const zodError = parsed.success ? null : parsed.error;
    expect((toBrowserError(zodError) as Error).message).toBe("INVALID_INPUT");
    const dump = JSON.stringify([{ validation: "email", code: "invalid_string", message: "Invalid email", path: ["email"] }]);
    expect((toBrowserError(new Error(dump)) as Error).message).toBe("INVALID_INPUT");
  });

  it("hides any other text behind INTERNAL_ERROR", () => {
    expect((toBrowserError(new Error('relation "x" does not exist')) as Error).message).toBe("INTERNAL_ERROR");
    expect((toBrowserError(new Error("Missing Supabase environment variable(s): SUPABASE_URL")) as Error).message).toBe("INTERNAL_ERROR");
  });

  it("passes redirects and not-found results through", () => {
    const redirect = { isRedirect: true, to: "/auth" };
    const notFound = { isNotFound: true };
    expect(toBrowserError(redirect)).toBe(redirect);
    expect(toBrowserError(notFound)).toBe(notFound);
  });
});
