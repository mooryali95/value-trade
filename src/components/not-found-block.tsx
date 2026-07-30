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
          description={kind === "company" ? undefined : t("notFoundSymbolDesc")}
          action={
            <Link
              to="/market"
              className="rounded-md gold-gradient px-4 py-2 text-xs font-semibold text-ink"
            >
              {t("goToMarket")}
            </Link>
          }
        />
      </div>
    </AppShell>
  );
}