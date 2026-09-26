// Trading calculation helpers — pure functions, no side effects.
import { z } from "zod";
import {
  centsToNumber,
  mulCents,
  prorataCents,
  qty4ToNumber,
  roundDivHalfAway,
  toCents,
  toQty4,
  toScaled,
} from "./money";

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
  /** Exact cost of the units held (positions.cost_basis), to the cent. */
  costBasis: number;
};

export type PositionState = PositionInput & {
  /** costBasis / qty to 4 decimals (positions.avg_price), for display. */
  avgPrice: number;
};

/**
 * Applies a fill to a position exactly as public.apply_trade_position does:
 * a buy adds round(qty * price, 2) to the cost basis (the ledger debit); a
 * sell removes round(costBasis * sold / held, 2), or all of it when the
 * position is closed. Selling more than held closes the position (the
 * engine refuses such an order before it gets here).
 */
export function applyFill(pos: PositionInput, side: Side, qty: number, price: number): PositionState {
  const avg = (q: bigint, c: bigint) => (q > 0n ? Number(roundDivHalfAway(c * 1_000_000n, q)) / 10000 : 0);
  const heldQ = toQty4(pos.qty) ?? 0n;
  const heldC = toCents(pos.costBasis) ?? 0n;
  const fillQ = toQty4(qty) ?? 0n;
  if (!(fillQ > 0n) || !(price > 0)) {
    return { qty: pos.qty, costBasis: pos.costBasis, avgPrice: avg(heldQ, heldC) };
  }
  if (side === "buy") {
    const q = heldQ + fillQ;
    const c = heldC + mulCents(qty, price);
    return { qty: qty4ToNumber(q), costBasis: centsToNumber(c), avgPrice: avg(q, c) };
  }
  if (fillQ >= heldQ) return { qty: 0, costBasis: 0, avgPrice: 0 };
  const c = heldC - prorataCents(heldC, fillQ, heldQ);
  const q = heldQ - fillQ;
  return { qty: qty4ToNumber(q), costBasis: centsToNumber(c), avgPrice: avg(q, c) };
}

/** Market value round(qty * price, 2), computed exactly. */
export function positionValue(qty: number, lastPrice: number): number {
  return centsToNumber(mulCents(qty, lastPrice));
}

/** round(qty * (last - avg), 2), computed exactly. Prefer unrealizedFromCost with the exact cost basis. */
export function unrealizedPnl(qty: number, avgPrice: number, lastPrice: number): number {
  const q = toQty4(qty);
  const a = toScaled(avgPrice, 4);
  const l = toScaled(lastPrice, 4);
  if (q == null || a == null || l == null) return 0;
  return centsToNumber(roundDivHalfAway(q * (l - a), 1_000_000n));
}

/**
 * Unrealized P/L from the exact cost basis: market value minus cost, both to
 * the cent, so realized + unrealized reconciles with the cash ledger.
 */
export function unrealizedFromCost(qty: number, costBasis: number, lastPrice: number): number {
  const cost = toCents(costBasis) ?? 0n;
  return centsToNumber(mulCents(qty, lastPrice) - cost);
}

/** A P/L as a percentage of its cost basis (12.5 = 12.5%); null when the cost is 0 or less. */
export function pnlPct(pnl: number, costBasis: number): number | null {
  if (!Number.isFinite(pnl) || !Number.isFinite(costBasis) || costBasis <= 0) return null;
  return (pnl / costBasis) * 100;
}

export function weight(value: number, total: number): number {
  if (total <= 0) return 0;
  return round((value / total) * 100, 2);
}

/** Lowest listing reference price: its ±20% band then spans more than one 0.01 tick (0.04–0.06). */
export const MIN_REFERENCE_PRICE = 0.05;
export const MAX_PRICE = 1_000_000_000;

/** A listing reference price: on the 0.01 tick, from 0.05 to 1,000,000,000 (as the database enforces). */
export function isValidReferencePrice(price: unknown): price is number {
  return isValidLimitPrice(price) && price >= MIN_REFERENCE_PRICE && price <= MAX_PRICE;
}

/**
 * Cash a buy order commits, as the engine checks it: qty x limit for a limit
 * order, qty x the top of today's band (on the tick) for a market order,
 * the worst price it can fill at. In currency units, exact to the cent.
 */
export function orderCashCommitment(qty: number, type: "limit" | "market", limitPrice: number | null, bandHigh: number): number {
  const unit = type === "limit" ? limitPrice : bandHigh;
  if (unit == null || !(unit > 0) || !(qty > 0)) return 0;
  return centsToNumber(mulCents(qty, unit));
}

export type BookLevelInput = { price: number; qty: number };

/**
 * What a market order would execute against the visible book right now:
 * levels inside today's band only (the engine never crosses outside it),
 * best price first. Returns the executable quantity and its amount; a
 * market order's unfilled remainder is cancelled by the engine.
 */
export function estimateMarketFill(
  side: Side,
  qty: number,
  book: { bids: BookLevelInput[]; asks: BookLevelInput[] },
  band: { low: number; high: number },
): { filledQty: number; amount: number; avgPrice: number | null } {
  const levels = side === "buy"
    ? book.asks.filter((l) => l.price <= band.high).slice().sort((a, b) => a.price - b.price)
    : book.bids.filter((l) => l.price >= band.low).slice().sort((a, b) => b.price - a.price);
  let left = Math.max(0, Math.floor(qty));
  let filled = 0;
  let cents = 0n;
  for (const l of levels) {
    if (left <= 0) break;
    const take = Math.min(left, Math.floor(l.qty));
    if (take <= 0) continue;
    // Execution stays inside the band (a stale level outside it trades at the edge).
    const px = side === "buy" ? Math.max(l.price, band.low) : Math.min(l.price, band.high);
    cents += mulCents(take, px);
    filled += take;
    left -= take;
  }
  const amount = centsToNumber(cents);
  return { filledQty: filled, amount, avgPrice: filled > 0 ? amount / filled : null };
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