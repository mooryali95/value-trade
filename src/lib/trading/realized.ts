// Realized P&L is derived from the fill history, never stored: average-cost
// accounting, one lot per symbol, replayed in the order the engine applied
// the fills, with the SAME cent arithmetic as public.apply_trade_position:
//   buy : lot cost += round(qty * price, 2)                (the ledger debit)
//   sell: sale cost = round(lot cost * sold / held, 2)     (half away from 0)
//         lot cost -= sale cost; selling the whole lot takes all of it
// so the lot cost left equals positions.cost_basis, and for a position that
// has been fully closed the realized result equals the cash result exactly:
//   sum(realized) = sum(sell proceeds) - sum(buy costs).
// Everything is computed in integer cents (see ./money) and converted to
// numbers once, for display.

import {
  centsToNumber,
  mulCents,
  prorataCents,
  qty4ToNumber,
  roundDivHalfAway,
  toQty4,
  toScaled,
} from "./money";

export type FillSource = "issuance" | "trade" | "order";

export type FilledOrder = {
  /** The order the fill belongs to (grouping key of a closed exit). */
  id: string;
  symbol: string;
  asset_class: string;
  side: string;
  qty: number | string;
  filled_price: number | string | null;
  filled_at: string | null;
  created_at: string;
  /** Where the fill comes from; ties at the same instant replay issuances, then buys, then sells. */
  source?: FillSource;
  /** Unique id of the fill (trade or issuance id), the last tie-breaker. */
  fill_id?: string;
};

/** One sell fill against the lot. Cents are integers. */
export type RealizedFill = {
  orderId: string;
  symbol: string;
  assetClass: string;
  at: string;
  atKey: number;
  qty4: bigint;
  proceedsCents: bigint;
  costCents: bigint;
};

/** A closed exit: the fills of one sell order (within the reported window). */
export type RealizedTrade = {
  orderId: string;
  symbol: string;
  assetClass: string;
  /** Time of the order's last fill in the window (ISO 8601). */
  at: string;
  /** Number of executions aggregated in this row. */
  fills: number;
  qty: number;
  /** Average exit price: proceeds / qty. */
  exitPrice: number;
  costBasis: number;
  proceeds: number;
  realized: number;
  /** realized / costBasis x 100; null when the cost basis is 0. */
  returnPct: number | null;
};

export type RealizedSymbol = {
  symbol: string;
  qty: number;
  realized: number;
  proceeds: number;
  costBasis: number;
  returnPct: number | null;
};

export type RealizedSummary = {
  trades: RealizedTrade[];
  bySymbol: RealizedSymbol[];
  totals: {
    realized: number;
    proceeds: number;
    costBasis: number;
    returnPct: number | null;
    /** Closed exits (sell orders) with a gain, a loss, and exactly zero. */
    wins: number;
    losses: number;
    flat: number;
  };
};

/**
 * Sort key of a timestamp with microsecond resolution (Postgres keeps
 * microseconds; Date.parse keeps milliseconds). NaN when unparseable.
 */
export function timeKey(iso: string | null | undefined): number {
  if (!iso) return Number.NaN;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return Number.NaN;
  const frac = /T\d{2}:\d{2}:\d{2}\.(\d+)/.exec(iso)?.[1] ?? "";
  const micro = Number((frac.slice(3, 6) || "0").padEnd(3, "0"));
  return ms * 1000 + micro;
}

/** Plain code-point order (like the database's order on uuid text), locale-independent. */
function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const SOURCE_RANK: Record<string, number> = { issuance: 0, order: 1, trade: 1 };

function rank(f: FilledOrder): number {
  const base = SOURCE_RANK[f.source ?? "order"] ?? 1;
  // At the same instant: acquisitions before disposals.
  return f.side === "buy" ? base : 2;
}

/**
 * Replays the history: every sell fill with its exact cost, and the lot
 * (quantity and cost basis) left per symbol.
 */
export function replayRealized(orders: FilledOrder[]): {
  fills: RealizedFill[];
  lots: Map<string, { qty4: bigint; cost: bigint }>;
} {
  const chronological = orders
    .filter((o) => o.filled_price != null)
    .map((o) => ({ o, key: timeKey(o.filled_at ?? o.created_at) }))
    .filter((x) => !Number.isNaN(x.key))
    .sort(
      (a, b) =>
        a.key - b.key ||
        rank(a.o) - rank(b.o) ||
        codepointCompare(a.o.fill_id ?? a.o.id, b.o.fill_id ?? b.o.id),
    );

  const lots = new Map<string, { qty4: bigint; cost: bigint }>();
  const fills: RealizedFill[] = [];

  for (const { o, key } of chronological) {
    const price = o.filled_price as number | string;
    const qty4 = toQty4(o.qty);
    const price4 = toScaled(price, 4);
    if (qty4 == null || price4 == null || qty4 <= 0n || price4 < 0n) continue;
    const symbol = o.symbol.toUpperCase();
    const lot = lots.get(symbol) ?? { qty4: 0n, cost: 0n };

    if (o.side === "buy") {
      lot.qty4 += qty4;
      lot.cost += mulCents(o.qty, price);
      lots.set(symbol, lot);
      continue;
    }
    if (o.side !== "sell") continue;

    // Only the quantity actually held can realize a result.
    const closed4 = qty4 < lot.qty4 ? qty4 : lot.qty4;
    if (closed4 <= 0n) continue;
    const cost = closed4 === lot.qty4 ? lot.cost : prorataCents(lot.cost, closed4, lot.qty4);
    const proceeds = roundDivHalfAway(closed4 * price4, 1_000_000n);
    lot.cost -= cost;
    lot.qty4 -= closed4;
    if (lot.qty4 === 0n) lot.cost = 0n;
    lots.set(symbol, lot);

    fills.push({
      orderId: o.id,
      symbol,
      assetClass: o.asset_class,
      at: o.filled_at ?? o.created_at,
      atKey: key,
      qty4: closed4,
      proceedsCents: proceeds,
      costCents: cost,
    });
  }
  return { fills, lots };
}

/** Every sell fill with its exact cost. */
export function computeRealizedFills(orders: FilledOrder[]): RealizedFill[] {
  return replayRealized(orders).fills;
}

/** Quantity and cost basis left per symbol after the replay (= positions.cost_basis). */
export function remainingLots(orders: FilledOrder[]): Map<string, { qty: number; costBasis: number }> {
  const out = new Map<string, { qty: number; costBasis: number }>();
  for (const [s, lot] of replayRealized(orders).lots) {
    if (lot.qty4 > 0n) out.set(s, { qty: qty4ToNumber(lot.qty4), costBasis: centsToNumber(lot.cost) });
  }
  return out;
}

function pct(realized: bigint, cost: bigint): number | null {
  if (cost <= 0n) return null;
  // Basis points, rounded half away from zero, then percent with 2 decimals.
  return Number(roundDivHalfAway(realized * 10000n, cost)) / 100;
}

/**
 * Groups sell fills into closed exits (one row per sell order), newest
 * first, with per-symbol and overall totals. Wins and losses are counted
 * per exit (order), matching the "Closed exits" label.
 */
export function summarize(fills: RealizedFill[]): RealizedSummary {
  const byOrder = new Map<
    string,
    { orderId: string; symbol: string; assetClass: string; at: string; atKey: number; fills: number; qty4: bigint; proceeds: bigint; cost: bigint }
  >();
  for (const f of fills) {
    const k = `${f.symbol}\u0000${f.orderId}`;
    const g = byOrder.get(k) ?? {
      orderId: f.orderId,
      symbol: f.symbol,
      assetClass: f.assetClass,
      at: f.at,
      atKey: f.atKey,
      fills: 0,
      qty4: 0n,
      proceeds: 0n,
      cost: 0n,
    };
    g.fills += 1;
    g.qty4 += f.qty4;
    g.proceeds += f.proceedsCents;
    g.cost += f.costCents;
    if (f.atKey >= g.atKey) {
      g.atKey = f.atKey;
      g.at = f.at;
    }
    byOrder.set(k, g);
  }

  const symbols = new Map<string, { qty4: bigint; proceeds: bigint; cost: bigint }>();
  let proceeds = 0n;
  let cost = 0n;
  let wins = 0;
  let losses = 0;
  let flat = 0;
  const rows = [...byOrder.values()].sort((a, b) => b.atKey - a.atKey || codepointCompare(a.orderId, b.orderId));
  const trades: RealizedTrade[] = rows.map((g) => {
    const realized = g.proceeds - g.cost;
    if (realized > 0n) wins++;
    else if (realized < 0n) losses++;
    else flat++;
    proceeds += g.proceeds;
    cost += g.cost;
    const s = symbols.get(g.symbol) ?? { qty4: 0n, proceeds: 0n, cost: 0n };
    s.qty4 += g.qty4;
    s.proceeds += g.proceeds;
    s.cost += g.cost;
    symbols.set(g.symbol, s);
    return {
      orderId: g.orderId,
      symbol: g.symbol,
      assetClass: g.assetClass,
      at: g.at,
      fills: g.fills,
      qty: qty4ToNumber(g.qty4),
      // Average exit price, 4 decimals (like orders.filled_price).
      exitPrice: g.qty4 > 0n ? Number(roundDivHalfAway(g.proceeds * 1_000_000n, g.qty4)) / 10000 : 0,
      costBasis: centsToNumber(g.cost),
      proceeds: centsToNumber(g.proceeds),
      realized: centsToNumber(realized),
      returnPct: pct(realized, g.cost),
    };
  });

  const bySymbol: RealizedSymbol[] = [...symbols.entries()]
    .map(([symbol, s]) => ({
      symbol,
      qty: qty4ToNumber(s.qty4),
      realized: centsToNumber(s.proceeds - s.cost),
      proceeds: centsToNumber(s.proceeds),
      costBasis: centsToNumber(s.cost),
      returnPct: pct(s.proceeds - s.cost, s.cost),
    }))
    .sort((a, b) => b.realized - a.realized || codepointCompare(a.symbol, b.symbol));

  return {
    trades,
    bySymbol,
    totals: {
      realized: centsToNumber(proceeds - cost),
      proceeds: centsToNumber(proceeds),
      costBasis: centsToNumber(cost),
      returnPct: pct(proceeds - cost, cost),
      wins,
      losses,
      flat,
    },
  };
}

export function computeRealized(orders: FilledOrder[]): RealizedSummary {
  return summarize(computeRealizedFills(orders));
}

/** Riyadh is UTC+3 all year (no daylight saving time). */
const RIYADH_OFFSET = "+03:00";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * [start, end] instants (ms) of a range of Asia/Riyadh calendar days given
 * as YYYY-MM-DD (either side optional). Invalid dates are ignored.
 */
export function riyadhDayRange(from?: string, to?: string): { fromMs: number | null; toMs: number | null } {
  const at = (d: string | undefined, time: string) => {
    if (!d || !DAY.test(d)) return null;
    const ms = Date.parse(`${d}T${time}${RIYADH_OFFSET}`);
    return Number.isNaN(ms) ? null : ms;
  };
  return { fromMs: at(from, "00:00:00.000"), toMs: at(to, "23:59:59.999") };
}

/** Keeps the fills inside the Riyadh day range and (optionally) one symbol. */
export function filterFills(
  fills: RealizedFill[],
  opts: { from?: string; to?: string; symbol?: string },
): RealizedFill[] {
  const { fromMs, toMs } = riyadhDayRange(opts.from, opts.to);
  const sym = opts.symbol?.trim().toUpperCase() || null;
  return fills.filter((f) => {
    const ms = Math.floor(f.atKey / 1000);
    if (fromMs != null && ms < fromMs) return false;
    if (toMs != null && ms > toMs) return false;
    if (sym && f.symbol !== sym) return false;
    return true;
  });
}
