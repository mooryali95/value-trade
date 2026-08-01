import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { LockSimple } from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n";

/**
 * Explains WHY an action is unavailable instead of silently hiding it.
 * Renders the children (typically a disabled button) plus an inline hint.
 */
export function PermissionHint({
  allowed,
  reason,
  children,
  showUpgradeLink = true,
}: {
  allowed: boolean;
  reason: string;
  children: ReactNode;
  showUpgradeLink?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="w-full">
      {children}
      {!allowed && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-caption text-ink-soft">
          <LockSimple size={12} weight="bold" className="shrink-0 text-[var(--state-pending,currentColor)]" />
          <span>
            <span className="font-semibold">{t("roleRequiredLabel")}:</span> {reason}
          </span>
          {showUpgradeLink && (
            <Link to="/company/settings" className="underline hover:text-[var(--gold-deep)]">
              {t("requestUpgradeCta")}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
