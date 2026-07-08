import type { Instrument, OrderBookLevel, Candle } from "./types";

export interface MarketDataProvider {
  readonly id: string;
  listInstruments(): Promise<Instrument[]> | Instrument[];
  getInstrument(slug: string): Promise<Instrument | undefined> | Instrument | undefined;
  getCandles(slug: string, count?: number): Promise<Candle[]> | Candle[];
  getOrderBook(slug: string): Promise<{ bids: OrderBookLevel[]; asks: OrderBookLevel[] }> | { bids: OrderBookLevel[]; asks: OrderBookLevel[] };
}

let current: MarketDataProvider | null = null;
export function setMarketProvider(p: MarketDataProvider) { current = p; }
export function getMarketProvider(): MarketDataProvider {
  if (!current) throw new Error("No market data provider registered");
  return current;
}