import { useI18n, type Key } from "@/lib/i18n";

/**
 * Presentation of the submission to listing lifecycle (the states and
 * transitions themselves are enforced in SQL: review_submission,
 * approve_listing, decline_listing).
 */

export const STAGE_LABEL: Record<string, Key> = {
  pending: "d_stPending",
  approved: "d_stApproved",
  listed: "d_stListed",
  rejected: "d_stRejected",
};

export const NEXT_STEP: Record<string, Key> = {
  pending: "d_nextPending",
  approved: "d_nextApproved",
  listed: "d_nextListed",
  rejected: "d_nextRejected",
};

const STAGE_TONE: Record<string, string> = {
  pending: "border-state-pending/40 text-state-pending bg-state-pending/8",
  approved: "border-state-info/40 text-state-info bg-state-info/8",
  listed: "border-state-approved/40 text-state-approved bg-state-approved/8",
  rejected: "border-state-rejected/40 text-state-rejected bg-state-rejected/8",
};

/** The stage of a submission, in words the company and the operators share. */
export function SubmissionStageBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const key = STAGE_LABEL[status];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
        STAGE_TONE[status] ?? "border-border text-muted-foreground"
      }`}
    >
      {key ? t(key) : status}
    </span>
  );
}

const STEPS: Array<{ title: Key; body: Key; reached: string[] }> = [
  { title: "d_lcStep1Title", body: "d_lcStep1", reached: ["pending", "approved", "listed"] },
  { title: "d_lcStep2Title", body: "d_lcStep2", reached: ["approved", "listed"] },
  { title: "d_lcStep3Title", body: "d_lcStep3", reached: ["listed"] },
  { title: "d_lcStep4Title", body: "d_lcStep4", reached: ["listed"] },
];

/** The four steps, explained; `compact` shows titles only. */
export function LifecycleSteps({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="lifecycle-title" className="mb-5 rounded-xl border border-border/60 bg-card p-4">
      <h2 id="lifecycle-title" className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("d_lcTitle")}
      </h2>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <li key={s.title} className="min-w-0 rounded-lg border border-border/50 bg-background/60 p-3">
            <div className="text-xs font-semibold text-ink">{t(s.title)}</div>
            {!compact && <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{t(s.body)}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Where a single submission is in the lifecycle (for the company's list). */
export function StageProgress({ status }: { status: string }) {
  const { t } = useI18n();
  const rejected = status === "rejected";
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label={t("d_listingSteps")}>
      {STEPS.slice(0, 3).map((s, i) => {
        const done = s.reached.includes(status);
        return (
          <li key={s.title} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="h-px w-3 bg-border" />}
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                done
                  ? "border-[var(--gold-deep)]/50 bg-[var(--gold-soft)] font-semibold text-ink"
                  : rejected
                    ? "border-border text-muted-foreground line-through"
                    : "border-border text-muted-foreground"
              }`}
            >
              {t(s.title)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
