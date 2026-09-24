/**
 * Public market data: shapes returned to the browser and the pure helpers
 * that map database rows (snake_case, Postgres numerics that may arrive as
 * numbers or strings, timestamptz strings) onto them. No I/O here, so the
 * mapping is unit-tested on its own (public-market.mappers.test.ts).
 *
 * Every value comes from the database: a missing trade stays null (the UI
 * then shows the reference price labelled as such), never an invented
 * number. A row that cannot be mapped faithfully is dropped, not patched.
 */
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];
export type OverviewRow = Fns["public_market_overview"]["Returns"][number];
export type SummaryRow = Fns["public_market_summary"]["Returns"][number];
export type InstrumentRow = Fns["public_instrument"]["Returns"][number];
export type CandleRow = Fns["public_candles"]["Returns"][number];
export type TradeRow = Fns["public_recent_trades"]["Returns"][number];
export type RulingRow = Fns["public_shariah_rulings"]["Returns"][number];
export type CompanyRow = Fns["public_company_profile"]["Returns"][number];

export type ShariahStatus = "halal" | "non_halal" | "reviewing";

export type PublicInstrument = {
  symbol: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  sector: string | null;
  assetClass: string;
  companyId: string | null;
  companyNameAr: string | null;
  companyNameEn: string | null;
  /** Listing reference price (set by a platform admin). Not a trade price. */
  referencePrice: number;
  /** Last executed trade price; null until the first trade. */
  lastPrice: number | null;
  /** Last price vs the last trade at least 24h old, else the first trade in the window. */
  change24hPct: number | null;
  volume24hUnits: number;
  volume24hValue: number;
  trades24h: number;
  lastTradeAt: string | null;
  /** Shariah ruling in force; null when no ruling exists yet. */
  shariahStatus: ShariahStatus | null;
};

export type PublicInstrumentDetail = PublicInstrument & {
  /** Today's (Asia/Riyadh) first, highest and lowest trade price; null without trades today. */
  dayOpen: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  /** Limit prices the engine accepts today, on the 0.01 tick (inclusive). */
  bandLow: number;
  bandHigh: number;
};

export type MarketSummary = {
  listedCount: number;
  trades24h: number;
  volume24hValue: number;
  lastTradeAt: string | null;
};

export type MarketOverview = { instruments: PublicInstrument[]; summary: MarketSummary };

export type CandleInterval = "1h" | "1d";

/** One OHLC bucket that has trades; `time` is the bucket start, `volume` in units. */
export type PublicCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type PublicTrade = { price: number; qty: number; tradedAt: string };

export type PublicShariahRuling = {
  symbol: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  status: ShariahStatus;
  reason: string | null;
  effectiveAt: string;
};

export type PublicCompanyProfile = {
  id: string;
  nameAr: string;
  nameEn: string;
  sector: string | null;
  instruments: PublicInstrument[];
};

/** Postgres numeric (number or numeric string) -> finite number, else null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** timestamptz (any format Date parses) -> ISO 8601 UTC string, else null. */
export function toIso(v: unknown): string | null {
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function toShariahStatus(v: unknown): ShariahStatus | null {
  return v === "halal" || v === "non_halal" || v === "reviewing" ? v : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** A market board row; null when a required field is missing or malformed. */
export function mapInstrumentRow(row: OverviewRow | InstrumentRow): PublicInstrument | null {
  const symbol = text(row.symbol);
  const slug = text(row.slug);
  const referencePrice = toNumber(row.reference_price);
  if (!symbol || !slug || referencePrice == null || referencePrice <= 0) return null;
  return {
    symbol,
    slug,
    nameAr: typeof row.name_ar === "string" ? row.name_ar : "",
    nameEn: typeof row.name_en === "string" ? row.name_en : "",
    sector: text(row.sector),
    assetClass: text(row.asset_class) ?? "brand",
    companyId: text(row.company_id),
    companyNameAr: text(row.company_name_ar),
    companyNameEn: text(row.company_name_en),
    referencePrice,
    lastPrice: toNumber(row.last_price),
    change24hPct: toNumber(row.change_24h_pct),
    volume24hUnits: toNumber(row.volume_24h_units) ?? 0,
    volume24hValue: toNumber(row.volume_24h_value) ?? 0,
    trades24h: toNumber(row.trades_24h) ?? 0,
    lastTradeAt: toIso(row.last_trade_at),
    shariahStatus: toShariahStatus(row.shariah_status),
  };
}

/**
 * The instrument page row. The band is the engine's; without a valid band
 * the instrument cannot be traded, so the row maps to null (not found)
 * rather than showing a made-up range.
 */
export function mapInstrumentDetailRow(row: InstrumentRow): PublicInstrumentDetail | null {
  const base = mapInstrumentRow(row);
  const bandLow = toNumber(row.band_low);
  const bandHigh = toNumber(row.band_high);
  if (!base || bandLow == null || bandHigh == null || bandLow <= 0 || bandHigh < bandLow) return null;
  return {
    ...base,
    dayOpen: toNumber(row.day_open),
    dayHigh: toNumber(row.day_high),
    dayLow: toNumber(row.day_low),
    bandLow,
    bandHigh,
  };
}

/** Anchor of today's band (previous close, else the listing reference). */
export function bandReferenceOf(row: InstrumentRow): number | null {
  const n = toNumber(row.band_reference);
  return n != null && n > 0 ? n : null;
}

export function mapSummaryRow(row: SummaryRow | null | undefined): MarketSummary {
  return {
    listedCount: toNumber(row?.listed_count) ?? 0,
    trades24h: toNumber(row?.trades_24h) ?? 0,
    volume24hValue: toNumber(row?.volume_24h_value) ?? 0,
    lastTradeAt: toIso(row?.last_trade_at),
  };
}

export function mapCandleRow(row: CandleRow): PublicCandle | null {
  const time = toIso(row.bucket_start);
  const open = toNumber(row.open_price);
  const high = toNumber(row.high_price);
  const low = toNumber(row.low_price);
  const close = toNumber(row.close_price);
  const volume = toNumber(row.volume_units);
  if (!time || open == null || high == null || low == null || close == null || volume == null) return null;
  return { time, open, high, low, close, volume };
}

export function mapTradeRow(row: TradeRow): PublicTrade | null {
  const price = toNumber(row.price);
  const qty = toNumber(row.qty);
  const tradedAt = toIso(row.traded_at);
  if (price == null || qty == null || !tradedAt) return null;
  return { price, qty, tradedAt };
}

export function mapRulingRow(row: RulingRow): PublicShariahRuling | null {
  const status = toShariahStatus(row.status);
  const effectiveAt = toIso(row.effective_at);
  const symbol = text(row.symbol);
  const slug = text(row.slug);
  if (!status || !effectiveAt || !symbol || !slug) return null;
  return {
    symbol,
    slug,
    nameAr: typeof row.name_ar === "string" ? row.name_ar : "",
    nameEn: typeof row.name_en === "string" ? row.name_en : "",
    status,
    reason: text(row.reason),
    effectiveAt,
  };
}

export function mapCompanyProfile(
  row: CompanyRow | null | undefined,
  instruments: PublicInstrument[],
): PublicCompanyProfile | null {
  const id = text(row?.id);
  if (!row || !id) return null;
  return {
    id,
    nameAr: typeof row.name_ar === "string" ? row.name_ar : "",
    nameEn: typeof row.name_en === "string" ? row.name_en : "",
    sector: text(row.sector),
    instruments,
  };
}

/** Maps every row, dropping the ones that cannot be mapped faithfully. */
export function mapRows<R, T>(rows: readonly R[] | null | undefined, map: (row: R) => T | null): T[] {
  const out: T[] = [];
  for (const row of rows ?? []) {
    const v = map(row);
    if (v != null) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Input parsing. Identifiers are plain slugs/symbols; anything else cannot
// match a listed instrument and resolves to "not found" (null / empty),
// not an error. A bad interval or limit is a caller bug: INVALID_INPUT.
// ---------------------------------------------------------------------------

const IDENT_RE = /^[A-Za-z0-9._-]{1,64}$/;
export const CANDLES_DEFAULT_LIMIT = 200;
export const CANDLES_MAX_LIMIT = 500;
export const TRADES_DEFAULT_LIMIT = 20;
export const TRADES_MAX_LIMIT = 50;

const Ident = z.string().trim().regex(IDENT_RE);
const Limit = z.number().int().min(1);

function ident(v: unknown): string | null {
  const r = Ident.safeParse(v);
  return r.success ? r.data : null;
}

function limitOf(v: unknown, fallback: number, max: number): number {
  if (v === undefined || v === null) return fallback;
  const r = Limit.safeParse(v);
  if (!r.success) throw new Error("INVALID_INPUT");
  return Math.min(r.data, max);
}

/** { slug } (slug or symbol) -> the identifier, or null when malformed. */
export function parseSlugInput(input: unknown): { slug: string | null } {
  const r = z.object({ slug: z.unknown() }).safeParse(input);
  return { slug: r.success ? ident(r.data.slug) : null };
}

export function parseCandlesInput(input: unknown): { symbol: string | null; interval: CandleInterval; limit: number } {
  const r = z
    .object({ symbol: z.unknown(), interval: z.enum(["1h", "1d"]), limit: z.unknown().optional() })
    .safeParse(input);
  if (!r.success) throw new Error("INVALID_INPUT");
  const symbol = ident(r.data.symbol);
  return {
    symbol: symbol ? symbol.toUpperCase() : null,
    interval: r.data.interval,
    limit: limitOf(r.data.limit, CANDLES_DEFAULT_LIMIT, CANDLES_MAX_LIMIT),
  };
}

export function parseTradesInput(input: unknown): { symbol: string | null; limit: number } {
  const r = z.object({ symbol: z.unknown(), limit: z.unknown().optional() }).safeParse(input);
  if (!r.success) throw new Error("INVALID_INPUT");
  const symbol = ident(r.data.symbol);
  return {
    symbol: symbol ? symbol.toUpperCase() : null,
    limit: limitOf(r.data.limit, TRADES_DEFAULT_LIMIT, TRADES_MAX_LIMIT),
  };
}

/** { id } -> a company uuid, or null when malformed. */
export function parseCompanyInput(input: unknown): { id: string | null } {
  const r = z.object({ id: z.string().uuid() }).safeParse(input);
  return { id: r.success ? r.data.id.toLowerCase() : null };
}
