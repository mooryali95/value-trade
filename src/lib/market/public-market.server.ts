/**
 * Public market data: server-side reads. The ONE way the app loads a listed
 * instrument's market data (getPublicInstrument and the trade page's
 * getTradeInstrument both go through loadPublicInstrument).
 *
 * Reads run with the publishable (anon) key, never the service role: the
 * database functions (public_*, SECURITY DEFINER, see
 * 20260925100000_public_market_data.sql) are the only thing anon may call,
 * they cover published instruments only and return no user, order or trade
 * ids. Failures are logged here (code only) and surface to the browser as
 * the stable code MARKET_DATA_UNAVAILABLE.
 */
import { getPublicClient } from "@/lib/trading/book.server";
import {
  bandReferenceOf,
  mapCandleRow,
  mapCompanyProfile,
  mapInstrumentDetailRow,
  mapInstrumentRow,
  mapRows,
  mapRulingRow,
  mapSummaryRow,
  mapTradeRow,
  type CandleInterval,
  type MarketOverview,
  type PublicCandle,
  type PublicCompanyProfile,
  type PublicInstrumentDetail,
  type PublicShariahRuling,
  type PublicTrade,
} from "./public-market.mappers";

let client: ReturnType<typeof getPublicClient> | undefined;

function db() {
  if (!client) {
    try {
      client = getPublicClient();
    } catch {
      console.error("[public-market] client unavailable");
      throw new Error("MARKET_DATA_UNAVAILABLE");
    }
  }
  return client;
}

function fail(op: string, error: { code?: string } | null | undefined): never {
  console.error(`[public-market] ${op} failed`, error?.code ?? "unknown");
  throw new Error("MARKET_DATA_UNAVAILABLE");
}

export async function loadMarketOverview(): Promise<MarketOverview> {
  const c = db();
  const [rows, summary] = await Promise.all([
    c.rpc("public_market_overview", {}),
    c.rpc("public_market_summary"),
  ]);
  if (rows.error) fail("overview", rows.error);
  if (summary.error) fail("summary", summary.error);
  const summaryRow = Array.isArray(summary.data) ? summary.data[0] : summary.data;
  return {
    instruments: mapRows(rows.data, mapInstrumentRow),
    summary: mapSummaryRow(summaryRow ?? null),
  };
}

/** A published instrument by slug or symbol (case-insensitive), or null. */
export async function loadPublicInstrument(
  slugOrSymbol: string,
): Promise<{ instrument: PublicInstrumentDetail; bandReference: number | null } | null> {
  const { data, error } = await db().rpc("public_instrument", { _slug: slugOrSymbol });
  if (error) fail("instrument", error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const instrument = mapInstrumentDetailRow(row);
  return instrument ? { instrument, bandReference: bandReferenceOf(row) } : null;
}

export async function loadCandles(symbol: string, interval: CandleInterval, limit: number): Promise<PublicCandle[]> {
  const { data, error } = await db().rpc("public_candles", { _symbol: symbol, _interval: interval, _limit: limit });
  if (error) fail("candles", error);
  return mapRows(data, mapCandleRow);
}

export async function loadRecentTrades(symbol: string, limit: number): Promise<PublicTrade[]> {
  const { data, error } = await db().rpc("public_recent_trades", { _symbol: symbol, _limit: limit });
  if (error) fail("recent trades", error);
  return mapRows(data, mapTradeRow);
}

export async function loadShariahRulings(): Promise<PublicShariahRuling[]> {
  const { data, error } = await db().rpc("public_shariah_rulings");
  if (error) fail("shariah rulings", error);
  return mapRows(data, mapRulingRow);
}

export async function loadCompanyProfile(id: string): Promise<PublicCompanyProfile | null> {
  const c = db();
  const [company, instruments] = await Promise.all([
    c.rpc("public_company_profile", { _id: id }),
    c.rpc("public_market_overview", { _company_id: id }),
  ]);
  if (company.error) fail("company profile", company.error);
  if (instruments.error) fail("company instruments", instruments.error);
  const row = Array.isArray(company.data) ? company.data[0] : company.data;
  return mapCompanyProfile(row ?? null, mapRows(instruments.data, mapInstrumentRow));
}
