# Accessibility Patterns — Value Unit

These are the required patterns for every new feature. If a new component does
not match one of these, extend this document in the same PR.

## Global rules

- Colour comes only from semantic tokens in `src/styles.css`
  (`text-ink`, `text-ink-soft`, `text-state-*`). Never `text-gray-*` / hex.
- Interactive targets: `min-h-11` (44px) for primary controls on mobile.
- Every icon-only control needs `aria-label`.
- Full-height layouts use `dvh`, never `h-screen`.
- Motion respects `prefers-reduced-motion` (already handled globally in
  `src/styles.css`); do not add un-tokenised transition durations.
- One `<main>` per page (rendered by `AppShell`), one `<h1>` via `PageHeader`.

## Dialog (`@/components/ui/dialog`, `alert-dialog`)

Radix handles focus trap, `Escape`, and restore-focus. Never hand-roll a modal.

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{t("editOrder")}</DialogTitle>
      <DialogDescription>{t("editOrderDesc")}</DialogDescription>
    </DialogHeader>
    {/* first focusable element = first input */}
  </DialogContent>
</Dialog>
```

Requirements: always a `DialogTitle`; a `DialogDescription` whenever the dialog
asks for a decision; destructive confirmations go through `useConfirm()`
(`src/components/confirm-dialog.tsx`) with `tone: "danger"`.

## Dropdown (`@/components/ui/dropdown-menu`)

Use Radix `DropdownMenu` for account/actions menus — it provides roving
tabindex, arrow-key navigation and `aria-expanded`. The trigger must be a
`<button>` with a text or `aria-label` name. Never build a menu from
`div + onClick`.

## EmptyState (`@/components/empty-state`)

```tsx
<EmptyState
  title={t("emptyPositions")}
  description={t("emptyPositionsDesc")}
  action={<Link to="/market" className="…">{t("nav_market")}</Link>}
/>
```

Rules: always give a next action (CTA) — a filtered empty result must offer
"clear filters"; decorative icon is `aria-hidden`; the wrapper is announced
politely, so text must explain the *cause* and the *fix*.

## ErrorState (`@/components/error-state`)

Used for route `errorComponent`. It is announced assertively, keeps a
"try again" control that calls `router.invalidate()`, and offers an escape
route home. Never render a raw error string as the only content.

## DataTable (`@/components/data-table-controls` + `@/components/live-region`)

- Sortable headers are real `<button>`s (`SortHeader`); the active column shows
  direction textually, not by colour alone.
- Every filter `input`/`select` has `aria-label` (labels are usually visual-less).
- Pagination (`Pager`) uses buttons with `disabled`, not links.
- Result count and active sort are announced with `<TableStatus …/>`.
- Mobile: render a card list instead of a horizontally scrolling grid.

## Live regions (`@/components/live-region`)

| Update | Region | Component |
| --- | --- | --- |
| table results / sort / filter | polite | `<TableStatus/>` |
| order summary recalculation | polite | `role="status"` on the `<dl>` |
| submit success / failure | assertive | `<LiveRegion assertive/>` |

Never place focusable elements inside a live region, and never mount a live
region conditionally — keep it mounted and change its text.

## Verification

- `python3 tests/a11y/axe_check.py` — axe-core on every public route (CI gate).
- `python3 tests/a11y/keyboard_nav.py` — keyboard-only focus management.
- `python3 tests/a11y/visual_report.py` — desktop/tablet/mobile screenshots.