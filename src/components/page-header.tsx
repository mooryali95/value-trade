import { Link } from "@tanstack/react-router";
import type { ButtonHTMLAttributes, ReactNode } from "react";
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
      aria-hidden
    />
  );
  // Responsive: on small screens, collapse the middle of long trails to keep one line.
  const trail = crumbs ?? [];
  const collapse = trail.length > 3;
  return (
    <header className="mb-6 border-b border-border/60 pb-5">
      {trail.length > 0 && (
        <nav
          aria-label="breadcrumb"
          className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-soft"
        >
          {trail.map((c, i) => {
            const isLast = i === trail.length - 1;
            // hide middle crumbs on mobile to avoid wrapping
            const hideOnMobile = collapse && i > 0 && !isLast;
            return (
              <span
                key={i}
                className={`inline-flex items-center gap-1.5 ${hideOnMobile ? "hidden sm:inline-flex" : ""}`}
              >
                {i > 0 && <Sep />}
                {c.to && !isLast ? (
                  <Link to={c.to} className="transition hover:text-[var(--gold-deep)]">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current={isLast ? "page" : undefined} className={isLast ? "text-ink" : ""}>
                    {c.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
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
        {actions && (
          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

// ------- Unified header action buttons -------

type Variant = "primary" | "secondary" | "ghost";
const variantClasses: Record<Variant, string> = {
  primary:
    "gold-gradient text-ink shadow-sm hover:shadow-md disabled:opacity-50",
  secondary:
    "border border-border bg-background text-ink hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)] disabled:opacity-40",
  ghost:
    "text-ink-soft hover:text-[var(--gold-deep)] disabled:opacity-40",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition whitespace-nowrap";

export function HeaderAction({
  variant = "secondary",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button {...rest} className={`${base} ${variantClasses[variant]} ${className ?? ""}`}>
      {children}
    </button>
  );
}

export function HeaderLink({
  to,
  params,
  search,
  variant = "secondary",
  className,
  children,
}: {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  const cls = `${base} ${variantClasses[variant]} ${className ?? ""}`;
  return (
    <Link to={to as never} params={params as never} search={search as never} className={cls}>
      {children}
    </Link>
  );
}