# End-to-end journey tests

Playwright drives the real app (`vite dev`, SSR included) in Chromium against a
real local database. Nothing here talks to the production Supabase project:
the app is started with the local stack's URL and keys, and every test fails if
a page sends a request anywhere but `127.0.0.1` / `localhost`.

```
npm run test:e2e                                  # repo root: stack up, all journeys, stack down
npm run test:e2e -- tests/trading.spec.ts         # one file (any Playwright arguments work)
npm run test:e2e -- --headed --debug              # watch / step through locally
```

`npm run test:e2e` runs `e2e/run.sh`, which installs `e2e/` dependencies when
missing (`npm ci`), starts a fresh stack, runs Playwright and always stops the
stack afterwards (also on failure or Ctrl-C).

## The stack (`e2e/stack/`)

| Piece | What it is |
| --- | --- |
| PostgreSQL 16 | a throwaway cluster in `$E2E_RUN_DIR/pgdata` on `127.0.0.1:$E2E_PG_PORT`. The database is built like the DB security suite does it (`supabase/tests/run.sh`): the stub extensions of `supabase/tests/stubs`, `supabase/tests/bootstrap.sql`, then every `supabase/migrations/*.sql` in order, each in one transaction, then `stack/seed.sql`. |
| PostgREST 12.2.3 | the REST API (roles `anon` / `authenticated` / `service_role`, a fresh HS256 secret per run). |
| `stack/gateway.mjs` | the "Supabase URL" the app is given: `/rest/v1` proxied to PostgREST, a GoTrue-compatible auth stub under `/auth/v1` backed by `auth.users` (password and refresh-token grants, `/user`, `/recover`, `/verify`, `/invite`, the admin user API and `generate_link`), and a small file-system `/storage/v1`. |
| the app | `vite dev` from the repository root with `VITE_SUPABASE_URL` / `SUPABASE_URL` pointing at the gateway and the run's anon / service-role keys. `LOVABLE_API_KEY` is unset, so transactional e-mails stay queued. |

Auth e-mails are not sent: the gateway appends one line per link to
`$E2E_RUN_DIR/mail.log` (`<time> <kind> <email> <link>`, kinds `invite`,
`recovery`, `signup-confirmation`, `generate_link:<type>`). Tests read the links
from there (`tests/support/mail.ts`). Links are single-use; a used link
redirects back to the app with `#error=access_denied&error_code=otp_expired`,
as Supabase Auth does. Tokens opened from an invitation or recovery link carry
the matching `amr` method, so `/auth/update-password` behaves as in production.

Start and stop the stack by hand to iterate on tests without rebuilding it:

```
bash e2e/stack/start.sh                  # prints URLs; idempotent (rebuilds a stack of the same name)
cd e2e && npx playwright test tests/trading.spec.ts --headed
bash e2e/stack/stop.sh
E2E_KEEP_STACK=1 npm run test:e2e        # or: leave the stack running after a full run
```

Parameters (environment variables of `start.sh`, `stop.sh` and `run.sh`):

| Variable | Default | |
| --- | --- | --- |
| `E2E_DB` | `vt_e2e` | database name (also names the run dir) |
| `E2E_PG_PORT` | `54340` | PostgreSQL |
| `E2E_GATEWAY_PORT` | `54341` | gateway ("Supabase URL") |
| `E2E_PGRST_PORT` | `54342` | PostgREST |
| `E2E_APP_PORT` | `8340` | the app |
| `E2E_RUN_DIR` | `/tmp/vt-e2e/<db>` | cluster, logs, `stack.env`, `mail.log`, pids |
| `PGBIN` | `/usr/lib/postgresql/16/bin` | PostgreSQL 16 binaries |
| `POSTGREST_BIN` | `e2e/.bin/postgrest`, else `postgrest` on `PATH`, else downloaded into `e2e/.bin/` | |

Two stacks can run side by side with different `E2E_DB` and ports. `start.sh`
refuses busy ports, fails fast on the first error (a failing migration is
named) and then prints the tail of every log and stops whatever it started.
`$E2E_RUN_DIR/stack.env` holds the URLs and keys of the running stack; the
Playwright helpers read it (`tests/support/stack.ts`).

Requirements: Node 22, PostgreSQL 16 server binaries (`apt-get install
postgresql-16`), the app's dependencies (`bun install`), `curl`, `xz`, and
`sudo` when not root (to copy the stub extensions into PostgreSQL's extension
directory, exactly like `npm run test:db`). As root, the cluster runs as the
`postgres` OS user.

## Seeded data

`stack/seed.sql` (sample data only, fictional names) creates the accounts below
(password `Preview123!`), two companies, five published brand units with ~40
days of trades produced by the matching engine, resting orders, submissions,
access requests and invitations, and checks the global money and unit
invariants of `supabase/tests/security.sh` at the end.

| Account | Role |
| --- | --- |
| `admin@preview.local` | platform admin |
| `reviewer@preview.local` | Shariah reviewer |
| `owner@preview.local` | owner of "شركة تجريبية أ" (Sample Company A) |
| `investor@preview.local`, `investor2@…`, `investor3@…` | activated, funded investors with units |
| `pending@preview.local` | signed up, not activated |
| `held@preview.local` | investor on a review hold |

Journeys never depend on each other or on their order: each creates what it
changes (users with unique e-mails, instruments with unique symbols) through
the same SQL functions the server uses (`post_cash_movement`, `issue_units`,
`match_order`, run as the service role; `tests/support/db.ts`), so a retry or a
second run against the same stack starts clean.

## The journeys (`e2e/tests/`)

The interface is Arabic (the default). Assertions use the app's own Arabic copy
(`src/lib/i18n/ar.ts`, via `tests/support/i18n.ts`), URLs, and the database.

| File | Journey |
| --- | --- |
| `investor-onboarding.spec.ts` | a visitor asks to invest on `/request-access`; the admin signs in and approves it on `/access-requests`; the invitation link from `mail.log` sets a password and signs the investor in; the investor is in the pending-activation queue of `/admin/investors`; the admin activates trading and records a deposit (confirm dialogs); the investor's banner goes from "not activated" to "no funds yet" to none, and the buying power shows the deposit. |
| `trading.spec.ts` | a funded, activated investor places a limit buy crossing a resting sell of the seeded `investor2`: fill toast, buying power / cash reduced by exactly qty × price, position on `/portfolio`; in the database one trade, equal and opposite `order_buy` / `order_sell` ledger legs, balances and positions; a limit price outside the ±20% band shows the Arabic refusal and cannot be sent; a resting order is cancelled from `/portfolio` (confirm dialog) and its reservation released. |
| `listing-lifecycle.spec.ts` | the company owner submits a brand unit on `/company/submit`; the Shariah reviewer approves it with a reason (halal ruling, visible on `/shariah/review`); the admin approves the listing with a reference price and a first allocation of units (which lists it: shown as published in the admin's publication control); a visitor finds it on `/market`, and `/market/<slug>` shows the reference-price label. |
| `password-recovery.spec.ts` | `/auth` → "forgot password" → link from `mail.log` → `/auth/update-password` → the new password signs in, the old one is refused, the used link shows the expired-link state. |
| `access-control.spec.ts` | a signed-in user without roles gets the access-denied state on `/admin/investors`; an anonymous visitor to `/portfolio` is sent to `/auth` and back after signing in. |

`tests/global-setup.ts` first visits every page the journeys use (anonymous and
signed in), so `vite dev`'s on-demand compilation happens before the timed tests.

## Artifacts

Everything lands in `e2e/artifacts/` (git-ignored): `test-results/` (for a
failed test: trace, screenshots of every open page, video, error context),
`html-report/` (`cd e2e && npx playwright show-report artifacts/html-report`),
`junit.xml`, and `stack-logs/` (PostgreSQL, PostgREST, gateway, vite, seed and
`mail.log` of the run). Open a trace with `npx playwright show-trace <trace.zip>`.

## CI

`.github/workflows/e2e.yml` runs on pull requests and pushes to `main`
(ubuntu-latest): `bun install --frozen-lockfile` for the app, `npm ci` in
`e2e/`, PostgreSQL 16 from apt when the image lacks it, the PostgREST
v12.2.3 static binary from its GitHub release (cached), `npx playwright install
--with-deps chromium`, then `npm run test:e2e`. On CI a failed test is retried
once. When anything fails, `e2e/artifacts/` is uploaded as the `e2e-artifacts`
workflow artifact.
