// Trading calculation helpers — pure functions, no side effects.

export type Side = "buy" | "sell";

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

function round(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}