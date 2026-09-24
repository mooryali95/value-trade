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
  // Legacy codes still emitted by older server builds during rollout.
  ORDER_NOT_FOUND: "errOrderNotOpen",
  ORDER_NOT_PENDING: "errOrderNotOpen",
  ORDER_NOT_CANCELLED: "errOrderNotOpen",
  SYMBOL_NOT_FOUND: "errInstrumentNotFound",
  SYMBOL_NOT_TRADABLE: "errInstrumentNotFound",
};

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
