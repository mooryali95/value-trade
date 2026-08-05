# Live Market Data — Migration Plan

The UI only ever talks to `getMarketProvider()` (`src/lib/integrations/provider.ts`).
Migration therefore never touches components.

## Stages

1. **Mock only (today).** `mock-provider.ts` registers itself; deterministic data.
2. **Shadow.** Set `MARKET_DATA_URL` + `MARKET_DATA_API_KEY` (server secrets) and
   `VITE_MARKET_PROVIDER=live`. `live-provider.ts` overlays real prices on mock
   metadata; any upstream failure silently falls back to mock.
3. **Depth & candles.** Replace `getCandles` / `getOrderBook` in `live-provider.ts`
   with vendor endpoints, one method at a time.
4. **Metadata.** Move instrument metadata into the database (`company_brands`)
   and drop the mock base layer.

## Contract rules

- No vendor-specific fields on `Instrument`, `Candle`, `OrderBookLevel`, `Trade`.
- The vendor key is read inside the server-function handler only.
- Upstream failures return `{ quotes: [], error }` — never throw into the UI.
