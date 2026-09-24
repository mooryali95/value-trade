# Market data — where every number comes from

Value Unit is not connected to an external exchange or price vendor. Every
price, chart, statistic and ruling a user sees is read from the platform's
own database. There is no mock, sample or generated market data in the app,
and no provider layer to switch between (the former `src/lib/integrations`
mock/live/internal providers and `src/lib/mock-data.ts` were removed).

## Sources

| What the UI shows | Source |
| --- | --- |
| Listed instruments, board, search | `getMarketOverview()` → `public_market_overview()` (published instruments only) |
| Market totals (listed count, trades and value in 24h, last trade time) | `getMarketOverview().summary` → `public_market_summary()` |
| Instrument page / trade desk header, day open/high/low, allowed price range | `getPublicInstrument({ slug })` → `public_instrument()` |
| Candlestick chart (1h clock hours, 1d Asia/Riyadh days) | `getCandles({ symbol, interval })` → `public_candles()`; only buckets that have trades |
| Recent trades | `getRecentTrades({ symbol })` → `public_recent_trades()` |
| Order book | `getBook({ symbol })` (`src/lib/trading/book.functions.ts`) → `get_order_book()`; price levels only |
| Shariah ruling in force | `shariahStatus` on each instrument / `getPublicShariahRulings()` |
| Company profile | `getPublicCompanyProfile({ id })` → `public_company_profile()` |

The server functions live in `src/lib/market/public-market.functions.ts`
and read with the publishable key; see SECURITY.md for the access model.
Client helpers (the shared `useMarketOverview` hook, price/change
formatting, empty and error states) are in `src/components/market-data.tsx`
and `src/components/market-panels.tsx`.

## Display rules

- **Price** is the last executed trade. Before the first trade the UI shows
  the listing **reference price** (set by a platform admin) and labels it
  as such ("Ref."); it never presents it as a traded price.
- **24h change** is shown only when there is a comparable trade; otherwise a
  dash.
- **Day open/high/low** come from today's (Asia/Riyadh) trades; without
  trades today they are shown as a dash.
- **Allowed price range** is the band the matching engine enforces today
  (`bandLow`–`bandHigh`, ±20% of the band reference on the 0.01 tick).
- **Portfolio valuation** uses the same mark (last trade, else reference,
  labelled). A held instrument that is not published (for example a
  delisted one) has no market price: it is carried at cost and shows no
  unrealized P/L.
- Timestamps are shown in Asia/Riyadh time.
- No "live", "real-time" or "market open" claims: the engine matches
  continuously and the UI polls; it shows the time of the last trade
  instead.

## Empty and error states

- No published instrument: the landing page and the market show a designed
  "first listings coming soon" state that invites companies to request
  access.
- Listed but not traded: charts, trade tapes and movers say "no trades yet".
- A database failure throws `MARKET_DATA_UNAVAILABLE`; pages and panels show
  a retryable "market data temporarily unavailable" message, never a
  fallback to invented data.

## Listing an instrument

A platform admin sets the reference price and publishes (or unpublishes) an
instrument from `/admin/investors` (listing section), which calls
`setReferencePrice` and `setInstrumentPublished`
(`src/lib/admin/listing.functions.ts`). Unpublishing closes the
instrument's resting orders; holders keep their units.

## If an external feed is ever added

Add it as a server-side source that writes into the database (or a new
server function with the same shapes as the public market API), keep the
vendor key inside the server handler, and keep the rule that an upstream
failure is an explicit error state, never a silent fallback to other data.
