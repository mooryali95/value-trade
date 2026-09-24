import { createServerFn } from "@tanstack/react-start";
import {
  parseCandlesInput,
  parseCompanyInput,
  parseSlugInput,
  parseTradesInput,
  type CandleInterval,
  type MarketOverview,
  type PublicCandle,
  type PublicCompanyProfile,
  type PublicInstrumentDetail,
  type PublicShariahRuling,
  type PublicTrade,
} from "./public-market.mappers";

export type {
  CandleInterval,
  MarketOverview,
  MarketSummary,
  PublicCandle,
  PublicCompanyProfile,
  PublicInstrument,
  PublicInstrumentDetail,
  PublicShariahRuling,
  PublicTrade,
  ShariahStatus,
} from "./public-market.mappers";

/**
 * Public market API: callable without signing in. Everything comes from the
 * database (published instruments, executed trades, the Shariah ruling in
 * force); no user, order or trade id is ever returned. Numbers are JS
 * numbers, timestamps ISO 8601 (UTC) strings. When the database cannot be
 * read the functions throw the stable code MARKET_DATA_UNAVAILABLE; a bad
 * interval/limit throws INVALID_INPUT. A malformed or unknown slug/symbol is
 * "not found" (null / []), not an error.
 */

/** Every published instrument (by symbol, at most 1000) and the market summary. */
export const getMarketOverview = createServerFn({ method: "GET" }).handler(async (): Promise<MarketOverview> => {
  const { loadMarketOverview } = await import("./public-market.server");
  return loadMarketOverview();
});

/**
 * One published instrument by slug or symbol (case-insensitive), with
 * today's (Asia/Riyadh) open/high/low and the limit-price band the engine
 * enforces today. null when unknown or not published.
 */
export const getPublicInstrument = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => parseSlugInput(input))
  .handler(async ({ data }): Promise<PublicInstrumentDetail | null> => {
    if (!data.slug) return null;
    const { loadPublicInstrument } = await import("./public-market.server");
    return (await loadPublicInstrument(data.slug))?.instrument ?? null;
  });

/**
 * OHLCV candles ('1h' clock hours, '1d' Asia/Riyadh days), only buckets
 * that have trades, oldest first; the latest `limit` buckets (default 200,
 * at most 500). `volume` is in units.
 */
export const getCandles = createServerFn({ method: "GET" })
  .inputValidator((input: { symbol: string; interval: CandleInterval; limit?: number }) => parseCandlesInput(input))
  .handler(async ({ data }): Promise<PublicCandle[]> => {
    if (!data.symbol) return [];
    const { loadCandles } = await import("./public-market.server");
    return loadCandles(data.symbol, data.interval, data.limit);
  });

/** The trade tape, newest first (default 20, at most 50). */
export const getRecentTrades = createServerFn({ method: "GET" })
  .inputValidator((input: { symbol: string; limit?: number }) => parseTradesInput(input))
  .handler(async ({ data }): Promise<PublicTrade[]> => {
    if (!data.symbol) return [];
    const { loadRecentTrades } = await import("./public-market.server");
    return loadRecentTrades(data.symbol, data.limit);
  });

/** The ruling in force for each published instrument that has one, by symbol. */
export const getPublicShariahRulings = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicShariahRuling[]> => {
    const { loadShariahRulings } = await import("./public-market.server");
    return loadShariahRulings();
  },
);

/** A company linked to at least one published instrument, with those instruments; else null. */
export const getPublicCompanyProfile = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => parseCompanyInput(input))
  .handler(async ({ data }): Promise<PublicCompanyProfile | null> => {
    if (!data.id) return null;
    const { loadCompanyProfile } = await import("./public-market.server");
    return loadCompanyProfile(data.id);
  });
