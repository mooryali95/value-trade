# Security Policy — Value Unit

## Reporting a Vulnerability

Report privately to the platform operator with a description, reproduction
steps and impact assessment. **Owner input pending:** the monitored security
mailbox is not confirmed yet (`SITE.securityEmail` in `src/lib/config/site.ts`
is empty, and the address `security@valueunit.app` published earlier is on a
domain the site does not use). Until the owner confirms it, no response-time
commitment is made here.

Do **not** file public GitHub issues for security reports.

## Scope

- Web application at `value-trade.lovable.app` and any custom domain.
- Public API routes under `/api/public/*`.
- Multi-tenant data isolation between companies.

## Out of Scope

- Attacks requiring physical access or social engineering.
- Rate-limit bypass on unauthenticated endpoints beyond documented limits.
- Findings against dependencies with no exploitable impact on Value Unit.

## Controls in Place

Value Unit is a **private market for brand units**: companies list brand
units, and only invited, admin-activated investors trade them.

- **Invitation-only access.** There is no self-service trading account. Sign-up
  creates a profile only; the global `trader` role is granted by a platform
  admin (investor activation), and access requests are approved into
  invitations (`approve_access_request`). New portfolios start at **cash 0**;
  money only arrives through an admin deposit (`adjustCash` →
  `post_cash_movement`), recorded in `cash_ledger` and in `audit_log`.
  `user_roles` is read-only for every API user (no write grant, no write
  policy); only the server changes roles. Deactivating an investor
  (`deactivate_trader`) revokes the role and cancels all of their open orders
  in one transaction, and the engine never fills a resting order whose owner
  no longer holds the `trader` role.
- **Financial tables are read-only for users.** `portfolios`, `positions`,
  `orders`, `orders_audit`, `cash_ledger` and `trades` grant `SELECT` (own rows)
  and nothing else to `authenticated`; `anon` has no access. Every change goes
  through `SECURITY DEFINER` functions that only `service_role` may execute
  (`match_order`, `cancel_order`, `replace_order`, `restore_order`,
  `post_cash_movement`), called by server functions with the verified JWT user
  id. Users cannot read trade counterparties (`trades.buyer_id/seller_id`).
- **Engine-enforced market rules** (inside `match_order`, not only in the UI or
  TypeScript): whole-unit quantities (1 – 10,000,000), 0.01 price tick,
  published instrument only, a ±20% daily price band anchored on the previous
  close (the last trade before the current Asia/Riyadh trading day, else the
  instrument's listing reference price) so trades during the day cannot walk
  it, every execution price kept inside that band, max order notional
  5,000,000, buying power and holdings checks that include the trader's other
  resting orders (one order path per trader at a time), self-trade prevention
  (an order that would cross the trader's own resting order is refused with
  `SELF_TRADE`), and market-order price protection (a market order never
  rests; any remainder outside the band is cancelled). Each fill debits and
  credits the identical rounded amount, and the per-trader and per-symbol
  locks plus ordered row locks keep settlement atomic and deadlock-free.
- **Shariah enforcement in the engine.** The ruling in force is the most
  recent change for the symbol (a new `shariah_decisions` row, or a status
  edit of an existing one; tracked in `effective_at`). Buys on a `non_halal` symbol are
  refused (`SHARIAH_BLOCKED`), and a new `non_halal` ruling cancels every
  resting buy on that symbol in the same transaction (audited in
  `orders_audit`). Sells stay allowed so holders can exit. Reviewer identity on
  rulings and their audit trail is stamped from the session, never from client
  input.
- **Instrument integrity.** Company owners may edit descriptive brand fields
  only; `symbol`, `company_id` and `reference_price` change only through the
  service role or a platform admin (trigger `brands_guard`), and `published`
  changes only inside `set_instrument_published` (no API caller, not even a
  platform admin or the service role, can insert a published brand or flip
  the flag directly). Product submissions follow one lifecycle, enforced in
  SQL (`20260926101000_submission_lifecycle.sql`, see *Submission to listing
  lifecycle* below); submission documents must belong to a
  submission of the same company and live under
  `<company_id>/<submission_id>/`. Units of a listed brand enter the market
  only through primary issuance (`issue_units`, platform admins, recorded in
  `unit_issuances` and `audit_log`) and move only through trades.
- **Explicit privileges.** Every public table and function has an explicit
  grant allow-list (Supabase default privileges are revoked). The RLS helper
  functions (`has_role`, `has_company_role`, `is_company_owner`,
  `is_company_member`) stay executable by `authenticated` because RLS policies
  call them.
- **Row-Level Security** on every user-facing table; cross-tenant access tests in `src/lib/security/rls-cross-tenant.test.ts`.
- **RBAC** per company role (owner / finance / shariah / trader / viewer) enforced in both UI (`AccessDenied` guards) and server functions (`requireSupabaseAuth` + role checks).
- **Audit log** (`public.audit_log`) recording sensitive actions with owner-only read access. Append-only: only the server (service role) inserts, with the verified actor id; users cannot write, update or delete rows.
- **Stable error codes.** Server functions return `UPPER_SNAKE` codes (e.g. `INSUFFICIENT_CASH`, `ORDER_NOT_OPEN`); database and driver messages are logged server side and never sent to the browser.
- **HMAC-signed** public webhooks/cron (`/api/public/cron-alerts`, others).
- **Rate limiting** on public routes via `public.check_rate_limit`: fixed
  windows aligned on the epoch (one counter row per key and window), each row
  kept until its own window has ended, so hourly and daily limits (e.g. 3
  access requests per address per day) hold as configured.
- **HIBP** leaked-password protection: enable it in the Supabase Auth settings
  (Lovable Cloud) and confirm it there; the app maps the resulting Auth errors
  to stable codes.
- **Security headers** on every response the worker renders (see *Security
  headers* below).
- **HTTPS** enforced by hosting (HSTS). The Supabase session is kept in the
  browser's `localStorage` (key `sb-*-auth-token`), not in a cookie: it is
  protected by the absence of script injection (React escaping, no
  `dangerouslySetInnerHTML` of user data, sandboxed e-mail previews), not by
  cookie flags. There is no script-src CSP yet; add a nonce-based one when
  TanStack Start supports it.
- **Stable error codes end to end.** A global server-function middleware
  (`src/start.ts`) turns any other failure (validator issue lists, the auth
  middleware's "Unauthorized: ..." text, library messages) into
  `INVALID_INPUT`, `NOT_AUTHENTICATED` or `INTERNAL_ERROR`.
- **Notifications of unlisted instruments.** Rulings, prices and position
  news are e-mailed only for instruments listed on the market; watch lists
  and price alerts accept listed instruments only (RLS), at most 100 of each
  per account.

## Public market data

The market pages are public (no sign-in), and every number they show comes
from the database; nothing is generated.

- **Read path.** Browser-facing reads go through server functions in
  `src/lib/market/public-market.functions.ts` (`getMarketOverview`,
  `getPublicInstrument`, `getCandles`, `getRecentTrades`,
  `getPublicShariahRulings`, `getPublicCompanyProfile`; the trade page's
  `getTradeInstrument` is an alias of the same loader). They use the
  publishable (anon) key, never the service role, and call `SECURITY
  DEFINER` functions that anon may execute: `public_market_overview`,
  `public_market_summary`, `public_instrument`, `public_candles`,
  `public_recent_trades`, `public_shariah_rulings`,
  `public_company_profile` (plus `get_order_book` and
  `get_symbol_last_trade`). Failures reach the browser as
  `MARKET_DATA_UNAVAILABLE`.
- **Published instruments only.** Every function, including the order book
  and last trade, answers for `brands.published` instruments only; a company
  appears only when it has a published instrument.
- **No identities.** Results are aggregates and trade prints (price,
  quantity, time): never a user id, order id, trade id, issuance holder or
  Shariah reviewer. The only uuid returned is a company id. anon cannot read
  `shariah_decisions` at all (public pages use `public_shariah_rulings`);
  signed-in users read the rulings of published instruments only and never
  `reviewer_id` / `updated_by`; Shariah board members and platform admins
  read every ruling (the review console's `listShariahDecisions` requires one
  of those roles).
- **Caps.** Board ≤ 1000 rows, candles ≤ 500 hourly or ≤ 366 daily buckets,
  trade tape ≤ 50 prints, order book depth ≤ 50. `public_candles` walks the
  buckets newest first with one index probe per bucket and reads only the
  trades inside the buckets it returns, never a symbol's whole history; open
  and close are single index probes and the other aggregates an index-only
  scan of `idx_trades_symbol_time_cover`, with JIT off
  (`20260926101100_public_candles_cost.sql`; on 1,000,000 trades of one
  symbol: 1 bucket ~2-5 ms, 200 daily buckets of ~2,000 trades each
  ~100 ms, 366 daily buckets ~200 ms).
- **Same definitions as the engine.** Last price = last trade; 24h change vs
  the last trade at least 24h old, else the first trade in the window;
  volume counted once per trade; trading day = Asia/Riyadh; the band shown
  (`bandLow`/`bandHigh`) is `band_reference_price()` ± 20% on the 0.01 tick,
  exactly the limit prices `match_order` accepts; the Shariah status is
  `current_shariah_status()`. Before the first trade the UI shows the
  listing reference price, labelled as such, never as a trade price.
- **Listing control.** Only a platform admin lists or delists an instrument
  (`setInstrumentPublished` → `set_instrument_published`, service role
  only; the `brand.publish` / `brand.unpublish` audit row is written in the
  same transaction). Listing needs a reference price set by an admin (0
  means "not set", the column default) and a Shariah ruling in force
  (`SHARIAH_RULING_REQUIRED`), so every listed instrument carries one. Price
  alerts fire on the last traded price of listed instruments only, never on
  a reference price. Delisting closes
  the instrument's resting orders in the same transaction (`orders_audit`
  action `delisted`) under the engine's symbol lock; positions, cash and
  trades are untouched. A resting order can never be written for an
  unpublished instrument (trigger), and a published instrument always has a
  reference price in (0, 1,000,000,000] (check constraint), so its band
  always exists.
- **Demo listings removed.** `20260925100200_delist_demo_instruments.sql`
  unpublished every seeded demo instrument (brands with no company and no
  source submission: real listed issuers with invented prices and synthetic
  brands) and closed their resting orders. Rows are kept.
  `20260925110100_unlist_unconfirmed_instruments.sql` then took off the
  market every instrument whose reference price no platform admin set (the
  old approval path published at a default of 100, or kept a seed's price)
  or that has no ruling in force, and reset every unconfirmed price of an
  unlisted instrument to 0, so nothing can be republished at an invented
  price: an admin sets a real reference price first. It creates **no**
  Shariah ruling (an earlier, never-applied draft recorded 'halal' rulings in
  the approving reviewer's name for legacy approvals; nobody made those
  rulings, so they are not invented). A legacy approval without a ruling
  leaves the market; a Shariah reviewer rules on it from the review console,
  which lists unpublished instruments too, and an admin lists it again.

## Submission to listing lifecycle

Every transition is one `SECURITY DEFINER` function (service role only; the
server checks the caller's role first and passes the verified user id, and the
function checks it again), in one transaction with its audit row:

| From | To | Who | Function |
| --- | --- | --- | --- |
| (new) | `pending` | company owner / finance | insert (RLS; the guard forces `pending`) |
| `pending` | `approved` / `rejected` | Shariah reviewer (`shariah_board`) | `review_submission` |
| `approved` | `listed` | platform admin | `approve_listing` (or listing the instrument with `set_instrument_published`) |
| `approved` | `rejected` | platform admin | `decline_listing` (reason required) |

- **Approval** creates the company's instrument off the market with reference
  price 0 (or updates the company's own existing instrument, never its price
  or listing state; another company's symbol is `SYMBOL_TAKEN`), records the
  reviewer's `halal` ruling unless a `halal` ruling is already in force, and
  flips the status, all together or not at all. A `non_halal` or `reviewing`
  ruling in force is never overridden silently: the approval fails with
  `SHARIAH_RULING_CONFLICT` unless the reviewer explicitly replaces it with a
  written reason (`RULING_CHANGE_REASON_REQUIRED` otherwise). A rejection
  needs a reason of 10+ characters, which the company sees.
- **Listing** (`approve_listing`) needs the `halal` ruling in force
  (`SHARIAH_RULING_REQUIRED` / `SHARIAH_NOT_HALAL`), sets the reference price
  (database price rules apply; audited as `brand.reference_price`), lists the
  instrument through `set_instrument_published`, optionally allocates the
  first units to one of the company's owner / finance members through
  `issue_units`, and marks the submission `listed`.
- **Symbols** are normalized on submission (upper case, trimmed) and must
  match `^[A-Z0-9._-]{1,32}$` (`INVALID_SYMBOL`).
- **Concurrency.** Each function locks the submission row (`FOR UPDATE`) and
  the engine's per-symbol lock, so two reviewers deciding at the same moment
  serialize: one decision wins, the other gets `SUBMISSION_NOT_PENDING`, and
  exactly one ruling is written.
- **No direct writes.** `authenticated` has no UPDATE on
  `product_submissions` and the reviewer UPDATE policy is gone; the guard
  refuses any change of a decision field from an API role (including the
  service role) outside these functions (`SUBMISSION_TRANSITION_FORBIDDEN`),
  and refuses any transition not in the table above for every caller.
- **Rulings on unlisted instruments.** `reviewer_instruments` lists every
  instrument (listed or not) with the ruling in force for Shariah reviewers
  and platform admins, so a reviewer can rule on an unpublished instrument
  before it is listed; `recordShariahDecision` accepts existing instruments
  only.

## Data integrity report

`public.integrity_report()` (service role only, read-only) returns named
checks with the number of violating rows and up to five sample keys:
`cash_matches_ledger`, `trade_cash_balanced`, `no_negative_cash`,
`units_match_history`, `units_conserved_per_symbol`, `no_negative_positions`,
`orders_fill_within_qty`, `no_resting_on_unpublished`,
`trades_reference_orders`, `published_ready`, `cost_basis_not_negative`.
`/admin/health` (`getPlatformHealth`, platform admins) lists each as
`integrity.<check>` with pass / fail. Run it after the migrations bundle and
after the go-live reset; every check must pass before investors are invited.
Legacy rows written before the engine (fills without trades, balances
without ledger rows) show up here until the go-live reset clears them.

## Security headers

`src/server.ts` adds these to every response the worker renders (SSR HTML,
server functions, API routes), without overriding a header a handler set
(`src/lib/ops/security-headers.ts`, tested in `security-headers.test.ts`):

| Header | Value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (HTTPS requests; no `preload`) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation, payment, USB, interest-cohort, browsing-topics off |
| `Content-Security-Policy` | `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'` |
| `X-Frame-Options` | `DENY` |

Framing is refused on the production hosts only: Lovable's editor shows the
app in an iframe on its preview / dev hosts (`id-preview--*.lovable.app`,
`*-dev.lovable.app`, `*.lovableproject.com`) and on localhost, which get the
same headers without `frame-ancestors` / `X-Frame-Options`. Static files in
`public/` are served by the host before the worker; `public/_headers`
(copied to `.output/public/_headers`, which Cloudflare static assets honour)
gives them the non-framing subset.

Checked on the production build (`npx vite build`, preset
`cloudflare-module`): requests to the built worker (`.output/server`) for
`/`, `/market` and a 404 carry every header above; a preview host gets the
same set without the framing headers.

There is **no script CSP** (`script-src` / `default-src`): TanStack Start
streams inline `<script>` tags for SSR hydration without a nonce hook, so a
script policy would either need `'unsafe-inline'` (no protection) or break
hydration. Revisit when the framework supports per-request nonces.

## Launch migration bundle

The migrations from `20260924100000` onward are applied to production once,
as one transaction, from `supabase/ops/launch_bundle.sql` (generated by
`supabase/ops/build_launch_bundle.sh`; tested on a production-like legacy
database by `supabase/ops/test_launch_bundle.sh`, which also checks that the
resulting schema is identical to applying the migrations one by one). The
bundle refuses to run twice (`LAUNCH_BUNDLE_ALREADY_APPLIED`) and records
each version in `supabase_migrations.schema_migrations`. See
`supabase/ops/README.md`.

## Data Retention & Backups

| Data | Retention | Notes |
| --- | --- | --- |
| `audit_log` | 24 months | Append-only (server-side inserts only; no user INSERT/UPDATE/DELETE); owner-only read; CSV export from `/company/audit`. |
| `shariah_decision_audit` | Indefinite | Regulatory trail for Shariah rulings; append-only via trigger. |
| `cash_ledger`, `orders`, `positions` | Indefinite | Financial records; ledger is the single source of truth for balances. |
| `email_send_log` | 90 days | Operational only; older rows may be pruned. |
| `rate_limits` | Until the row's own window ends (at least 1 hour) | Auto-pruned by `public.check_rate_limit`. |
| `email_unsubscribe_tokens` | 12 months | Single-use tokens, marked `used_at`. |
| Storage `submission-docs` | Lifetime of the submission + 24 months | Private bucket (created private by migration 20260926101500, which also drops any client policy on its objects); access via short-lived signed URLs (120 s). |

**Backups** — the managed Postgres instance takes automated daily backups with
point-in-time recovery on the platform tier. Restore drills are performed
quarterly against a scratch project; results recorded in the internal runbook.
Never restore a production snapshot over a live database without rotating API
keys afterwards.

**Deletion requests** — a user deletion removes `auth.users`, cascading to
profiles, alerts, watchers and preferences. Financial and audit records are
retained in de-identified form (actor UUID only) to satisfy record-keeping
obligations.

## Scheduled Jobs

| Job | Endpoint | Cadence | Auth |
| --- | --- | --- | --- |
| Price alert scan | `POST /api/public/cron-alerts` | every minute | Service-role bearer (pg_cron), or `x-timestamp` (Unix seconds) + `x-signature` = hex HMAC-SHA256 (`CRON_ALERTS_SECRET`) of `"<x-timestamp>.<raw body>"`, accepted within 300 s of the timestamp |
| Email queue drain | `POST /lovable/email/queue/process` | every 5 s while queued | service-role bearer, self-disarming |

The price-alert scan is scheduled in production as `pg_cron` job
`scan-price-alerts` (`* * * * *`). It authenticates with a service-role bearer
read from the vault; external callers must instead sign
`"<x-timestamp>.<raw body>"` with `CRON_ALERTS_SECRET` (a signed request is
refused 5 minutes after its timestamp, so a captured one cannot be replayed
later). Each run reads the active alerts page by page (no API row cap).
Every run appends a row to `public.ops_run_log`
(platform-admin read only), surfaced at `/admin/ops` with the last run time,
result and metrics.

## Post-deploy smoke suite

`/admin/ops` runs a platform-admin-only smoke suite (`runSmokeSuite`) that
covers: session + profile resolution, RBAC via `has_role`, a database
write/delete round-trip, the `post_cash_movement` ledger guard rejecting an
invalid movement, the Shariah buy-block (`non_halal` blocks buy, sell stays
allowed), a real branded email send to the operator's own inbox, and the
authenticated cron endpoint. The report is written to `ops_run_log` under job
`smoke`. The target origin is validated against the exact origin allow-list
(see *Configuration*; localhost only outside production builds) to prevent
SSRF.

## Configuration

Server-side environment variables (never exposed to the browser):

| Variable | Purpose | If unset |
| --- | --- | --- |
| `APP_ORIGIN` | Canonical public origin (e.g. `https://hub.sunkvalue.com`). Used for every absolute link in emails (invitations, price alerts, Shariah notices), robots.txt and the sitemap. | Legacy `PUBLIC_SITE_URL` / `PUBLIC_APP_ORIGIN`, then the current request's origin if it is on the allow-list, then `https://hub.sunkvalue.com`. **Set it on any other domain**, or emails link to hub.sunkvalue.com. |
| `APP_ALLOWED_ORIGINS` | Comma-separated exact origins the server may link to or call (smoke suite), in addition to `APP_ORIGIN` and the known production hosts. No wildcards. | Only `APP_ORIGIN` and the built-in production hosts are allowed. |
| `CRON_ALERTS_SECRET` | HMAC-SHA256 key for external callers of `POST /api/public/cron-alerts` (signs `"<x-timestamp>.<body>"`). | Only the service-role bearer (pg_cron) is accepted; the smoke suite's cron check reports a warning. With neither configured the endpoint answers 503. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role for trusted server code (engine calls, audit writes, cron bearer). | Server functions that move money or write audit rows fail closed. |

## Launch reconciliation

Before launch users could write their own orders, positions and cash. The
migrations close that path and deal with existing rows
(`20260924100900_legacy_state_cleanup.sql`):

- every order still resting at migration time is closed (`orders_audit`
  action `legacy_close`); owners place it again (or `restoreOrder` re-places
  it as a new order), which runs every engine check;
- accounts whose balances cannot be explained are put on hold in
  `public.launch_review_holds` (service role only) and lose the `trader` role:
  `unexplained_cash` when the opening-balance reconciliation exceeds the old
  100,000.00 default plus the result of the pre-engine fills whose cash was
  written straight to the balance (before 2026-08-12; valued at their fill
  price, sales only where the units reconcile), `unexplained_units` when a
  position exceeds issuances + units bought − units sold (+ pre-engine
  fills). Balances are not changed.

The old app filled every order at once at the investor's own limit price,
without a price band, so a balance it produced is explained even when the
fill prices were far from the market. Check the largest pre-engine results
before launch as well (last query below).

Review every hold before launch (`/admin/investors` shows a "legacy balance
under review" badge; activating the investor records the review):

```sql
-- Open holds
SELECT h.user_id, h.reason, h.detail, h.had_trader_role, h.created_at
  FROM public.launch_review_holds h WHERE h.resolved_at IS NULL ORDER BY h.created_at;

-- Positions vs. issuances + net trades (should return no rows)
WITH moves AS (
  SELECT user_id, symbol, qty FROM public.unit_issuances
  UNION ALL SELECT buyer_id, symbol, qty FROM public.trades
  UNION ALL SELECT seller_id, symbol, -qty FROM public.trades
), expected AS (SELECT user_id, symbol, sum(qty) AS qty FROM moves GROUP BY 1, 2)
SELECT p.user_id, p.symbol, p.qty AS held, coalesce(e.qty, 0) AS explained
  FROM public.positions p LEFT JOIN expected e USING (user_id, symbol)
 WHERE p.qty <> coalesce(e.qty, 0);

-- Large opening-balance reconciliations
SELECT user_id, amount, balance_after, created_at FROM public.cash_ledger
 WHERE note = 'opening balance reconciliation' AND amount > 100000 ORDER BY amount DESC;

-- Pre-engine fills (no trade row): net cash result per investor
SELECT o.user_id, count(*) AS fills,
       sum(CASE WHEN o.side = 'sell' THEN 1 ELSE -1 END * coalesce(o.filled_price, o.price, 0)
           * CASE WHEN o.filled_qty > 0 THEN o.filled_qty ELSE o.qty END) AS net_cash
  FROM public.orders o
 WHERE o.status = 'filled'
   AND NOT EXISTS (SELECT 1 FROM public.trades t WHERE t.buy_order_id = o.id OR t.sell_order_id = o.id)
 GROUP BY o.user_id ORDER BY net_cash DESC;
```

## Sender domain (SPF / DKIM / DMARC)

Transactional and auth mail is sent from `noreply@notify.hub.sunkvalue.com`.
The subdomain is delegated to the platform nameservers (`ns5`/`ns6.lovable.cloud`),
which publish and rotate the records automatically:

| Record | Host | Purpose |
| --- | --- | --- |
| `TXT` (SPF) | `notify.hub.sunkvalue.com` | `v=spf1 include:…  ~all` — authorises the sending IPs |
| `TXT` (DKIM) | `<selector>._domainkey.notify…` | 2048-bit key signing every outbound message |
| `TXT` (DMARC) | `_dmarc.notify.hub.sunkvalue.com` | alignment policy + aggregate reports |
| `MX` | `notify.hub.sunkvalue.com` | bounce/complaint handling into the suppression list |

Domain status is verified; delivery is validated end to end by the
`email_pipeline` check in the smoke suite (a real send to the operator's inbox)
and by `email_send_log` at `/admin/email-log`. Never send from the apex domain
`sunkvalue.com` — reputation is isolated on the `notify.` subdomain.

See `docs/api-public.md` for the exact scheduling SQL and response contracts.

## Incident Response

1. Triage severity (Critical / High / Medium / Low).
2. Contain: rotate affected secrets (`supabase--rotate_api_keys`), disable compromised accounts.
3. Eradicate & recover: deploy fix, verify with `security--run_security_scan`.
4. Post-mortem within 5 business days; update this file and `.lovable/plan.md` with lessons learned.

## Contacts

- Security contact: **owner input pending** (see *Reporting a Vulnerability*).
- On-call: see internal runbook.