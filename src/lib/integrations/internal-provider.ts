import { mockProvider } from "./mock-provider";
import { getInternalMarketSnapshot, getInternalSymbolStats } from "./internal-market.functions";
import type { MarketDataProvider } from "./provider";
import type { Instrument } from "./types";

/**
 * Internal provider: no external vendor at all. Price/change/volume are
 * derived from real orders placed on Value Unit itself (see
 * 20260809161927_internal_market_data.sql). Metadata (name, sector, logo)
 * and candles/order-book still come from the mock provider -- same
 * "hybrid, symbol-by-symbol" shape as liveProvider, just with an internal
 * data source instead of an HTTP vendor.
 *
 * Cold start: a symbol with zero filled orders has no real trade yet, so
 * last_price comes back null from the RPC -- falls back to the mock
 * reference price (100), matching the same fallback already used by
 * mock-provider.ts / generateCandles / generateOrderBook. This is a
 * deliberate, explicit choice (not a bug): a brand's price is 100 until its
 * first real trade sets it, per the agreed default.
 */
export const internalProvider: MarketDataProvider = {
  id: "internal",

  async listInstruments(): Promise<Instrument[]> {
    const base = await mockProvider.listInstruments();
    const { rows } = await getInternalMarketSnapshot({
      data: { symbols: base.map((i) => i.symbol) },
    });
    if (!rows.length) return base;
    const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
    return base.map((i) => {
      const r = bySymbol.get(i.symbol);
      if (!r || r.last_price === null) return i; // no trades yet -> mock reference price stands
      return {
        ...i,
        price: r.last_price,
        change24h: r.change_24h_pct ?? 0,
        volume24h: r.volume_24h,
      };
    });
  },

  async getInstrument(slug: string) {
    const base = await mockProvider.getInstrument(slug);
    if (!base) return undefined;
    const stats = await getInternalSymbolStats({ data: { symbol: base.symbol } });
    if (!stats || stats.last_price === null) return base;
    return {
      ...base,
      price: stats.last_price,
      change24h: stats.change_24h_pct ?? 0,
      volume24h: stats.volume_24h,
    };
  },

  getCandles: (slug, count) => mockProvider.getCandles(slug, count),
  getOrderBook: (slug) => mockProvider.getOrderBook(slug),
};
