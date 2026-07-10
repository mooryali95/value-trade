# Phase 6 — Invitations, Portfolio UX, Cross-Tenant Tests

Four independent workstreams. Each ships behind existing auth/RLS; no schema-breaking migrations.

## 1) Company invitation flow (owner → member → verify access)

**DB migration** (`company_invitations`):
- Columns: `id`, `company_id`, `email` (lower, unique per pending), `role` (`finance|shariah|trader|viewer`), `token` (uuid, indexed), `invited_by`, `status` (`pending|accepted|revoked|expired`), `expires_at` (default now()+7d), `created_at`, `accepted_at`, `accepted_by`.
- GRANTs to `authenticated` and `service_role`. RLS:
  - `SELECT/INSERT/DELETE` for `owner` of `company_id` (via `has_company_role`).
  - `SELECT` for the invitee when `status='pending'` and `auth.jwt() ->> 'email' = email`.
  - `UPDATE` only through a `security definer` RPC `accept_company_invitation(_token uuid)` that inserts into `company_members`, marks invite `accepted`, and returns the company row. Enforces expiry and email match.

**Server fns** (`src/lib/tenants/invitations.functions.ts`, all `requireSupabaseAuth`):
- `createInvitation({ companyId, email, role })` — owner only.
- `listCompanyInvitations({ companyId })` — owner only.
- `revokeInvitation({ invitationId })` — owner only.
- `listMyInvitations()` — invitations for the caller's email.
- `acceptInvitation({ token })` — calls the RPC, returns `{ companyId }`.

**UI**:
- `/company/settings` — new "Invitations" panel: email + role form, table of pending invites with copy-link and revoke.
- New route `/invitations` (authenticated) — lists incoming invitations with Accept button; after accept, invalidates `my-companies` and routes to `/company/settings`.
- Owner list still shows current members (unchanged). Header nav badge count of pending invites (optional, minimal).

## 2) Portfolio Orders & Positions — pagination, sorting, persisted filters

Purely client work in `src/routes/_authenticated/portfolio.tsx`:
- Move filter/sort/page state into TanStack Router search params via `validateSearch` + `fallback()` so refresh / share URL keeps state. Fields: `tab`, `search`, `status`, `side`, `sortBy`, `sortDir`, `page`, `pageSize`.
- Sortable column headers (click to cycle asc/desc) for Positions (symbol/qty/avg/last/pnl/weight) and Orders (symbol/side/qty/price/status/time).
- Pagination footer (Prev / page x / y / Next, page size 10/25/50).
- Preserve filters while typing via `useNavigate({ search: (prev) => ({...prev, ...}) })`.

## 3) Cron price-alerts integration test (order → cron → alert fires)

New Vitest `src/lib/trading/cron-alerts.integration.test.ts`:
- Mocks `@/lib/mock-data` `BRANDS` and `@/integrations/supabase/client.server` with an in-memory table (`orders`, `price_alerts`).
- Places two orders through a small helper that mirrors `place-order.functions` semantics (or imports the pure calc), then seeds a matching `price_alert` for one symbol above and one below.
- Invokes the `POST` handler from `src/routes/api/public/cron-alerts.ts` with a valid HMAC signature.
- Asserts: response 200, `triggered` count matches expected, in-memory `price_alerts` rows for firing alerts are updated with `active=false` and `triggered_at` within a small `Date.now()` window; non-firing alerts untouched.

## 4) Cross-tenant RLS test suite

New Vitest `src/lib/security/rls-cross-tenant.test.ts` (skipped unless env vars present):
- Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_PUBLISHABLE_KEY`. If missing → `describe.skip` with a warning (keeps CI green locally, opt-in in staging).
- Uses `supabase-js` admin to create two ephemeral users (A in Company A, B in Company B) via `auth.admin.createUser`, then signs each in via `signInWithPassword` to get JWTs.
- Seeds one row per user per table: `orders`, `positions`, `product_submissions`, `shariah_decisions`.
- With user B's JWT, asserts:
  - `SELECT` on other user's rows returns 0 rows (RLS filters, not error).
  - `UPDATE` on other user's row returns 0 rows affected.
  - `DELETE` on other user's row returns 0 rows affected.
- Cleanup via service role in `afterAll`.
- Runs with `bunx vitest run src/lib/security`.

## Technical notes

- `validateSearch` uses `@tanstack/zod-adapter` with `fallback()` per project rules — no `.catch()`, no `.min`/`.max` bounds; clamp `page`/`pageSize` in the component.
- Invitation acceptance RPC lives in the migration (security definer, `set search_path = public`). No client can UPDATE the row directly.
- All new tables include GRANTs before RLS as required.
- i18n keys added for invitation flow (both `ar` / `en`).

## Files touched

**Add**: migration `20260710_*_invitations.sql`, `src/lib/tenants/invitations.functions.ts`, `src/routes/_authenticated/invitations.tsx`, `src/lib/trading/cron-alerts.integration.test.ts`, `src/lib/security/rls-cross-tenant.test.ts`.
**Edit**: `src/routes/_authenticated/portfolio.tsx` (search params, sort, pagination), `src/routes/_authenticated/company.settings.tsx` (invitations panel), `src/components/app-shell.tsx` (Invitations nav), `src/lib/i18n.tsx` (keys), `src/integrations/supabase/types.ts` (regenerated after migration).
