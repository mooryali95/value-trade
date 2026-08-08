import { Link } from "@tanstack/react-router";

type BadgeVariant = "gold" | "neutral" | "bull" | "bear";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  gold: "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold-deep)]",
  neutral: "border-border bg-secondary text-ink-soft",
  bull: "border-[var(--bull)]/40 bg-[var(--bull)]/10 text-[var(--bull)]",
  bear: "border-[var(--bear)]/40 bg-[var(--bear)]/10 text-[var(--bear)]",
};

/**
 * Shared pill/badge, extracted per the UX audit's "unify repeated
 * components" finding -- three near-identical inline implementations
 * (access-requests method badge, companies-directory plan/sector badges)
 * had drifted slightly (10px vs 11px text, inconsistent hover states).
 */
export function Badge({
  children,
  variant = "neutral",
  to,
  className = "",
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  to?: string;
  className?: string;
}) {
  const cls = `rounded-full border px-2 py-0.5 text-[11px] font-semibold ${VARIANT_CLASSES[variant]} ${className}`;
  if (to) {
    return (
      <Link to={to} className={`${cls} transition hover:brightness-95`}>
        {children}
      </Link>
    );
  }
  return <span className={cls}>{children}</span>;
}
