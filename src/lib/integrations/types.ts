import type { AssetClass, ShariahStatus } from "@/lib/mock-data";

export type Instrument = {
  id: string;
  symbol: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  assetClass: AssetClass;
  sector: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  shariah: ShariahStatus;
};

export type Quote = { price: number; change24h: number; ts: number };
export type OrderBookLevel = { price: number; qty: number };
export type Trade = { ts: number; price: number; qty: number; side: "buy" | "sell" };
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };