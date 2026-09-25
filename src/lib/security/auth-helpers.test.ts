import { afterEach, describe, expect, it } from "vitest";
import { authErrorCode, authRedirectErrorCode, hasAuthRedirectParams, AUTH_ERROR_CODES } from "./auth-errors";
import { hasPasswordIdentity, openedFromMailboxLink, passwordIssue } from "./password-policy";
import { clearPostAuthRedirect, consumePostAuthRedirect, safeRedirect, stashPostAuthRedirect } from "./redirect";

describe("safeRedirect", () => {
  it("keeps same-origin paths with their query and hash", () => {
    expect(safeRedirect("/portfolio")).toBe("/portfolio");
    expect(safeRedirect("/invite/0b0c?x=1#top")).toBe("/invite/0b0c?x=1#top");
  });

  it.each([
    undefined,
    null,
    42,
    "",
    "   ",
    "portfolio",
    "https://evil.example/x",
    "//evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "/%09/evil.example".replace("%09", "\t"),
    "/foo\nbar",
    "/" + "a".repeat(2100),
  ])("rejects %j", (target) => {
    expect(safeRedirect(target)).toBe("/");
  });

  it("never sends the user back to the sign-in page itself", () => {
    expect(safeRedirect("/auth?redirect=/auth")).toBe("/");
    expect(safeRedirect("/auth/update-password")).toBe("/auth/update-password");
  });

  it("uses the given fallback", () => {
    expect(safeRedirect("//x", "")).toBe("");
  });
});

describe("post-auth redirect stash", () => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { sessionStorage?: Storage };
  g.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  afterEach(() => store.clear());

  it("round-trips a safe target exactly once", () => {
    stashPostAuthRedirect("/invite/abc");
    expect(consumePostAuthRedirect()).toBe("/invite/abc");
    expect(consumePostAuthRedirect()).toBeNull();
  });

  it("ignores unsafe or trivial targets", () => {
    stashPostAuthRedirect("//evil.example");
    expect(consumePostAuthRedirect()).toBeNull();
    stashPostAuthRedirect("/");
    expect(consumePostAuthRedirect()).toBeNull();
  });

  it("expires after 30 minutes and rejects tampered entries", () => {
    stashPostAuthRedirect("/invitations");
    expect(consumePostAuthRedirect(Date.now() + 31 * 60 * 1000)).toBeNull();
    store.set("vu_post_auth_redirect", JSON.stringify({ to: "https://evil.example", at: Date.now() }));
    expect(consumePostAuthRedirect()).toBeNull();
    store.set("vu_post_auth_redirect", "not json");
    expect(consumePostAuthRedirect()).toBeNull();
  });

  it("is cleared on sign-out", () => {
    stashPostAuthRedirect("/invitations");
    clearPostAuthRedirect();
    expect(consumePostAuthRedirect()).toBeNull();
  });
});

describe("authErrorCode", () => {
  it.each([
    [{ code: "invalid_credentials", message: "Invalid login credentials", status: 400 }, "AUTH_INVALID_CREDENTIALS"],
    [{ message: "Invalid login credentials", status: 400 }, "AUTH_INVALID_CREDENTIALS"],
    [{ code: "email_not_confirmed", message: "Email not confirmed" }, "AUTH_EMAIL_NOT_CONFIRMED"],
    [{ code: "weak_password", message: "Password should be at least 8 characters.", reasons: ["length"] }, "AUTH_WEAK_PASSWORD"],
    [{ name: "AuthWeakPasswordError", message: "Password is known to be weak and easy to guess, please choose a different one.", reasons: ["pwned"] }, "AUTH_LEAKED_PASSWORD"],
    [{ code: "same_password", message: "New password should be different from the old password." }, "AUTH_SAME_PASSWORD"],
    [{ status: 429, message: "Request rate limit reached" }, "AUTH_RATE_LIMITED"],
    [{ code: "over_email_send_rate_limit", message: "Email rate limit exceeded" }, "AUTH_RATE_LIMITED"],
    [{ message: "For security purposes, you can only request this after 42 seconds." }, "AUTH_RATE_LIMITED"],
    [{ code: "user_already_exists", message: "User already registered" }, "AUTH_USER_EXISTS"],
    [{ code: "otp_expired", message: "Email link is invalid or has expired" }, "AUTH_LINK_EXPIRED"],
    [{ code: "signup_disabled", message: "Signups not allowed for this instance" }, "AUTH_SIGNUP_DISABLED"],
    [{ message: "Popup was blocked" }, "AUTH_POPUP_BLOCKED"],
    [{ message: "This flow is not supported in Preview mode. Please open the app in a new tab to sign in." }, "AUTH_OAUTH_NEW_TAB"],
    [{ message: "State is invalid" }, "AUTH_OAUTH_FAILED"],
    [{ name: "AuthSessionMissingError", message: "Auth session missing!" }, "AUTH_SESSION_MISSING"],
    [{ name: "AuthRetryableFetchError", message: "Failed to fetch" }, "AUTH_NETWORK"],
    [{ code: "user_banned", message: "User is banned" }, "AUTH_USER_BANNED"],
    [new Error("AUTH_LINK_EXPIRED"), "AUTH_LINK_EXPIRED"],
    [{ message: "something nobody expected" }, "AUTH_FAILED"],
    [null, "AUTH_FAILED"],
  ])("maps %j to %s", (error, code) => {
    expect(authErrorCode(error)).toBe(code);
  });

  it("never returns provider text", () => {
    for (const e of [{ message: "Database error saving new user" }, "boom", { code: "unexpected_failure" }]) {
      expect(AUTH_ERROR_CODES).toContain(authErrorCode(e));
    }
  });
});

describe("authRedirectErrorCode", () => {
  it("reads errors Supabase appends to an e-mail link redirect", () => {
    expect(authRedirectErrorCode("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")).toBe(
      "AUTH_LINK_EXPIRED",
    );
    expect(authRedirectErrorCode("?error=access_denied")).toBe("AUTH_LINK_EXPIRED");
    expect(authRedirectErrorCode("#error=server_error&error_description=Unable+to+exchange+external+code")).toBe("AUTH_FAILED");
  });

  it("is null without an error", () => {
    expect(authRedirectErrorCode("")).toBeNull();
    expect(authRedirectErrorCode("#access_token=x&type=recovery")).toBeNull();
    expect(hasAuthRedirectParams("#access_token=x&type=recovery")).toBe(true);
    expect(hasAuthRedirectParams("?tab=orders")).toBe(false);
  });
});

describe("password policy", () => {
  it.each([
    ["short1", undefined, "PASSWORD_TOO_SHORT"],
    ["abcdefgh", undefined, "PASSWORD_NEEDS_LETTER_AND_DIGIT"],
    ["12345678", undefined, "PASSWORD_NEEDS_LETTER_AND_DIGIT"],
    [" abcdefg1", undefined, "PASSWORD_HAS_SPACES_AT_ENDS"],
    ["a1".repeat(40), undefined, "PASSWORD_TOO_LONG"],
    ["كلمةسر2026", undefined, null],
    ["correct horse 7", "correct horse 8", "PASSWORD_MISMATCH"],
    ["correct horse 7", "correct horse 7", null],
  ])("%j / %j -> %s", (pw, confirm, issue) => {
    expect(passwordIssue(pw, confirm)).toBe(issue);
  });

  it("counts bytes, not characters, against bcrypt's 72-byte limit", () => {
    // 37 Arabic letters (2 bytes each) + a digit = 75 bytes.
    expect(passwordIssue("ب".repeat(37) + "1")).toBe("PASSWORD_TOO_LONG");
  });
});

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

describe("openedFromMailboxLink", () => {
  const now = 1_800_000_000;
  it("accepts a recent recovery or invitation sign-in", () => {
    expect(openedFromMailboxLink(jwt({ amr: [{ method: "recovery", timestamp: now - 60 }] }), now)).toBe(true);
    expect(openedFromMailboxLink(jwt({ amr: [{ method: "invite", timestamp: now - 3000 }] }), now)).toBe(true);
  });

  it("rejects password or OAuth sessions, stale links and junk", () => {
    expect(openedFromMailboxLink(jwt({ amr: [{ method: "password", timestamp: now - 10 }] }), now)).toBe(false);
    expect(openedFromMailboxLink(jwt({ amr: [{ method: "oauth", timestamp: now - 10 }] }), now)).toBe(false);
    expect(openedFromMailboxLink(jwt({ amr: [{ method: "recovery", timestamp: now - 7200 }] }), now)).toBe(false);
    expect(openedFromMailboxLink(jwt({ amr: ["recovery"] }), now)).toBe(false);
    expect(openedFromMailboxLink("not-a-jwt", now)).toBe(false);
    expect(openedFromMailboxLink(null, now)).toBe(false);
  });
});

describe("hasPasswordIdentity", () => {
  it("tells e-mail accounts from Google-only ones", () => {
    expect(hasPasswordIdentity({ identities: [{ provider: "email" }] })).toBe(true);
    expect(hasPasswordIdentity({ identities: [{ provider: "google" }] })).toBe(false);
    expect(hasPasswordIdentity({ identities: [], app_metadata: { providers: ["google", "email"] } })).toBe(true);
    expect(hasPasswordIdentity(null)).toBe(false);
  });
});

describe("every auth and onboarding code has a translated message", () => {
  it("maps each code to a key present in both dictionaries", async () => {
    const { errorMessageKey } = await import("@/hooks/use-error-message");
    const { en } = await import("@/lib/i18n/en");
    const { ar } = await import("@/lib/i18n/ar");
    const codes = [
      ...AUTH_ERROR_CODES,
      "PASSWORD_TOO_SHORT",
      "PASSWORD_TOO_LONG",
      "PASSWORD_NEEDS_LETTER_AND_DIGIT",
      "PASSWORD_HAS_SPACES_AT_ENDS",
      "PASSWORD_MISMATCH",
      "ALREADY_MEMBER",
      "EMAIL_NOT_CONFIRMED",
      "EMAIL_SEND_FAILED",
      "INVITATION_EXPIRED",
      "INVITATION_NOT_FOUND",
      "INVITATION_NOT_PENDING",
      "INVITATION_NOT_REVOKED",
      "INVITATION_EMAIL_MISMATCH",
      "INVITATION_ALREADY_PENDING",
      "NOT_AUTHENTICATED",
      "RATE_LIMITED",
      "REQUEST_NOT_PENDING",
      "REQUEST_NOT_FOUND",
      "SLUG_TAKEN",
      "SLUG_AND_SECTOR_REQUIRED",
      "ROLE_REQUIRED",
      "FORBIDDEN",
      "FORBIDDEN_ADMIN_REQUIRED",
    ];
    for (const code of codes) {
      const key = errorMessageKey(code);
      expect(key, code).toBeTruthy();
      expect((en as Record<string, string>)[key!], `${code} en`).toBeTruthy();
      expect((ar as Record<string, string>)[key!], `${code} ar`).toBeTruthy();
    }
  });
});
