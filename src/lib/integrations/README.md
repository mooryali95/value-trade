# Market Data Integrations

UI code never imports mock data directly — it calls `getMarketProvider()`.

## Registration

`src/router.tsx` calls `registerMarketProvider()` (from `live-provider.ts`) at
boot. It picks the provider from `VITE_MARKET_PROVIDER`:

- `mock` (default) — deterministic local data.
- `live` — real prices via `market.functions.ts`, mock fallback for anything
  the vendor does not cover. See `docs/market-data-migration.md`.

## Adding a vendor

1. Implement `MarketDataProvider` from `./provider.ts`.
2. Read vendor credentials inside a `createServerFn` handler only.
3. Register it in `registerMarketProvider()`.

## Planned providers

- Tadawul (Saudi Exchange)
- Mubasher (GCC feed)
- TradingView (charts overlay)

All UI components consume `Instrument`, `Candle`, `OrderBookLevel`, `Trade`
from `./types.ts` — do not add provider-specific fields to the shared shape.
