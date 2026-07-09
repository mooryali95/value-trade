import { useI18n } from "@/lib/i18n";

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const label =
    status === "approved" || status === "halal" || status === "filled" ? t("statusApproved" as never) ?? status :
    status === "rejected" || status === "non_halal" || status === "cancelled" ? t("statusRejected" as never) ?? status :
    status === "modified" ? t("modified" as never) ?? status :
    status === "pending" || status === "reviewing" ? t("statusPending" as never) ?? status :
    status;
  const tone =
    ["approved", "halal", "filled"].includes(status) ? "bull" :
    ["rejected", "non_halal", "cancelled"].includes(status) ? "bear" :
    "gold";
  const cls = tone === "bull"
    ? "border-[var(--bull)]/40 text-[var(--bull)]"
    : tone === "bear"
    ? "border-[var(--bear)]/40 text-[var(--bear)]"
    : "border-[var(--gold-deep)]/40 text-[var(--gold-deep)]";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}