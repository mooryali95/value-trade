// Realized P&L is derived from the filled-order history, never stored:
// average-cost accounting, one lot per symbol, sells realize the difference
// between fill price and the running average cost at that moment.

export type FilledOrder = {
  id: string;
  symbol: string;
  asset_class: string;
  side: string;
  qty: number | string;
  filled_price: number | string | null;
  filled_at: string | null;
  created_at: string;
};

export type RealizedTrade = {
  orderId: string;
  symbol: string;
  assetClass: string;
  at: string;
  qty: number;
  exitPrice: number;
  costBasis: number;
  proceeds: number;
  realized: number;
  returnPct: number;
};

export type RealizedSummary = {
  trades: RealizedTrade[];
  bySymbol: { symbol: string; qty: number; realized: number; proceeds: number; costBasis: number }[];
  totals: { realized: number; proceeds: number; costBasis: number; wins: number; losses: number };
};

function round(n: number, d = 2): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

export function computeRealized(orders: FilledOrder[]): RealizedSummary {
  const chronological = orders
    .filter((o) => o.filled_price != null)
    .slice()
    .sort((a, b) => (a.filled_at ?? a.created_at).localeCompare(b.filled_at ?? b.created_at));

  const lots = new Map<string, { qty: number; avg: number }>();
  const trades: RealizedTrade[] = [];

  for (const o of chronological) {
    const qty = Number(o.qty);
    const price = Number(o.filled_price);
    if (!(qty > 0) || !(price >= 0)) continue;
    const lot = lots.get(o.symbol) ?? { qty: 0, avg: 0 };

    if (o.side === "buy") {
      const total = lot.qty + qty;
      lot.avg = total === 0 ? 0 : (lot.qty * lot.avg + qty * price) / total;
      lot.qty = total;
      lots.set(o.symbol, lot);
      continue;
    }

    // Sell: only the quantity actually held can realize a result.
    const closed = Math.min(qty, lot.qty);
    if (closed <= 0) continue;
    const costBasis = round(closed * lot.avg);
    const proceeds = round(closed * price);
    const realized = round(proceeds - costBasis);
    trades.push({
      orderId: o.id,
      symbol: o.symbol,
      assetClass: o.asset_class,
      at: o.filled_at ?? o.created_at,
      qty: closed,
      exitPrice: price,
      costBasis,
      proceeds,
      realized,
      returnPct: costBasis > 0 ? round((realized / costBasis) * 100) : 0,
    });
    lot.qty = round(lot.qty - closed, 6);
    if (lot.qty === 0) lot.avg = 0;
    lots.set(o.symbol, lot);
  }

  return summarize(trades);
}

/** Re-aggregates an already-computed trade list (used after date filtering). */
export function summarize(trades: RealizedTrade[]): RealizedSummary {
  const bySymbolMap = new Map<string, { symbol: string; qty: number; realized: number; proceeds: number; costBasis: number }>();
  let realized = 0;
  let proceeds = 0;
  let costBasis = 0;
  let wins = 0;
  let losses = 0;

  for (const tr of trades) {
    const agg = bySymbolMap.get(tr.symbol) ?? { symbol: tr.symbol, qty: 0, realized: 0, proceeds: 0, costBasis: 0 };
    agg.qty += tr.qty;
    agg.realized = round(agg.realized + tr.realized);
    agg.proceeds = round(agg.proceeds + tr.proceeds);
    agg.costBasis = round(agg.costBasis + tr.costBasis);
    bySymbolMap.set(tr.symbol, agg);
    realized = round(realized + tr.realized);
    proceeds = round(proceeds + tr.proceeds);
    costBasis = round(costBasis + tr.costBasis);
    if (tr.realized > 0) wins++;
    else if (tr.realized < 0) losses++;
  }

  return {
    trades: trades.slice().sort((a, b) => b.at.localeCompare(a.at)),
    bySymbol: [...bySymbolMap.values()].sort((a, b) => b.realized - a.realized),
    totals: { realized, proceeds, costBasis, wins, losses },
  };
}
