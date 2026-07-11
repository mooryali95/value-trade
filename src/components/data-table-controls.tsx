import type { ReactNode } from "react";

export type SortDir = "asc" | "desc";

export function SortHeader({
  active,
  dir,
  onClick,
  align,
  children,
}: {
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "start" | "end";
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 uppercase tracking-wider ${
        align === "end" ? "w-full justify-end" : ""
      } ${active ? "text-[var(--gold-deep)]" : ""}`}
    >
      {children}
      {active && <span>{dir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

export function Pager({
  page,
  pageCount,
  onPage,
  labels,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
  labels: { page: string; of: string; prev: string; next: string };
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-border/40 px-4 py-2 text-[11px] text-muted-foreground">
      <span>
        {labels.page} {page} {labels.of} {pageCount}
      </span>
      <div className="flex gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="rounded border border-border px-2 py-1 disabled:opacity-40"
        >
          {labels.prev}
        </button>
        <button
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          className="rounded border border-border px-2 py-1 disabled:opacity-40"
        >
          {labels.next}
        </button>
      </div>
    </div>
  );
}

export function comparator(dir: SortDir) {
  const s = dir === "asc" ? 1 : -1;
  return (a: number | string, b: number | string) => (a < b ? -1 : a > b ? 1 : 0) * s;
}

export function clampPage(p: number, count: number) {
  return Math.max(1, Math.min(p, Math.max(1, count)));
}