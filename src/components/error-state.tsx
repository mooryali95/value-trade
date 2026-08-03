import { WarningOctagon } from "@phosphor-icons/react";
import { useRouter } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";

type Props = { title?: string; description?: string; reset?: () => void; hint?: string };

export function ErrorState({ title, description, reset, hint }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mx-auto max-w-md rounded-xl border border-border bg-card px-6 py-10 text-center"
    >
      <div
        aria-hidden
        className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-[var(--bear)]/30 bg-[var(--bear)]/5 text-[var(--bear)]"
      >
        <WarningOctagon size={22} weight="duotone" />
      </div>
      <h3 className="text-sm font-semibold text-ink">{title ?? t("errorTitle")}</h3>
      <p className="mt-1.5 text-caption leading-relaxed text-muted-foreground">
        {description || t("errorDesc")}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button
          onClick={() => {
            router.invalidate();
            reset?.();
          }}
          className="min-h-11 rounded-md gold-gradient px-4 text-xs font-semibold text-ink"
        >
          {t("tryAgain")}
        </button>
        <a
          href="/"
          className="inline-flex min-h-11 items-center rounded-md border border-border bg-background px-4 text-xs font-semibold text-ink-soft hover:border-[var(--gold-deep)]"
        >
          {t("backHome")}
        </a>
      </div>
      <p className="mt-3 text-caption text-ink-soft">{hint ?? t("errorHint")}</p>
    </div>
  );
}
