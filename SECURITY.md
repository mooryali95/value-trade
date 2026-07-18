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

## Incident Response

1. Triage severity (Critical / High / Medium / Low).
2. Contain: rotate affected secrets (`supabase--rotate_api_keys`), disable compromised accounts.
3. Eradicate & recover: deploy fix, verify with `security--run_security_scan`.
4. Post-mortem within 5 business days; update this file and `.lovable/plan.md` with lessons learned.

## Contacts

- Security Lead: security@valueunit.app
- On-call: see internal runbook.