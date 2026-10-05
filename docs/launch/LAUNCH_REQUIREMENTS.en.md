# Value Unit: launch requirements

> The Arabic version, [LAUNCH_REQUIREMENTS.ar.md](./LAUNCH_REQUIREMENTS.ar.md),
> is the primary one. This English file mirrors it.

**For:** the platform owner and whoever operates Lovable Cloud for them.
**Purpose:** everything that must be set, run, checked and decided before
the first real investor is invited, in the order to do it.
**Technical detail:** [`supabase/ops/README.md`](../../supabase/ops/README.md)
and [`SECURITY.md`](../../SECURITY.md).

## The launch at a glance

| # | Step | Where | Who |
| --- | --- | --- | --- |
| 1 | Add the server secrets | Lovable: More > Cloud > Secrets | Owner |
| 2 | Confirm the authentication settings | Lovable Cloud, authentication settings | Owner |
| 3 | Fill in the operator details | `src/lib/config/site.ts` | Owner provides the facts, developer enters them |
| 4 | Done: Lovable applied all 32 migrations to the live database on 2026-10-01 (do not run the launch bundle) | Lovable migration tool | Done |
| 5 | Publish the app | Lovable: Publish > Publish changes | Owner |
| 6 | Post-deploy checks | `/admin/ops`, `/admin/health`, sign-in | Platform admin |
| 7 | Go-live reset | Lovable: More > Cloud > SQL editor | Owner |
| 8 | Activate the first investors, list the first brand | `/access-requests`, `/admin/investors`, `/admin/submissions`, `/shariah/review` | Platform admin, Shariah reviewer, company |

Terms used in this document:

- **Secret**: a private setting (a password or address) that the server reads.
  Users never see it.
- **Migration**: a script that changes the database structure or its rules.
- **Launch bundle**: one file that holds every migration from these phases, so
  they are applied in a single run.
- **Transaction**: all or nothing. If any part fails, the database is left
  exactly as it was.
- **Reference price**: the price an administrator sets for an instrument. It
  anchors the allowed daily price range (±20%) until trades set a price.
- **Issuance**: the platform admin creating units of an instrument and
  allocating them to a holder.

---

## 1. What changed in the three phases

**Phase 1: security and the trading engine**

- Users can no longer write balances, orders, positions or trades themselves.
  Every money movement goes through checked database functions and is
  recorded in the cash ledger and the audit log.
- The matching engine runs inside the database and enforces every market rule:
  price tick 0.01, whole units only, a ±20% daily band around the reference
  price, a maximum order value of 5,000,000, no self-trading, and no buying an
  instrument whose Shariah ruling does not allow it.
- Administrators activate investors, fund their accounts and issue units from
  the admin screens. Nobody can create money or units any other way.

**Phase 2: real data only**

- Every market page (the market, instrument pages, charts, the company page)
  reads real data from the database. The demo instruments (276 of them) were
  taken off the market.
- Accurate legal and Shariah pages (terms, privacy, cookies, risk, Shariah
  disclosures). Operator details are shown only once the owner confirms them.
- Arabic is the default language, rendered right to left from the first page
  load.

**Phase 3: interface, registration, exact money and the listing path**

- **Registration and onboarding:** investors can request access ("I want to
  invest"). When an administrator approves, the investor receives an
  invitation e-mail with a secure link to set a password, and then appears in
  the "Pending activation" queue. Company invitations have their own secure
  page. Company members join only by accepting an invitation.
- **Account status:** every signed-in user sees what is left to do:
  confirm the e-mail address, accept invitations, wait for activation or
  funding, or that the account is on hold.
- **Exact money:** cost, profit and loss are computed to the cent with the same
  arithmetic in the database and on screen. Holdings are valued at the last
  trade price, or the reference price, and never at the investor's own cost.
  Buying power (cash minus the amount reserved by open buy orders) is shown
  on the trade and portfolio pages.
- **Listing path:** submission, then Shariah review, then admin listing with a
  real reference price and an optional first allocation. The database enforces
  every step, and a Shariah ruling is never replaced without an explicit
  decision.
- **Monitoring:** `/admin/health` shows 11 data integrity checks (cash equals
  ledger, units equal their history, and so on).
- **Security:** browser security headers (HSTS, no framing of the site on the
  production domain, and others). Errors shown to users are clear messages,
  never internal technical text.
- **Interface:** rebuilt for phones (390 px) and desktops in Arabic and English,
  with clear numbers (fixed digit width, correct direction, "—" when no value
  exists).

---

## 2. Server secrets

**Where:** in the Lovable project, **More > Cloud > Secrets > Add secret**. Enter
the name exactly as written (capital letters and underscores), then the value.

| Name | Value | Required | Why |
| --- | --- | --- | --- |
| `APP_ORIGIN` | `https://hub.sunkvalue.com` (no trailing slash) | Yes | The official address used in every link sent by e-mail (invitations, password reset, alerts), robots.txt and the sitemap. Without it, links may point to a different address. |
| `CRON_ALERTS_SECRET` | A random value of at least 32 characters (generate it with a password manager; do not reuse another password) | Yes | Signs calls to the price-alert job and the post-deploy checks. |
| `APP_ALLOWED_ORIGINS` | Other exact addresses, comma separated, e.g. `https://www.sunkvalue.com` | Optional | Only if the app must also be reached, or linked, on another address. No wildcards. |
| `LOVABLE_API_KEY` | Created by Lovable for its e-mail feature | Confirm it is present | Invitation, acknowledgement, decision and alert e-mails. Without it, no e-mail is sent. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Provided by Lovable Cloud | Confirm they are present | Database connection. Never share the service-role key. |

Notes:

- This phase adds **no** new secret. The names above are every one the server
  reads.
- Do not add `PUBLIC_SITE_URL` or `PUBLIC_APP_ORIGIN`: they are old names. If
  either already exists, make it equal to `APP_ORIGIN` or delete it.
- **Change in this phase:** a signed call to the price-alert job now also sends
  the time of the call (`x-timestamp`), and a call older than 5 minutes is
  refused. The price-alert job scheduled inside the database is not affected.
  Only an **external** scheduler using the old signature must be updated (see
  [`docs/api-public.md`](../api-public.md)).

---

## 3. Authentication settings to confirm

**Where:** in Lovable Cloud, the user and authentication settings
(More > Cloud, then the Users / Auth settings section; labels can differ
slightly between Lovable versions).

| # | Setting | Recommended | Why |
| --- | --- | --- | --- |
| 1 | E-mail confirmation | **On** | Invitations can only be viewed and accepted from a confirmed address. With it off, anyone could claim an invitation sent to an address they do not own. |
| 2 | Allow new users to sign up | Owner decision (see the checklist) | **On** (current): anyone can create an empty account (no role, no data access). It appears in `/admin/investors` > Pending activation as "signed in without a role", and nothing happens until an admin acts. **Off**: invitation links still work, but Google sign-in can no longer create new accounts, so invitees must use the "Create my account" e-mail link on the invitation page. |
| 3 | Google provider | On, and tested on the production domain | Invitees can accept with Google. The app returns them to their invitation after sign-in. |
| 4 | Site URL | `https://hub.sunkvalue.com` | The default address for authentication e-mails. |
| 5 | Redirect URLs | `https://hub.sunkvalue.com/**` plus every address in `APP_ALLOWED_ORIGINS` followed by `/**` | Invitation and password reset links go to `/auth/update-password?flow=...&next=...` on this address. An address missing here breaks those links. |
| 6 | Leaked password protection | **On** | Refuses passwords known from public breaches. |
| 7 | Minimum password length | 8 | The app already requires 8 characters with at least one letter and one digit. |
| 8 | Secure password change | Recommended | The change-password page re-checks the current password anyway. |
| 9 | E-mail link lifetime and e-mail rate limit | Default lifetime is 1 hour; confirm it | Many approvals at once can hit the e-mail limit. Admin screens report the failure and offer "resend". |
| 10 | Branded authentication e-mails (auth e-mail hook) | Active | So Supabase invitation and recovery e-mails use the platform's bilingual templates. |

---

## 4. Database update: the launch bundle

> **Status (2026-10-05): done.** Lovable applied all 32 migrations to the live
> database file by file on 2026-10-01, and all of them are present in the
> migration history (`20260924100000` to `20260926101800`). **Do not run the
> bundle**; it refuses a second run anyway. This section remains as reference
> for a fresh environment only.

**The file:** `supabase/ops/launch_bundle.sql`. It contains 32 migrations, from
`20260924100000` to `20260926101800`, in order, inside **one transaction**.
**Discard any earlier bundle file you received before**: only the latest file
from the repository is valid. The file's header lists the first and the last
migration.

### Before running

1. **Take a backup**, or confirm that point-in-time recovery is on for the
   database.
2. **Confirm none of these migrations was applied already.** In the SQL
   editor, run:

   ```sql
   SELECT version FROM supabase_migrations.schema_migrations
    WHERE version >= '20260924' ORDER BY version;
   ```

   The result must be **empty**. If it lists any version, stop and ask the
   developer: in that case only the missing migrations are applied, not the
   bundle. (The bundle refuses to run anyway, with
   `LAUNCH_BUNDLE_ALREADY_APPLIED`, and changes nothing.)
3. **Make sure your own account has the platform admin role** (needed later
   for the checks and for `go_live_reset.sql`):

   ```sql
   SELECT u.email, r.role FROM public.user_roles r
     JOIN auth.users u ON u.id = r.user_id
    WHERE r.role IN ('platform_admin', 'shariah_board')
    ORDER BY r.role, u.email;
   ```

### Running it

1. Open **More > Cloud > SQL editor**.
2. Open `supabase/ops/launch_bundle.sql`, copy the **whole** file, paste it and
   run it **once**.
3. Expected result: the notice
   `LAUNCH_BUNDLE_DONE files=32 first=20260924100000 last=20260926101800`.
4. If an error appears, **nothing was changed** (one transaction). Send the
   error text to the developer, do not edit the file, and run it again once the
   cause is fixed.
   - `LAUNCH_BUNDLE_ALREADY_APPLIED`: some of these migrations are already
     recorded. Do not retry; ask the developer.
   - `LAUNCH_BUNDLE_WRONG_DATABASE`: this is not the Value Unit database.
5. Right after it succeeds: **Publish > Publish changes**, so the app and the
   database match. The new app version depends on the new database functions.

### What the bundle changes in existing data

- **Opening balances reconciled:** each existing cash balance gets an opening
  entry in the cash ledger, so every balance equals its ledger. No amount is
  changed.
- **Unexplained accounts put on hold:** a balance or holding that no history
  explains is recorded for review (`launch_review_holds`), and trading is
  turned off for that account until an admin reviews it. Nothing is deleted.
- **Legacy orders closed:** every order still open was accepted under the old
  rules (some were fractional, back-dated or far from the price), so each one
  is closed as cancelled, with an audit record of its previous state. No cash
  or units move.
- **Demo instruments unpublished:** every instrument without an admin-set
  reference price and a Shariah ruling leaves the market, including the 276
  demo instruments. No Shariah ruling is invented for any instrument.
- **New precise columns filled once:** each holding's cost basis and each
  order's filled amount are computed from the history of issuances and trades.
- Users, companies, members, invitations, access requests, submissions,
  rulings, trades and alerts are all kept.

The bundle is tested against a copy that resembles production (see section 5,
last row).

---

## 5. Post-deploy checks

Sign in as a platform admin on `https://hub.sunkvalue.com`:

| # | Check | Expected |
| --- | --- | --- |
| 1 | Open `/` and `/market` in Arabic and English | Arabic right to left; the market shows the "no listings" state (no instrument is listed yet). |
| 2 | `/admin/ops` > run the quick checks (smoke suite) | Every check passes: session, roles, database write, ledger guard, Shariah buy block, a real e-mail to your own inbox (option on by default), and the price-alert endpoint. |
| 3 | `/admin/health` | The tables and integrity checks are shown. **Before** the go-live reset, `units_match_history` and `units_conserved_per_symbol` can be red because of legacy units with no issuance behind them. This is expected and is cleared by step 7. Every other check must pass. |
| 4 | Sign in with e-mail and password, sign out, "Forgot password" | The reset e-mail arrives and its link opens `/auth/update-password` on the official address. |
| 5 | Sign in with Google | Returns to the platform signed in. |
| 6 | `/request-access` > "I want to invest" with a test address you own | An acknowledgement e-mail, and the request appears on `/access-requests`. |
| 7 | Price-alert schedule | `/admin/ops` shows a recent run of the price-alert job. It is the database job `scan-price-alerts` (every minute). To check it in the SQL editor: `SELECT jobname, schedule FROM cron.job;` |
| 8 | Security headers (optional) | Browser developer tools > Network > the page's response: `strict-transport-security`, `x-content-type-options: nosniff`, `referrer-policy`, `x-frame-options: DENY`. |

The developer has already run these automated tests on this version:
`npm run test:db` (database security suite), `npx vitest run`, the build, and
`bash supabase/ops/test_launch_bundle.sh` (27 of 27 checks pass on a
production-like copy: identical schema, data kept, cash equals ledger, nothing
listed without a price and a ruling, a second run refused, and the go-live
reset passing).

---

## 6. Go-live

### 6.1 The go-live reset (`supabase/ops/go_live_reset.sql`)

**When:** once, after the checks in section 5 pass, and **before** inviting the
first real investor. It is not a routine script.

**What it does:**

- Archives, then deletes, the trading state from the test period: orders,
  trades, holdings, the cash ledger and unit issuances. Every cash balance
  becomes 0.
- Deletes the demo instruments of the early builds (unlisted, with no company
  and no submission), with the price alerts and watch-list rows on them.
  Their Shariah rulings stay on record.
- **Keeps** users, roles, companies, members, invitations, access requests,
  submissions, Shariah rulings, the audit log, the accounts on hold, and every
  listed instrument or instrument that belongs to a company or a submission
  (with its reference price).
- Keeps the archive in the private schema `go_live_archive` (the file header
  explains how to restore).
- Refuses to finish, changing nothing, if an integrity check still fails
  afterwards (`GO_LIVE_RESET_INTEGRITY`).

**How:**

1. Confirm your account has the platform admin role (query in section 4).
2. More > Cloud > SQL editor: paste the **whole** file and run it once.
3. Expected: the notice `GO_LIVE_RESET_DONE` with the archived row counts.
   - `GO_LIVE_RESET_ALREADY_RUN`: it already ran; nothing changed.
   - `GO_LIVE_RESET_NO_ADMIN`: no account has the platform admin role yet.
4. Open `/admin/health`: **every** integrity check must now pass.
5. Review the accounts on hold (`launch_review_holds`). The reset zeroes the
   balances they describe, so decide what to do with each before activating
   it again.

### 6.2 Granting staff roles

There is no screen for granting the platform admin and Shariah reviewer roles.
They are granted in the SQL editor, for an account that already exists and has
confirmed its e-mail address:

```sql
-- Shariah reviewer: replace the e-mail address
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'shariah_board' FROM auth.users WHERE lower(email) = lower('reviewer@example.com')
ON CONFLICT (user_id, role) DO NOTHING;
```

For a platform admin, replace `'shariah_board'` with `'platform_admin'`. Grant
these roles only to people the owner has named.

### 6.3 Activating the first investors

1. The investor submits `/request-access` and chooses "I want to invest".
2. A platform admin opens `/access-requests` and approves (or rejects with a
   reason). Approval sends an invitation e-mail with a link to set a password
   (valid once, for the link lifetime set in Auth).
3. The investor sets a password, signs in, and appears in `/admin/investors`
   under **Pending activation**.
4. The admin reviews the account and activates it (this grants trading). An
   account marked **on hold** is not activated with one click: review it in the
   investor panel first, because activation resolves its hold.
5. The admin records the deposit received outside the platform (a cash
   movement). It is recorded in the cash ledger and the audit log, and becomes
   the investor's buying power.

### 6.4 Listing the first brand

1. **The company:** the invited company owner accepts the invitation, then
   submits the brand from `/company/submit` (status: awaiting Shariah review).
2. **Shariah review:** a reviewer opens `/shariah/review` and approves (this
   records the ruling and creates the instrument, still unlisted and with no
   price) or rejects with a reason.
3. **Admin listing:** a platform admin opens `/admin/submissions` and approves
   the listing:
   - sets a **real reference price** (on the 0.01 tick, between 0.05 and
     1,000,000,000). It anchors the first day's ±20% range;
   - optionally allocates the first units to an owner or finance member of the
     company (an issuance);
   - the instrument is then listed. Or the admin declines the listing with a
     reason.
4. Further units are issued from `/admin/investors` when needed.
5. Check: the instrument appears on `/market`, its page shows the price and
   the Shariah ruling, and an activated, funded investor can place a buy order.

---

## 7. Owner inputs checklist

Only the owner can provide these facts. **The operator details and licensing
blocks stay hidden on the site until they are filled in.** Nothing is shown in
their place, not even a placeholder. Fields in `src/lib/config/site.ts` are
entered by the developer once the owner confirms them.

### 7.1 Operator identity and contact

| # | Input | Where it goes |
| --- | --- | --- |
| 1 | Legal entity name, Arabic and English | `site.ts`: `legalEntityNameAr`, `legalEntityNameEn` |
| 2 | Commercial registration number | `site.ts`: `commercialRegistration` |
| 3 | Registered address, Arabic and English | `site.ts`: `addressAr`, `addressEn` |
| 4 | Licensing or regulatory status (e.g. the CMA status or a sandbox permit), Arabic and English | `site.ts`: `licensingStatusAr`, `licensingStatusEn`. Until then the pages say nothing about licensing. |
| 5 | General contact address (monitored). Several messages tell users to contact the platform administrator. | `site.ts`: `contactEmail` |
| 6 | Privacy address (for personal data requests under the PDPL) | `site.ts`: `privacyEmail` |
| 7 | Security address (vulnerability reports) | `site.ts`: `securityEmail`, and `SECURITY.md` (it still says "owner input pending") |
| 8 | Complaints address | `site.ts`: `complaintsEmail` |
| 9 | Mail domain: the repository used to mention `privacy@valueunit.app` and `security@valueunit.app`, while the site and outgoing mail use `hub.sunkvalue.com`. Confirm the real addresses. | Same fields |
| 10 | Official domain (currently `https://hub.sunkvalue.com`) | `site.ts`: `canonicalOrigin`, plus the `APP_ORIGIN` secret and the Site URL in Auth. All three must match. |

### 7.2 Shariah

| # | Input | Where it goes |
| --- | --- | --- |
| 11 | Shariah board: each member's name and role, Arabic and English (if a board exists) | `site.ts`: `shariahBoard`. Until then the pages say only that users with the platform's Shariah reviewer role do the review. |
| 12 | Do reviewers refer to the AAOIFI Shariah standards? | If yes, a sentence is added to the Shariah page and the disclosures (developer). |
| 13 | Who receives the Shariah reviewer role | SQL in section 6.2 |
| 14 | Must listing from the admin listing screen require a "Shariah compliant" (halal) ruling (as the submission path already does), or is any ruling in force enough (current behaviour)? | Decision for the developer |

### 7.3 Money and market

| # | Input | Where it goes |
| --- | --- | --- |
| 15 | How investor money is held, transferred and returned outside the app: bank, account holder, timelines | Terms and Risk pages (`src/routes/legal.terms.tsx`, `legal.risk.tsx`). They currently say only that these arrangements are agreed with the operator outside the platform, and that no segregated or custodial account is implied. |
| 16 | Trading currency. Prices and the 5,000,000 maximum order value carry no currency today. | Legal pages and the interface (developer) |
| 17 | None of the 276 demo instruments comes back at launch (confirm). Republishing one needs a real reference price. | Confirmation only |
| 18 | Investors holding units of an unlisted demo instrument (if any) | Decision. Find them in the SQL editor: `SELECT p.* FROM positions p JOIN brands b ON b.symbol = p.symbol WHERE NOT b.published;` |
| 19 | What happens to the accounts on hold after the go-live reset | Decision before activating them again (section 6.1) |

### 7.4 Company plans and interface

| # | Input | Where it goes |
| --- | --- | --- |
| 20 | Company plans (Founding, Growth, Enterprise) and their prices: are they real offers? The texts now say what the platform does: all three plans include the same platform features (up to 30 brands per company, the only limit the database enforces; all company roles and the audit log; Shariah review of every listing submission) and differ only in price and contract terms. Confirm the tiers and prices, or keep a single "custom terms" card. | Landing page texts (`src/lib/i18n`) |
| 21 | Should brands a company has listed appear on its workspace brand roster automatically? The roster is currently maintained separately. | Decision for the developer |
| 22 | Keep the "Trade" link out of the main menu (trading starts from each instrument page)? | Confirmation |
| 23 | Approve the social preview image `public/og-image.png` (brand name and tagline, no numbers) | Confirmation, or a replacement image |

### 7.5 Legal and privacy

| # | Input | Where it goes |
| --- | --- | --- |
| 24 | Governing law and courts (the Terms state Saudi law and the competent courts of the Kingdom) | `src/routes/legal.terms.tsx` |
| 25 | Hosting regions of the database, the hosting and the e-mail providers (for the cross-border transfer notice), and whether the hosting or CDN sets bot-protection cookies | Privacy and cookie policies |
| 26 | Retention period for access requests and profiles | Privacy policy and the retention table in `SECURITY.md` |
| 27 | HSTS policy: two years, including subdomains, no preload. Acceptable for `hub.sunkvalue.com` and **all its subdomains**? | Confirmation (`src/lib/ops/security-headers.ts`, `public/_headers`) |

### 7.6 Lovable and operations settings

| # | Input | Where it goes |
| --- | --- | --- |
| 28 | The secrets in section 2 | More > Cloud > Secrets |
| 29 | Authentication settings 1 to 10 in section 3, in particular the sign-up decision | Lovable Cloud authentication settings |
| 30 | E-mail link lifetime and e-mail rate limit | Lovable Cloud authentication settings |
| 31 | Backup, or point-in-time recovery, before the bundle | Lovable Cloud / database |
| 32 | Done: the 32 migrations are applied to production through Lovable (verified 2026-10-05) | Nothing |
| 33 | The platform admin accounts (at least one before the go-live reset) | SQL in section 6.2 |
| 34 | An external scheduler for price alerts, if one is used, must switch to the new signature with `x-timestamp` | [`docs/api-public.md`](../api-public.md) |

---

## 8. Known limitations and recommended next steps

### 8.1 Regulatory and operational (outside the software)

1. **Licensing:** the platform does not claim any licence. Before offering
   the service to the public or widening it, obtain the Capital Market
   Authority's view on the nature of the activity (or a FinTech sandbox
   permit), then fill in the licensing status (checklist item 4).
2. **Know your customer and anti-money laundering (KYC/AML):** activation is a
   manual administrator review. There is no identity verification, sanctions
   screening or suspicious-transaction reporting. A documented procedure is
   needed, then integration with a verification provider.
3. **Payments and banking:** deposits and withdrawals happen outside the
   platform and are recorded manually by an administrator. Next steps: a
   client money account at a bank, daily reconciliation against the cash
   ledger, then bank integration.
4. **External audit and penetration test:** the code has internal automated
   tests (the database security suite, application tests, and the bundle test
   on a production-like copy). An independent penetration test and a review of
   the matching engine and ledger by a specialist firm are recommended before
   real money is taken.
5. **Monitoring and alerting:** the platform e-mails its administrators when
   the quick checks fail repeatedly or the price-alert job is slow. There is no
   external monitoring (uptime, error rate, database load) and no on-call
   rota. Recommended: an external uptime monitor on `/` and `/market`, a
   centralised error log, and a weekly review of `/admin/health`.

### 8.2 Known product limitations

1. No open known limitations. The script content security policy (CSP) item
   was closed on 2026-10-05: every page on the production hosts carries its
   own random nonce, so inline script without it and scripts from other
   origins do not run. A third-party service added later (analytics, chat,
   payments) needs its origin added to the policy (see `SECURITY.md`).

### 8.3 Recommended next steps (in order)

1. Complete sections 2 to 6 and the checklist in section 7.
2. Engage a law firm for the licensing question and the legal page texts.
3. Put a written KYC/AML procedure and a funds-handling procedure in place.
4. Commission an independent penetration test.
5. Set up external monitoring and a weekly operations review.
