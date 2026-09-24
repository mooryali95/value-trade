import { Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { useI18n } from "@/lib/i18n";

export function NotFoundBlock({ kind = "symbol" }: { kind?: "symbol" | "company" }) {
  const { t } = useI18n();
  return (
    <AppShell>
      <div className="py-16">
        <EmptyState
          title={kind === "company" ? t("notFoundCompanyTitle") : t("notFoundSymbolTitle")}
          description={kind === "company" ? t("g_notFoundCompanyDesc") : t("notFoundSymbolDesc")}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link
                to="/market"
                className="inline-flex min-h-11 items-center rounded-md gold-gradient px-4 py-2 text-xs font-semibold text-ink"
              >
                {t("goToMarket")}
              </Link>
              <Link
                to="/"
                className="inline-flex min-h-11 items-center rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-ink-soft hover:border-[var(--gold-deep)]"
              >
                {t("g_goHome")}
              </Link>
            </div>
          }
        />
      </div>
    </AppShell>
  );
}
