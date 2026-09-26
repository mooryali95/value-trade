/**
 * Supabase Auth (and the Google sign-in broker) report failures with English
 * text such as "Invalid login credentials" or "Password is known to be weak
 * and easy to guess". None of that text reaches the page: every failure is
 * reduced to a stable UPPER_SNAKE code that src/hooks/use-error-message.ts
 * maps to an Arabic / English message.
 */

export const AUTH_ERROR_CODES = [
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_EMAIL_NOT_CONFIRMED",
  "AUTH_WEAK_PASSWORD",
  "AUTH_LEAKED_PASSWORD",
  "AUTH_SAME_PASSWORD",
  "AUTH_RATE_LIMITED",
  "AUTH_USER_EXISTS",
  "AUTH_LINK_EXPIRED",
  "AUTH_OAUTH_CANCELLED",
  "AUTH_POPUP_BLOCKED",
  "AUTH_OAUTH_NEW_TAB",
  "AUTH_OAUTH_FAILED",
  "AUTH_SESSION_MISSING",
  "AUTH_SIGNUP_DISABLED",
  "AUTH_EMAIL_INVALID",
  "AUTH_REAUTH_NEEDED",
  "AUTH_USER_BANNED",
  "AUTH_NETWORK",
  "AUTH_FAILED",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

type AuthErrorLike = {
  code?: unknown;
  error_code?: unknown;
  status?: unknown;
  name?: unknown;
  message?: unknown;
  reasons?: unknown;
};

const BY_CODE: Record<string, AuthErrorCode> = {
  invalid_credentials: "AUTH_INVALID_CREDENTIALS",
  invalid_grant: "AUTH_INVALID_CREDENTIALS",
  email_not_confirmed: "AUTH_EMAIL_NOT_CONFIRMED",
  provider_email_needs_verification: "AUTH_EMAIL_NOT_CONFIRMED",
  same_password: "AUTH_SAME_PASSWORD",
  over_request_rate_limit: "AUTH_RATE_LIMITED",
  over_email_send_rate_limit: "AUTH_RATE_LIMITED",
  over_sms_send_rate_limit: "AUTH_RATE_LIMITED",
  user_already_exists: "AUTH_USER_EXISTS",
  email_exists: "AUTH_USER_EXISTS",
  identity_already_exists: "AUTH_USER_EXISTS",
  otp_expired: "AUTH_LINK_EXPIRED",
  flow_state_expired: "AUTH_LINK_EXPIRED",
  flow_state_not_found: "AUTH_LINK_EXPIRED",
  bad_code_verifier: "AUTH_LINK_EXPIRED",
  invite_not_found: "AUTH_LINK_EXPIRED",
  bad_oauth_state: "AUTH_OAUTH_FAILED",
  bad_oauth_callback: "AUTH_OAUTH_FAILED",
  oauth_provider_not_supported: "AUTH_OAUTH_FAILED",
  provider_disabled: "AUTH_OAUTH_FAILED",
  manual_linking_disabled: "AUTH_OAUTH_FAILED",
  session_not_found: "AUTH_SESSION_MISSING",
  session_expired: "AUTH_SESSION_MISSING",
  refresh_token_not_found: "AUTH_SESSION_MISSING",
  refresh_token_already_used: "AUTH_SESSION_MISSING",
  bad_jwt: "AUTH_SESSION_MISSING",
  no_authorization: "AUTH_SESSION_MISSING",
  signup_disabled: "AUTH_SIGNUP_DISABLED",
  email_provider_disabled: "AUTH_SIGNUP_DISABLED",
  email_address_invalid: "AUTH_EMAIL_INVALID",
  email_address_not_authorized: "AUTH_EMAIL_INVALID",
  reauthentication_needed: "AUTH_REAUTH_NEEDED",
  reauth_nonce_missing: "AUTH_REAUTH_NEEDED",
  reauthentication_not_valid: "AUTH_REAUTH_NEEDED",
  user_banned: "AUTH_USER_BANNED",
  request_timeout: "AUTH_NETWORK",
  hook_timeout: "AUTH_NETWORK",
  hook_timeout_after_retry: "AUTH_NETWORK",
};

const BY_MESSAGE: Array<[RegExp, AuthErrorCode]> = [
  [/invalid login credentials|invalid credentials|wrong password/i, "AUTH_INVALID_CREDENTIALS"],
  [/email not confirmed|confirm your email/i, "AUTH_EMAIL_NOT_CONFIRMED"],
  [/pwned|leaked|compromised|data breach|known to be weak/i, "AUTH_LEAKED_PASSWORD"],
  [/different from the old password|same password/i, "AUTH_SAME_PASSWORD"],
  [/password should|password must|weak password|at least \d+ characters|password is too/i, "AUTH_WEAK_PASSWORD"],
  [/rate limit|too many (requests|attempts)|security purposes, you can only request/i, "AUTH_RATE_LIMITED"],
  [/already (been )?registered|already exists|already in use/i, "AUTH_USER_EXISTS"],
  [/popup was blocked/i, "AUTH_POPUP_BLOCKED"],
  [/cancel/i, "AUTH_OAUTH_CANCELLED"],
  [/preview mode|open the app in a new tab/i, "AUTH_OAUTH_NEW_TAB"],
  [/link is invalid|has expired|otp.*expired|token.*(expired|invalid)|expired.*(link|token)/i, "AUTH_LINK_EXPIRED"],
  [/state is invalid|no tokens received|oauth|provider/i, "AUTH_OAUTH_FAILED"],
  [/session (missing|not found|expired)|auth session/i, "AUTH_SESSION_MISSING"],
  [/signups? (not allowed|disabled)/i, "AUTH_SIGNUP_DISABLED"],
  [/invalid email|unable to validate email|email address .* invalid/i, "AUTH_EMAIL_INVALID"],
  [/reauthenticat/i, "AUTH_REAUTH_NEEDED"],
  [/banned/i, "AUTH_USER_BANNED"],
  [/failed to fetch|network|timed? ?out|load failed/i, "AUTH_NETWORK"],
];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Stable code for a Supabase Auth / OAuth error (never its text). */
export function authErrorCode(error: unknown): AuthErrorCode {
  if (!error) return "AUTH_FAILED";
  const e: AuthErrorLike = typeof error === "object" ? (error as AuthErrorLike) : { message: String(error) };
  const code = (str(e.code) || str(e.error_code)).toLowerCase();
  const message = str(e.message);
  const reasons = Array.isArray(e.reasons) ? e.reasons.map((r) => String(r)) : [];

  if (code === "weak_password" || str(e.name) === "AuthWeakPasswordError") {
    return reasons.includes("pwned") || /pwned|leaked|compromised|breach/i.test(message)
      ? "AUTH_LEAKED_PASSWORD"
      : "AUTH_WEAK_PASSWORD";
  }
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (e.status === 429) return "AUTH_RATE_LIMITED";
  if (str(e.name) === "AuthSessionMissingError") return "AUTH_SESSION_MISSING";
  if (str(e.name) === "AuthRetryableFetchError") return "AUTH_NETWORK";
  // A stable code thrown by our own server functions passes through as is.
  if (/^AUTH_[A-Z_]+$/.test(message) && (AUTH_ERROR_CODES as readonly string[]).includes(message)) {
    return message as AuthErrorCode;
  }
  for (const [re, mapped] of BY_MESSAGE) if (re.test(message)) return mapped;
  return "AUTH_FAILED";
}

/**
 * Errors Supabase puts in the redirect URL of an e-mail link or OAuth
 * callback, e.g. "#error=access_denied&error_code=otp_expired&error_description=...".
 * Accepts a location hash or search string; null when there is no error.
 */
export function authRedirectErrorCode(fragment: string | null | undefined): AuthErrorCode | null {
  if (!fragment) return null;
  const raw = fragment.replace(/^[#?]/, "");
  if (!raw) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const error = params.get("error");
  const errorCode = params.get("error_code");
  if (!error && !errorCode) return null;
  const mapped = authErrorCode({ code: errorCode ?? "", message: params.get("error_description") ?? "" });
  if (mapped !== "AUTH_FAILED") return mapped;
  if (error === "access_denied") return "AUTH_LINK_EXPIRED";
  return "AUTH_FAILED";
}

/** Keys of the auth-link parameters Supabase appends to a redirect URL. */
export function hasAuthRedirectParams(fragment: string | null | undefined): boolean {
  if (!fragment) return false;
  return /(^|[#?&])(access_token|refresh_token|error|error_code|code|type)=/.test(fragment);
}
