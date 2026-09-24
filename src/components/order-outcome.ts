import type { Key } from "@/lib/i18n";

/** Shape every order-producing server function resolves to (place/modify/restore). */
export type OrderOutcome = {
  orderId?: string;
  status?: string;
  filledQty?: number | string;
};

export const MAX_ORDER_QTY = 10_000_000;

/** Whole units only: a positive integer up to MAX_ORDER_QTY. */
export function validateQty(v: string | number): Key | null {
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return "errInvalidQty";
  const n = Number(s);
  return n >= 1 && n <= MAX_ORDER_QTY ? null : "errInvalidQty";
}

/** Limit prices are > 0 on a 0.01 tick. */
export function validatePrice(v: string | number): Key | null {
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "errInvalidPrice";
  return Number(s) > 0 ? null : "errInvalidPrice";
}

/**
 * Turns an order result into a user message. A market order never rests:
 * whatever cannot fill inside the price band is cancelled, so "cancelled"
 * with nothing filled is a no-liquidity outcome, not a success.
 */
export function describeOrderOutcome(
  res: OrderOutcome | null | undefined,
  requestedQty: number,
  t: (k: Key) => string,
): { tone: "success" | "warning" | "error"; message: string } {
  const status = res?.status;
  const filled = Number(res?.filledQty ?? 0);
  const fill = (k: Key) =>
    t(k).replace("{filled}", String(filled)).replace("{qty}", String(requestedQty));
  if (status === "cancelled") {
    return filled > 0
      ? { tone: "warning", message: fill("orderPartialCancelled") }
      : { tone: "error", message: t("orderNoLiquidity") };
  }
  if (status === "partial") return { tone: "success", message: fill("orderPartialResting") };
  if (status === "open") return { tone: "success", message: t("orderResting") };
  return { tone: "success", message: t("orderPlaced") };
}

/** Statuses of an order still working on the book (legacy "pending" included). */
export function isWorkingOrder(status: string): boolean {
  return status === "open" || status === "partial" || status === "pending";
}
