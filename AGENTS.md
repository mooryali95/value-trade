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

## Interface motion
- Use the opt-in `MotionReveal` presentation wrapper for one-time viewport entrances and scoped institutional CSS for interactions; honor reduced motion and never animate live financial figures — why: accessible motion must not disrupt data inspection or colleagues' application logic.

## Database migrations
- A file in `supabase/migrations/` only takes effect once applied to the live database through Lovable's migration tool, byte-for-byte and in filename order — why: Git-pushed migrations are not auto-applied, and code calling unapplied functions breaks (see docs/database-migrations.md).
- Asset classes come only from `src/lib/market/asset-classes.ts`, mirrored by DB CHECK constraints on `brands`/`product_submissions` — why: UI, filters and the database must agree on one approved list.
- The investor assistant (`/api/instrument-assistant`) answers only from platform data built server-side in `src/lib/assistant/*.server.ts`, signed-in users, per-user daily rate limit — why: grounded answers, controlled cost.
- Class-specific prospectus fields live in `src/lib/submissions/offering-schema.ts` and are stored in `product_submissions.offering_details` — why: one definition drives the form, server validation and review.
- The investor assistant attaches up to 3 offering PDFs (≤8 MB each) as `input_file` to the model — why: real document summaries without a separate parsing service.
