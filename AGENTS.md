<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Database migrations
- A file in `supabase/migrations/` only takes effect once applied to the live database through Lovable's migration tool, byte-for-byte and in filename order — why: Git-pushed migrations are not auto-applied, and code calling unapplied functions breaks (see docs/database-migrations.md).
- Asset classes come only from `src/lib/market/asset-classes.ts`, mirrored by DB CHECK constraints on `brands`/`product_submissions` — why: UI, filters and the database must agree on one approved list.
- The investor assistant (`/api/instrument-assistant`) answers only from platform data built server-side in `src/lib/assistant/*.server.ts`, signed-in users, per-user daily rate limit — why: grounded answers, controlled cost.
