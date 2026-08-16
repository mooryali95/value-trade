# Security Policy — Value Unit

## Reporting a Vulnerability

Please email **security@valueunit.app** with a description, reproduction steps,
and impact assessment. We aim to acknowledge within 48 hours and remediate
critical issues within 7 days.

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

- **Row-Level Security** on every user-facing table; cross-tenant access tests in `src/lib/security/rls-cross-tenant.test.ts`.
- **RBAC** per company role (owner / finance / shariah / trader / viewer) enforced in both UI (`AccessDenied` guards) and server functions (`requireSupabaseAuth` + role checks).
- **Audit log** (`public.audit_log`) recording sensitive actions with owner-only read access.
- **HMAC-signed** public webhooks/cron (`/api/public/cron-alerts`, others).
- **Rate limiting** on public routes via `public.check_rate_limit`.
- **HIBP** leaked-password protection enabled on auth.
- **HTTPS** enforced by hosting; strict cookies for the Supabase session.

## Data Retention & Backups

| Data | Retention | Notes |
| --- | --- | --- |
| `audit_log` | 24 months | Append-only (no UPDATE/DELETE policies); owner-only read; CSV export from `/company/audit`. |
| `shariah_decision_audit` | Indefinite | Regulatory trail for Shariah rulings; append-only via trigger. |
| `cash_ledger`, `orders`, `positions` | Indefinite | Financial records; ledger is the single source of truth for balances. |
| `email_send_log` | 90 days | Operational only; older rows may be pruned. |
| `rate_limits` | 1 hour | Auto-pruned by `public.check_rate_limit`. |
| `email_unsubscribe_tokens` | 12 months | Single-use tokens, marked `used_at`. |
| Storage `submission-docs` | Lifetime of the submission + 24 months | Private bucket; access via short-lived signed URLs (120 s). |

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
| Price alert scan | `POST /api/public/cron-alerts` | every minute | HMAC-SHA256 (`CRON_ALERTS_SECRET`) over the raw body in `x-signature` |
| Email queue drain | `POST /lovable/email/queue/process` | every 5 s while queued | service-role bearer, self-disarming |

The price-alert scan is scheduled in production as `pg_cron` job
`scan-price-alerts` (`* * * * *`). It authenticates with a service-role bearer
read from the vault; external callers must instead sign the raw body with
`CRON_ALERTS_SECRET`. Every run appends a row to `public.ops_run_log`
(platform-admin read only), surfaced at `/admin/ops` with the last run time,
result and metrics.

## Post-deploy smoke suite

`/admin/ops` runs a platform-admin-only smoke suite (`runSmokeSuite`) that
covers: session + profile resolution, RBAC via `has_role`, a database
write/delete round-trip, the `post_cash_movement` ledger guard rejecting an
invalid movement, the Shariah buy-block (`non_halal` blocks buy, sell stays
allowed), a real branded email send to the operator's own inbox, and the
authenticated cron endpoint. The report is written to `ops_run_log` under job
`smoke`. The target origin is validated against an allow-list
(`*.lovable.app`, `*.sunkvalue.com`, localhost) to prevent SSRF.

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

- Security Lead: security@valueunit.app
- On-call: see internal runbook.