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

See `docs/api-public.md` for the exact scheduling SQL and response contracts.

## Incident Response

1. Triage severity (Critical / High / Medium / Low).
2. Contain: rotate affected secrets (`supabase--rotate_api_keys`), disable compromised accounts.
3. Eradicate & recover: deploy fix, verify with `security--run_security_scan`.
4. Post-mortem within 5 business days; update this file and `.lovable/plan.md` with lessons learned.

## Contacts

- Security Lead: security@valueunit.app
- On-call: see internal runbook.