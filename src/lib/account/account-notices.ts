import type { Key } from "@/lib/i18n";
import type { AccountStatus } from "./account-status.functions";

export type AccountNotice = { id: "email" | "invitations" | "hold" | "activation" | "funding"; tone: "warn" | "info"; key: Key; count?: number };

/**
 * Which account notices apply, most important first: unconfirmed e-mail,
 * pending company invitations, a review hold, trading not activated yet
 * (only for people who are not platform staff or company members), or an
 * activated account that has never been funded (no ledger entry and no
 * units: an investor who has spent all their cash on units is funded).
 */
export function accountNotices(
  s: Pick<
    AccountStatus,
    "email" | "emailConfirmed" | "pendingInvitations" | "onHold" | "isPlatformAdmin" | "isShariahReviewer" | "isTrader" | "companies" | "cashBalance" | "pendingAccessRequest"
  > &
    Partial<Pick<AccountStatus, "hasPositions" | "everFunded">>,
): AccountNotice[] {
  const out: AccountNotice[] = [];
  if (s.email && !s.emailConfirmed) out.push({ id: "email", tone: "warn", key: "r_bannerEmailUnconfirmed" });
  if (s.pendingInvitations > 0) {
    out.push({
      id: "invitations",
      tone: "info",
      key: s.pendingInvitations === 1 ? "r_bannerOneInvitation" : "r_bannerInvitations",
      count: s.pendingInvitations,
    });
  }
  if (s.onHold) out.push({ id: "hold", tone: "warn", key: "r_bannerOnHold" });
  const staff = s.isPlatformAdmin || s.isShariahReviewer || s.companies.length > 0;
  // A review hold already explains why trading is paused.
  if (!s.isTrader && !staff && !s.onHold) {
    out.push({
      id: "activation",
      tone: "info",
      key: s.pendingAccessRequest?.status === "pending" ? "r_bannerRequestPending" : "r_bannerAwaitingActivation",
    });
  } else if (s.isTrader && !s.onHold && s.cashBalance <= 0 && !s.hasPositions && !s.everFunded) {
    out.push({ id: "funding", tone: "info", key: "r_bannerAwaitingFunding" });
  }
  return out;
}
