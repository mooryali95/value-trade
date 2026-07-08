import { BRANDS, generateCandles, generateOrderBook, getBrand } from "@/lib/mock-data";
import { setMarketProvider, type MarketDataProvider } from "./provider";
import type { Instrument } from "./types";

function toInstrument(b: (typeof BRANDS)[number]): Instrument {
  return {
    id: b.id, symbol: b.symbol, slug: b.slug, nameAr: b.nameAr, nameEn: b.nameEn,
    assetClass: b.assetClass ?? "brand", sector: b.sector, price: b.price,
    change24h: b.change24h, volume24h: b.volume24h, marketCap: b.marketCap, shariah: b.shariah,
  };
}

export const mockProvider: MarketDataProvider = {
  id: "mock",
  listInstruments: () => BRANDS.map(toInstrument),
  getInstrument: (slug) => { const b = getBrand(slug); return b ? toInstrument(b) : undefined; },
  getCandles: (slug, count = 180) => { const b = getBrand(slug); return generateCandles(slug, count, b?.price ?? 100); },
  getOrderBook: (slug) => { const b = getBrand(slug); return generateOrderBook(b?.price ?? 100, slug); },
};

setMarketProvider(mockProvider);