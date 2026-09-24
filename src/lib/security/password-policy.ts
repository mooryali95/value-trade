/**
 * Client-side password rules, checked before Supabase Auth is called so the
 * user gets a precise message in their language. Supabase enforces its own
 * policy (minimum length, character classes, leaked-password check) on the
 * server; its refusals are mapped by auth-errors.ts.
 */

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt ignores everything after 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;

export type PasswordIssue =
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_NEEDS_LETTER_AND_DIGIT"
  | "PASSWORD_HAS_SPACES_AT_ENDS"
  | "PASSWORD_MISMATCH";

/** First rule `password` breaks, or null when it passes. */
export function passwordIssue(password: string, confirm?: string): PasswordIssue | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "PASSWORD_TOO_SHORT";
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return "PASSWORD_TOO_LONG";
  if (password !== password.trim()) return "PASSWORD_HAS_SPACES_AT_ENDS";
  if (!/\p{L}/u.test(password) || !/\p{Nd}/u.test(password)) return "PASSWORD_NEEDS_LETTER_AND_DIGIT";
  if (confirm !== undefined && password !== confirm) return "PASSWORD_MISMATCH";
  return null;
}

/**
 * Authentication methods recorded in a Supabase access token (`amr` claim).
 * A password may be set without the current one only right after the user
 * proved control of their mailbox: a recovery link, an invitation link or
 * a one-time e-mail link.
 */
const MAILBOX_METHODS = new Set(["recovery", "invite", "magiclink", "otp"]);
/** How long after such a link the password can be set without the old one. */
export const RECOVERY_WINDOW_SECONDS = 60 * 60;

type AmrEntry = { method?: unknown; timestamp?: unknown } | string;

/** Decodes the payload of a JWT without verifying it (display logic only). */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json =
      typeof atob === "function"
        ? decodeURIComponent(
            Array.from(atob(b64), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
          )
        : Buffer.from(b64, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * True when the session behind `accessToken` was opened from a mailbox link
 * (recovery / invite / magic link / e-mail OTP) less than an hour ago. The
 * server still decides: this only chooses which form to show.
 */
export function openedFromMailboxLink(accessToken: string | null | undefined, nowSeconds = Date.now() / 1000): boolean {
  const payload = decodeJwtPayload(accessToken);
  const amr = payload?.amr;
  if (!Array.isArray(amr)) return false;
  return (amr as AmrEntry[]).some((entry) => {
    if (typeof entry === "string") return false; // no timestamp: cannot tell how recent
    const method = typeof entry.method === "string" ? entry.method : "";
    const ts = typeof entry.timestamp === "number" ? entry.timestamp : NaN;
    return MAILBOX_METHODS.has(method) && Number.isFinite(ts) && nowSeconds - ts <= RECOVERY_WINDOW_SECONDS && ts - nowSeconds < 300;
  });
}

/** Whether the account has an e-mail/password identity (vs. Google only). */
export function hasPasswordIdentity(user: { identities?: Array<{ provider?: string }> | null; app_metadata?: { providers?: unknown } } | null | undefined): boolean {
  if (!user) return false;
  if (Array.isArray(user.identities) && user.identities.some((i) => i?.provider === "email")) return true;
  const providers = user.app_metadata?.providers;
  return Array.isArray(providers) && providers.includes("email");
}
