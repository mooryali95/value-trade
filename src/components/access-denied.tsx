import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";

export function AccessDenied({ backTo = "/workspace" }: { backTo?: string }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-border/60 bg-card p-8 text-center">
      <div className="mx-auto mb-3 h-px w-16 hairline-gold" />
      <h2 className="text-lg font-semibold text-ink">{t("notAuthorizedTitle")}</h2>
      <p className="mt-2 text-xs text-ink-soft">{t("notAuthorizedDesc")}</p>
      <Link
        to={backTo}
        className="mt-5 inline-flex items-center rounded-md border border-border px-4 py-2 text-xs font-semibold text-ink hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)]"
      >
        {t("backToWorkspace")}
      </Link>
    </div>
  );
}