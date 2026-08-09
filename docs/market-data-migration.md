# Live Market Data — Migration Plan

The UI only ever talks to `getMarketProvider()` (`src/lib/integrations/provider.ts`).
Migration therefore never touches components.

## Decision: internal, not external

Value Unit is not connected to an external exchange (Tadawul/Mubasher) --
it's an internal institutional trading platform, so "real" prices are
derived from actual trades placed on the platform itself, not a vendor
feed. The external-vendor path below (stages 1-4) remains available for a
future scenario where an external feed *is* wanted, but the currently
active provider is **internal**, not live.

## Internal provider (active: `VITE_MARKET_PROVIDER=internal`)

- `internal-provider.ts` overlays real price/change/volume on mock
  metadata, same "hybrid" shape as `live-provider.ts` -- but the source is
  `get_market_snapshot()` / `get_symbol_market_stats()`
  (20260809161927_internal_market_data.sql), SECURITY DEFINER aggregates
  over the real `orders` table.
- Cold start: a symbol with zero filled orders has no real trade yet, so
  the mock reference price (100) stands until the first real trade sets
  it. This is the agreed default, not a bug.
- `place-order.functions.ts`: market orders now fill at the real
  last-traded price (`get_symbol_last_trade`) instead of the static mock
  price, so the displayed price and the execution price share one source
  of truth. Limit orders still use the trader's own specified price.
- Scope explicitly **not** included here: a real limit-order-matching
  engine. Execution is still "instant fill at the reference price" for
  every order type -- building actual order-book matching (limit orders
  resting until matched against opposing market orders) is a separate,
  materially larger project, deferred by agreement.

## External-vendor path (available, not currently active)

1. **Mock only.** `mock-provider.ts` registers itself; deterministic data.
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

