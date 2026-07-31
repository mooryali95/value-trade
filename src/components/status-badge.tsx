import { useI18n } from "@/lib/i18n";

/**
 * Single source of truth for status presentation.
 * Tone maps to the semantic state tokens declared in src/styles.css —
 * never hardcode a colour here.
 */
type Tone = "approved" | "rejected" | "pending" | "info" | "neutral";

const TONE_BY_STATUS: Record<string, Tone> = {
  approved: "approved",
  halal: "approved",
  filled: "approved",
  accepted: "approved",
  active: "approved",
  sent: "approved",
  rejected: "rejected",
  non_halal: "rejected",
  cancelled: "rejected",
  canceled: "rejected",
  failed: "rejected",
  revoked: "rejected",
  expired: "rejected",
  pending: "pending",
  reviewing: "pending",
  queued: "pending",
  open: "pending",
  modified: "info",
  updated: "info",
};

const LABEL_KEY_BY_STATUS: Record<string, string> = {
  approved: "statusApproved",
  halal: "statusApproved",
  filled: "statusFilled",
  rejected: "statusRejected",
  non_halal: "statusRejected",
  cancelled: "statusCancelled",
  canceled: "statusCancelled",
  pending: "statusPending",
  reviewing: "statusPending",
  modified: "modified",
};

const TONE_CLASSES: Record<Tone, string> = {
  approved: "border-state-approved/40 text-state-approved bg-state-approved/8",
  rejected: "border-state-rejected/40 text-state-rejected bg-state-rejected/8",
  pending: "border-state-pending/40 text-state-pending bg-state-pending/8",
  info: "border-state-info/40 text-state-info bg-state-info/8",
  neutral: "border-border text-state-neutral bg-muted/50",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const { t } = useI18n();
  const key = (status ?? "").toLowerCase();
  const tone = TONE_BY_STATUS[key] ?? "neutral";
  const labelKey = LABEL_KEY_BY_STATUS[key];
  const label = labelKey ? (t(labelKey as never) ?? status) : status;

  return (
    <span
      data-status={key}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-label ${TONE_CLASSES[tone]} ${className ?? ""}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}