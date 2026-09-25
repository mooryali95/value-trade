// Portfolio valuation, pure (no I/O): values the rows of
// public.portfolio_positions and totals them, in integer cents.
//
// A holding is valued at the instrument's last execution price, else its
// band reference price (previous close, else the listing reference price,
// shown as a reference), else not at all. Never at the investor's own
// average cost: a holding without a market price has no market value and no
// unrealized P/L, and is left out of the totals (counted in unpricedCount).
import { centsToNumber, mulCents, toCents } from "./money";

/** Where a position's valuation price comes from. */
export type MarkSource = "last" | "reference" | "none";

/** One holding, valued from real data (see public.portfolio_positions). */
export type ValuedPosition = {
  symbol: string;
  asset_class: string;
  qty: number;
  /** Exact cost of the units held (average-cost method), to the cent. */
  cost_basis: number;
  /** cost_basis / qty (4 decimals), for display. */
  avg_price: number;
  /** Units promised to resting sell orders; available to sell = qty - reserved_qty. */
  reserved_qty: number;
  updated_at: string | null;
  published: boolean;
  slug: string | null;
  name_ar: string | null;
  name_en: string | null;
  /** The instrument's latest execution price (listed or not), if it ever traded. */
  last_price: number | null;
  last_trade_at: string | null;
  /** Band reference: previous close, else the listing reference price; null if none. */
  reference_price: number | null;
  /** Valuation price: last_price, else reference_price, else none (never the investor's cost). */
  mark_price: number | null;
  mark_source: MarkSource;
  /** round(qty * mark_price, 2); null without a market price. */
  market_value: number | null;
  /** market_value - cost_basis; null without a market price. */
  unrealized_pnl: number | null;
  /** unrealized_pnl / cost_basis x 100; null without a price or with a zero cost. */
  unrealized_pct: number | null;
};

export type PortfolioSummary = {
  cash: number;
  /** Cash promised to resting buy orders (qty left x limit). */
  reserved: number;
  /** cash - reserved, to the cent: what a new buy order can commit. */
  buyingPower: number;
  /** Sum of market values of the priced holdings. */
  marketValue: number;
  /** Cost basis of the priced holdings. */
  pricedCostBasis: number;
  unrealizedPnl: number;
  unrealizedPct: number | null;
  /** cash + marketValue (holdings without a market price are not included). */
  totalValue: number;
  /** Holdings with no market price at all (not listed, never traded, no reference). */
  unpricedCount: number;
};

export type SnapshotRow = {
  symbol: string;
  asset_class: string | null;
  qty: number | string;
  cost_basis: number | string;
  avg_price: number | string;
  reserved_qty: number | string | null;
  last_price: number | string | null;
  last_trade_at: string | null;
  band_reference: number | string | null;
  published: boolean | null;
  slug: string | null;
  name_ar: string | null;
  name_en: string | null;
  updated_at: string | null;
};

/** A numeric column (number or numeric string) as a finite number, else null. */
export function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Values one snapshot row: last trade, else reference price, else unpriced. */
export function valuePosition(r: SnapshotRow): ValuedPosition {
  const qty = num(r.qty) ?? 0;
  const costCents = toCents(r.cost_basis as number | string) ?? 0n;
  const last = num(r.last_price);
  const ref = num(r.band_reference);
  const reference = ref != null && ref > 0 ? ref : null;
  const mark = last != null && last > 0 ? last : reference;
  const source: MarkSource = last != null && last > 0 ? "last" : reference != null ? "reference" : "none";
  const valueCents = mark != null ? mulCents(qty, mark) : null;
  const pnlCents = valueCents != null ? valueCents - costCents : null;
  return {
    symbol: r.symbol,
    asset_class: r.asset_class ?? "brand",
    qty,
    cost_basis: centsToNumber(costCents),
    avg_price: num(r.avg_price) ?? 0,
    reserved_qty: num(r.reserved_qty) ?? 0,
    updated_at: r.updated_at,
    published: r.published === true,
    slug: r.slug,
    name_ar: r.name_ar,
    name_en: r.name_en,
    last_price: last,
    last_trade_at: r.last_trade_at,
    reference_price: reference,
    mark_price: mark,
    mark_source: source,
    market_value: valueCents != null ? centsToNumber(valueCents) : null,
    unrealized_pnl: pnlCents != null ? centsToNumber(pnlCents) : null,
    unrealized_pct:
      pnlCents != null && costCents > 0n ? (Number(pnlCents) / Number(costCents)) * 100 : null,
  };
}

/** Totals of a valued portfolio, summed in cents. */
export function summarizePortfolio(
  positions: ValuedPosition[],
  cash: number,
  reserved: number,
  buyingPower: number,
): PortfolioSummary {
  let value = 0n;
  let cost = 0n;
  let unpriced = 0;
  for (const p of positions) {
    if (p.market_value == null) {
      unpriced++;
      continue;
    }
    value += toCents(p.market_value) ?? 0n;
    cost += toCents(p.cost_basis) ?? 0n;
  }
  const cashCents = toCents(cash) ?? 0n;
  const pnl = value - cost;
  return {
    cash: centsToNumber(cashCents),
    reserved: centsToNumber(toCents(reserved) ?? 0n),
    buyingPower: centsToNumber(toCents(buyingPower) ?? 0n),
    marketValue: centsToNumber(value),
    pricedCostBasis: centsToNumber(cost),
    unrealizedPnl: centsToNumber(pnl),
    unrealizedPct: cost > 0n ? (Number(pnl) / Number(cost)) * 100 : null,
    totalValue: centsToNumber(cashCents + value),
    unpricedCount: unpriced,
  };
}
