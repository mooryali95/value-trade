import { useCallback } from "react";
import { useI18n, type Key } from "@/lib/i18n";

/**
 * Server functions throw stable UPPER_SNAKE codes. This maps each code to a
 * translated message; anything unknown (including raw validation output)
 * falls back to a generic message so internals never reach the user.
 */
const CODE_TO_KEY: Record<string, Key> = {
  INSUFFICIENT_CASH: "insufficientCash",
  INSUFFICIENT_QTY: "insufficientQty",
  SHARIAH_BLOCKED: "shariahBlocked",
  ORDER_TOO_LARGE: "orderTooLarge",
  PRICE_OUT_OF_BAND: "priceOutOfBand",
  FORBIDDEN_TRADER_REQUIRED: "traderRequired",
  INVALID_QTY: "errInvalidQty",
  INVALID_PRICE: "errInvalidPrice",
  ORDER_NOT_OPEN: "errOrderNotOpen",
  INSTRUMENT_NOT_FOUND: "errInstrumentNotFound",
  SYMBOL_TAKEN: "errSymbolTaken",
  RATE_LIMITED: "errRateLimited",
  INTERNAL_ERROR: "errInternal",
  FORBIDDEN_ADMIN_REQUIRED: "errAdminRequired",
  USER_NOT_FOUND: "errUserNotFound",
  SELF_TRADE: "errSelfTrade",
  FORBIDDEN: "forbiddenAction",
  FORBIDDEN_BRAND_FIELD: "forbiddenAction",
  INVALID_AMOUNT: "errInvalidAmount",
  INVALID_KIND: "errInvalidInput",
  INVALID_INPUT: "errInvalidInput",
  INVALID_SYMBOL: "errInvalidSymbol",
  PORTFOLIO_UNAVAILABLE: "errInternal",
  DECISION_NOT_FOUND: "errDecisionNotFound",
  SLUG_TAKEN: "errSlugTaken",
  SLUG_AND_SECTOR_REQUIRED: "errSlugAndSectorRequired",
  ROLE_REQUIRED: "errRoleRequired",
  REQUEST_NOT_PENDING: "errRequestNotPending",
  REQUEST_NOT_FOUND: "errRequestNotPending",
  SUBMISSION_NOT_FOUND: "errSubmissionNotPending",
  SUBMISSION_NOT_PENDING: "errSubmissionNotPending",
  REJECTION_REASON_REQUIRED: "rejectionReasonRequired",
  INVITATION_ALREADY_PENDING: "inviteAlreadyPending",
  INVITATION_EXPIRED: "inviteExpired",
  INVITATION_NOT_PENDING: "inviteNotPending",
  INVITATION_NOT_FOUND: "errInvitationNotFound",
  INVITATION_EMAIL_MISMATCH: "errInvitationEmailMismatch",
  LAST_OWNER_PROTECTED: "lastOwnerProtected",
  BRAND_CAP_REACHED: "brandCapReached",
  SHARIAH_RULING_REQUIRED: "fx_publishNeedsRuling",
  // Legacy codes still emitted by older server builds during rollout.
  ORDER_NOT_FOUND: "errOrderNotOpen",
  ORDER_NOT_PENDING: "errOrderNotOpen",
  ORDER_NOT_CANCELLED: "errOrderNotOpen",
  SYMBOL_NOT_FOUND: "errInstrumentNotFound",
  SYMBOL_NOT_TRADABLE: "errInstrumentNotFound",
  // ---- R codes (phase 3): onboarding and Supabase Auth ----
  ALREADY_MEMBER: "r_errAlreadyMember",
  EMAIL_NOT_CONFIRMED: "r_errEmailNotConfirmed",
  EMAIL_SEND_FAILED: "r_errEmailSendFailed",
  INVITATION_NOT_REVOKED: "r_errInvitationNotRevoked",
  MEMBER_NOT_FOUND: "r_errMemberNotFound",
  NOT_AUTHENTICATED: "r_authSessionMissing",
  AUTH_INVALID_CREDENTIALS: "r_authInvalidCredentials",
  AUTH_EMAIL_NOT_CONFIRMED: "r_authEmailNotConfirmed",
  AUTH_WEAK_PASSWORD: "r_authWeakPassword",
  AUTH_LEAKED_PASSWORD: "r_authLeakedPassword",
  AUTH_SAME_PASSWORD: "r_authSamePassword",
  AUTH_RATE_LIMITED: "errRateLimited",
  AUTH_USER_EXISTS: "r_authUserExists",
  AUTH_LINK_EXPIRED: "r_authLinkExpired",
  AUTH_OAUTH_CANCELLED: "r_authOAuthCancelled",
  AUTH_POPUP_BLOCKED: "r_authPopupBlocked",
  AUTH_OAUTH_NEW_TAB: "r_authOAuthNewTab",
  AUTH_OAUTH_FAILED: "r_authOAuthFailed",
  AUTH_SESSION_MISSING: "r_authSessionMissing",
  AUTH_SIGNUP_DISABLED: "r_authSignupDisabled",
  AUTH_EMAIL_INVALID: "r_authEmailInvalid",
  AUTH_REAUTH_NEEDED: "r_authReauthNeeded",
  AUTH_USER_BANNED: "r_authUserBanned",
  AUTH_NETWORK: "r_authNetwork",
  AUTH_FAILED: "r_authFailed",
  PASSWORD_TOO_SHORT: "r_pwTooShort",
  PASSWORD_TOO_LONG: "r_pwTooLong",
  PASSWORD_NEEDS_LETTER_AND_DIGIT: "r_pwNeedsLetterDigit",
  PASSWORD_HAS_SPACES_AT_ENDS: "r_pwSpacesAtEnds",
  PASSWORD_MISMATCH: "r_pwMismatch",
};

/** i18n key of a stable error code, or undefined when it has no message. */
export function errorMessageKey(code: string): Key | undefined {
  return Object.prototype.hasOwnProperty.call(CODE_TO_KEY, code) ? CODE_TO_KEY[code] : undefined;
}

export function errorCode(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(msg) ? msg : "";
}

/** Returns `(error, overrides?, fallback?) => message`. */
export function useErrorMessage() {
  const { t } = useI18n();
  return useCallback(
    (e: unknown, overrides?: Partial<Record<string, Key>>, fallback: Key = "errInternal") => {
      const code = errorCode(e);
      const key = (code && (overrides?.[code] ?? CODE_TO_KEY[code])) || fallback;
      return t(key);
    },
    [t],
  );
}
