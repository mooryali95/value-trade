# Public API — `/api/public/*`

Endpoints under this prefix bypass site auth on the published app, so every
handler authenticates its own caller. Base URLs (immutable, rename-safe):

- Production: `https://project--25e304b6-2628-4d2b-8228-c4b3a042ef30.lovable.app`
- Preview: `https://project--25e304b6-2628-4d2b-8228-c4b3a042ef30-dev.lovable.app`

---

## `POST /api/public/cron-alerts`

Scans active `price_alerts` against the latest quote, deactivates the ones that
fired, and enqueues a `price-alert` email to each alert owner (subject to
`notification_preferences.price_alerts_email` and the suppression list).

**Auth** — HMAC-SHA256 over the raw request body using `CRON_ALERTS_SECRET`,
hex-encoded, in the `x-signature` header. Compared in constant time.

**Rate limit** — 30 requests / 60 s per source IP (`public.check_rate_limit`).

**Request**

```
POST /api/public/cron-alerts
x-signature: <hex hmac of body>
content-type: application/json

{}
```

**Responses**

| Status | Meaning |
| --- | --- |
| `200` | `{ "scanned": number, "triggered": number, "emailed": number }` |
| `401` | Missing/invalid signature |
| `429` | Rate limit exceeded |
| `503` | `CRON_ALERTS_SECRET` not configured |

**Idempotency** — email sends are keyed on `price-alert:<alertId>`, and alerts
are set `active = false` when fired, so a replayed call is a no-op.

**Scheduling example (pg_cron)**

```sql
select cron.schedule('scan-price-alerts', '* * * * *', $$
  select net.http_post(
    url := 'https://project--25e304b6-2628-4d2b-8228-c4b3a042ef30.lovable.app/api/public/cron-alerts',
    headers := jsonb_build_object('content-type','application/json','x-signature', <hmac>),
    body := '{}'::jsonb
  );
$$);
```

---

## `GET /email/unsubscribe?token=<uuid>`

One-click unsubscribe target embedded in transactional emails. The opaque token
is the credential; no session required. Email addresses are redacted in all
responses and logs.

| Status | Meaning |
| --- | --- |
| `200` | Preference updated |
| `400` | Missing token |
| `404` | Invalid or expired token |
| `500` | Server misconfiguration |

---

## Rules for new public endpoints

1. Verify the caller first — HMAC signature, opaque token, or shared secret.
2. Validate every input with Zod; bound array and string sizes.
3. Never return PII; redact emails in responses and logs.
4. Apply `checkRateLimit` before doing any work.
5. Load `supabaseAdmin` inside the handler, after the caller is verified.
6. Document the endpoint here in the same change.
