# Public API — `/api/public/*`

Endpoints under this prefix bypass site auth on the published app, so every
handler authenticates its own caller. Base URLs (immutable, rename-safe):

- Production: `https://project--25e304b6-2628-4d2b-8228-c4b3a042ef30.lovable.app`
- Preview: `https://project--25e304b6-2628-4d2b-8228-c4b3a042ef30-dev.lovable.app`

---

## `POST /api/public/cron-alerts`

Scans active `price_alerts` against the current market price, deactivates the
ones that fired, and enqueues a `price-alert` email to each alert owner
(subject to `notification_preferences.price_alerts_email` and the suppression
list).

**Price source** — for each symbol with an active alert: the latest trade price
in `public.trades` (by `created_at`), for instruments listed on the market
(`brands.published`) only. A reference price is not a traded price and never
fires an alert; symbols without a trade, or not listed, are skipped for that
run (their alerts stay active). Active alerts are read page by page, so no
API row limit truncates the scan.

**Auth** — either:

- `x-timestamp: <Unix time in seconds>` and `x-signature: <hex
  HMAC-SHA256 of "<x-timestamp>.<raw body>" with CRON_ALERTS_SECRET>`. The
  request is refused more than 300 s before or after its timestamp, so a
  captured request cannot be replayed later (external schedulers and the
  admin smoke suite), or
- `Authorization: Bearer <service-role key>` (the in-database pg_cron job,
  which reads the key from Vault).

Both are compared in constant time (SHA-256 digests + `timingSafeEqual`).

**Rate limit** — 30 requests / 60 s per source IP (`public.check_rate_limit`,
client IP from `cf-connecting-ip`). The limiter fails closed: if the check
itself errors, the request gets `429`.

**Request**

```
POST /api/public/cron-alerts
x-timestamp: <unix seconds>
x-signature: <hex hmac of "<x-timestamp>.<body>">
content-type: application/json

{}
```

**Responses**

| Status | Meaning |
| --- | --- |
| `200` | `{ "scanned": number, "triggered": number, "emailed": number }` |
| `401` | Missing/invalid signature or bearer |
| `429` | Rate limit exceeded (or the rate-limit check failed) |
| `500` | `{ "error": "INTERNAL_ERROR" }` — alert scan failed |
| `503` | Neither `CRON_ALERTS_SECRET` nor the service-role key is configured |

**Idempotency** — email sends are keyed on `price-alert:<alertId>`, and an
alert is only notified by the run that flips it from `active = true` to
`false`, so a replayed or overlapping call is a no-op.

**Scheduling example (pg_cron)**

```sql
select cron.schedule('scan-price-alerts', '* * * * *', $$
  select net.http_post(
    url := 'https://project--25e304b6-2628-4d2b-8228-c4b3a042ef30.lovable.app/api/public/cron-alerts',
    -- The service-role key read from Vault (an HMAC signature would have to
    -- be computed per call, with the current x-timestamp).
    headers := jsonb_build_object('content-type','application/json',
                                  'authorization', 'Bearer ' || <service-role key from vault>),
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
