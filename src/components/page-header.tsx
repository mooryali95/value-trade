import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n";

export type Crumb = { label: string; to?: string };

export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  crumbs?: Crumb[];
  actions?: ReactNode;
  eyebrow?: string;
}) {
  const { dir } = useI18n();
  const Sep = () => (
    <CaretRight
      size={12}
      weight="bold"
      className={dir === "rtl" ? "rotate-180 text-ink-soft/50" : "text-ink-soft/50"}
    />
  );
  return (
    <header className="mb-6 border-b border-border/60 pb-5">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-soft">
          {crumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <Sep />}
              {c.to ? (
                <Link to={c.to} className="transition hover:text-[var(--gold-deep)]">
                  {c.label}
                </Link>
              ) : (
                <span className="text-ink">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--gold-deep)]">
              {eyebrow}
            </div>
          )}
          <h1 className="truncate font-display text-2xl font-bold text-ink md:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm text-ink-soft">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}