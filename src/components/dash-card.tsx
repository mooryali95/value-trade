import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * Shared "quick link" card used on mode dashboards (brand/platform).
 */
export function DashCard({
  to,
  icon: Icon,
  title,
  value,
  hint,
  highlight,
}: {
  to: string;
  icon: React.ComponentType<{ size?: number; weight?: "duotone" | "regular" }>;
  title: string;
  value?: ReactNode;
  hint: ReactNode;
  /** Something is waiting here. */
  highlight?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`group flex min-w-0 flex-col rounded-xl border bg-card p-5 shadow-card transition hover:border-[var(--gold)]/60 hover:shadow-luxury ${
        highlight ? "border-[var(--gold)]/60" : "border-border/70"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[var(--gold)]/10 text-[var(--gold-deep)]" aria-hidden>
          <Icon size={20} weight="duotone" />
        </div>
        {value != null && <span className="text-2xl font-bold leading-none text-ink">{value}</span>}
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{hint}</p>
    </Link>
  );
}
