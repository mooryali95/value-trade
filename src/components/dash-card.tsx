import { Link } from "@tanstack/react-router";

/**
 * Shared "quick link" card used on mode dashboards (brand/platform).
 * Previously duplicated byte-for-byte in brand-dashboard.tsx and
 * platform-dashboard.tsx -- first extraction from the UX audit's
 * "unify repeated components" finding.
 */
export function DashCard({
  to,
  icon: Icon,
  title,
  value,
  hint,
}: {
  to: string;
  icon: React.ComponentType<{ size?: number; weight?: "duotone" | "regular" }>;
  title: string;
  value?: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-[var(--gold)]/50 hover:shadow-luxury"
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[var(--gold)]/10 text-[var(--gold-deep)]">
        <Icon size={18} weight="duotone" />
      </div>
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {value && (
          <span className="font-mono text-lg font-bold text-[var(--gold-deep)]">{value}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </Link>
  );
}
