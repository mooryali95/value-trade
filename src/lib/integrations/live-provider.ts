import { mockProvider } from "./mock-provider";
import { fetchUpstreamQuotes, MAX_SYMBOLS, type UpstreamQuote } from "./market.functions";
import { internalProvider } from "./internal-provider";
import { setMarketProvider, type MarketDataProvider } from "./provider";
import type { Instrument } from "./types";

/**
 * Quotes for `symbols`, fetched in chunks the server function accepts. Any
 * failure (signed out, rate limited, vendor down) yields no quotes so the
 * caller keeps the mock values.
 */
async function quotesFor(symbols: string[]): Promise<UpstreamQuote[]> {
  const out: UpstreamQuote[] = [];
  const valid = symbols.filter((s) => /^[A-Za-z0-9._-]{1,32}$/.test(s));
  for (let i = 0; i < valid.length; i += MAX_SYMBOLS) {
    try {
      const { quotes } = await fetchUpstreamQuotes({ data: { symbols: valid.slice(i, i + MAX_SYMBOLS) } });
      out.push(...quotes);
    } catch {
      return out;
    }
  }
  return out;
}

/**
 * Hybrid provider: prices come from the real feed when it answers, everything
 * the vendor does not cover yet (candles, order book, metadata) keeps coming
 * from the mock provider. This lets the migration land symbol-by-symbol
 * without changing a single UI component.
 */
export const liveProvider: MarketDataProvider = {
  id: "live",

  async listInstruments(): Promise<Instrument[]> {
    const base = await mockProvider.listInstruments();
    const quotes = await quotesFor(base.map((i) => i.symbol));
    if (!quotes.length) return base;
    const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
    return base.map((i) => {
      const q = bySymbol.get(i.symbol);
      return q
        ? { ...i, price: q.price, change24h: q.change24h, volume24h: q.volume24h ?? i.volume24h }
        : i;
    });
  },

  async getInstrument(slug: string) {
    const base = await mockProvider.getInstrument(slug);
    if (!base) return undefined;
    const quotes = await quotesFor([base.symbol]);
    const q = quotes[0];
    return q ? { ...base, price: q.price, change24h: q.change24h } : base;
  },

  getCandles: (slug, count) => mockProvider.getCandles(slug, count),
  getOrderBook: (slug) => mockProvider.getOrderBook(slug),
};

/** Registers the provider selected by `VITE_MARKET_PROVIDER` (default: mock). */
export function registerMarketProvider() {
  const chosen = import.meta.env["VITE_MARKET_PROVIDER"] ?? "mock";
  setMarketProvider(
    chosen === "live" ? liveProvider : chosen === "internal" ? internalProvider : mockProvider,
  );
}
