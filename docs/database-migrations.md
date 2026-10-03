# Database migrations — team workflow

## Incident 2026-10-01: "Market data temporarily unavailable" (بيانات السوق غير متاحة مؤقتًا)

**Symptom.** `/` and `/market` showed the market error card. Server log:
`[public-market] overview failed PGRST202` (PostgREST: function not found).

**Root cause.** 32 migration files (`20260924100000_*` … `20260926101800_*`)
were committed to `supabase/migrations/` through Git, but **committing a SQL
file does not run it**. The live database stopped at `20260820131622`, so the
code called `public_market_overview` / `public_market_summary` which did not
exist yet.

**Fix.** Every pending file was applied to the database, in filename order,
byte-for-byte, through Lovable's migration tool (each one in its own
transaction), then the page was re-checked.

## Rules for everyone working on this repo

1. A new file in `supabase/migrations/` is **not** live until it is applied.
   After pushing one from Git, ask Lovable in chat: *"apply pending migration
   `<file name>`"*. Lovable must submit the file contents unchanged.
2. Never edit a migration that was already applied; add a new one instead.
3. Do not merge code that calls a new database function/table before its
   migration is applied — the app will break exactly like the incident above.
4. Check drift at any time:
   ```sql
   select version from supabase_migrations.schema_migrations order by version desc limit 5;
   ```
   and compare with `ls supabase/migrations | tail -5`. They must match.
5. Run `bash supabase/tests/run.sh` (needs PostgreSQL 16) before pushing
   migrations: it applies all files on a throwaway database and runs the
   security checks.
6. A `PGRST202` / "function not found" or "relation does not exist" error in
   the server log almost always means an unapplied migration — check rule 4
   first.
