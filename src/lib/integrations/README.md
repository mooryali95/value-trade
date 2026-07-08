# Market Data Integrations

UI code never imports mock data directly — it calls `getMarketProvider()`.

## Swap the provider

1. Implement `MarketDataProvider` from `./provider.ts`.
2. Call `setMarketProvider(myProvider)` before the router renders (e.g. from
   `src/router.tsx` or `src/start.ts`).
3. Remove the auto-register line at the bottom of `mock-provider.ts`.

## Planned providers

- Tadawul (Saudi Exchange)
- Mubasher (GCC feed)
- TradingView (charts overlay)

All UI components consume `Instrument`, `Candle`, `OrderBookLevel`, `Trade`
from `./types.ts` — do not add provider-specific fields to the shared shape.