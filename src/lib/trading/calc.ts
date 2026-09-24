// Trading calculation helpers — pure functions, no side effects.
import { z } from "zod";

export type Side = "buy" | "sell";

/** K1: orders are whole units, at most this many per order. */
export const MAX_ORDER_QTY = 10_000_000;

/** Whole units only: a positive integer no larger than MAX_ORDER_QTY. */
export function isValidOrderQty(qty: unknown): qty is number {
  return typeof qty === "number" && Number.isInteger(qty) && qty > 0 && qty <= MAX_ORDER_QTY;
}

/**
 * Limit prices are > 0 on a 0.01 tick. Compared in integer cents: the value
 * is valid only if it is exactly representable as a whole number of cents
 * (100.07 passes, 100.075 and 0.001 do not), never by float equality on the
 * price itself.
 */
export function isValidLimitPrice(price: unknown): price is number {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return false;
  const cents = Math.round(price * 100);
  return cents >= 1 && Number.isSafeInteger(cents) && cents / 100 === price;
}

const SYMBOL_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const OrderInput = z.object({
  symbolSlug: z.string().regex(SYMBOL_SLUG),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["limit", "market"]),
  qty: z.number(),
  price: z.number().optional(),
});

export type OrderInput = {
  symbolSlug: string;
  side: Side;
  type: "limit" | "market";
  qty: number;
  price?: number;
};

/**
 * Validates a placeOrder payload and throws stable codes instead of a raw
 * validation dump: INVALID_QTY, INVALID_PRICE, or INSTRUMENT_NOT_FOUND for a
 * malformed symbol. A market order's price is ignored.
 */
export function parseOrderInput(input: unknown): OrderInput {
  const parsed = OrderInput.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "qty") throw new Error("INVALID_QTY");
    if (field === "price") throw new Error("INVALID_PRICE");
    if (field === "symbolSlug") throw new Error("INSTRUMENT_NOT_FOUND");
    throw new Error("INVALID_INPUT");
  }
  const v = parsed.data;
  if (!isValidOrderQty(v.qty)) throw new Error("INVALID_QTY");
  if (v.type === "limit") {
    if (!isValidLimitPrice(v.price)) throw new Error("INVALID_PRICE");
    return { symbolSlug: v.symbolSlug, side: v.side, type: v.type, qty: v.qty, price: v.price };
  }
  return { symbolSlug: v.symbolSlug, side: v.side, type: v.type, qty: v.qty };
}

const UUID = z.string().uuid();

/** An order id from the browser; anything malformed reads as ORDER_NOT_OPEN. */
export function parseOrderIdInput(input: unknown): { orderId: string } {
  const orderId = (input as { orderId?: unknown } | null | undefined)?.orderId;
  if (!UUID.safeParse(orderId).success) throw new Error("ORDER_NOT_OPEN");
  return { orderId: orderId as string };
}

/** modifyOrder payload: the NEW order's limit price and quantity. */
export function parseModifyInput(input: unknown): { orderId: string; price: number; qty: number } {
  const { orderId } = parseOrderIdInput(input);
  const { price, qty } = (input ?? {}) as { price?: unknown; qty?: unknown };
  if (!isValidOrderQty(qty)) throw new Error("INVALID_QTY");
  if (!isValidLimitPrice(price)) throw new Error("INVALID_PRICE");
  return { orderId, price, qty };
}

/** Error codes the trading server functions may send to the browser. */
export const TRADING_ERROR_CODES = [
  "INSUFFICIENT_CASH",
  "INSUFFICIENT_QTY",
  "SHARIAH_BLOCKED",
  "ORDER_TOO_LARGE",
  "PRICE_OUT_OF_BAND",
  "FORBIDDEN_TRADER_REQUIRED",
  "ORDER_NOT_OPEN",
  "INSTRUMENT_NOT_FOUND",
  "INVALID_QTY",
  "INVALID_PRICE",
  "SELF_TRADE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;
export type TradingErrorCode = (typeof TRADING_ERROR_CODES)[number];

/**
 * Maps an engine error (the SQL functions RAISE bare codes) to a stable
 * code; anything else (constraint text, driver errors) becomes INTERNAL_ERROR.
 */
export function tradingErrorCode(message: string | null | undefined): TradingErrorCode {
  const m = (message ?? "").trim();
  return (TRADING_ERROR_CODES as readonly string[]).includes(m) ? (m as TradingErrorCode) : "INTERNAL_ERROR";
}

export type EngineResult = {
  orderId: string;
  status: "open" | "partial" | "filled" | "cancelled";
  filledQty: number;
  filledPrice: number | null;
};

/** Normalizes a match_order / replace_order / restore_order result row. */
export function toEngineResult(rows: unknown): EngineResult | null {
  const row = (Array.isArray(rows) ? rows[0] : rows) as
    | { order_id?: string | null; status?: string | null; filled_qty?: number | string | null; avg_price?: number | string | null }
    | null
    | undefined;
  if (!row?.order_id) return null;
  const status = row.status === "open" || row.status === "partial" || row.status === "filled" ? row.status : "cancelled";
  return {
    orderId: row.order_id,
    status,
    filledQty: Number(row.filled_qty ?? 0),
    filledPrice: row.avg_price == null ? null : Number(row.avg_price),
  };
}

export type PositionInput = {
  qty: number;
  avgPrice: number;
};

/**
 * Apply a fill to an existing position and return the next position.
 * Buy: weighted-average avg_price. Sell: qty decreases, avg_price stays.
 * Selling more than held is clamped to 0 by the caller-side validation.
 */
export function applyFill(pos: PositionInput, side: Side, qty: number, price: number): PositionInput {
  if (qty <= 0) return pos;
  if (side === "buy") {
    const total = pos.qty + qty;
    const avg = total === 0 ? 0 : (pos.qty * pos.avgPrice + qty * price) / total;
    return { qty: total, avgPrice: round(avg, 4) };
  }
  const nextQty = Math.max(0, pos.qty - qty);
  return { qty: nextQty, avgPrice: nextQty === 0 ? 0 : pos.avgPrice };
}

export function positionValue(qty: number, lastPrice: number): number {
  return round(qty * lastPrice, 2);
}

export function unrealizedPnl(qty: number, avgPrice: number, lastPrice: number): number {
  return round(qty * (lastPrice - avgPrice), 2);
}

export function weight(value: number, total: number): number {
  if (total <= 0) return 0;
  return round((value / total) * 100, 2);
}

/**
 * Shariah gate: a `non_halal` ruling blocks buying. Selling stays allowed so
 * existing holders can always exit. Shared by placeOrder and the smoke suite.
 */
export function isBuyBlockedByShariah(status: string | null | undefined, side: Side): boolean {
  return side === "buy" && status === "non_halal";
}

function round(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}