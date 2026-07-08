import { WarningOctagon } from "@phosphor-icons/react";
import { useRouter } from "@tanstack/react-router";

type Props = { title?: string; description?: string; reset?: () => void };

export function ErrorState({ title, description, reset }: Props) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-card px-6 py-10 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-[var(--bear)]/30 bg-[var(--bear)]/5 text-[var(--bear)]">
        <WarningOctagon size={22} weight="duotone" />
      </div>
      <h3 className="text-sm font-semibold text-ink">{title ?? "تعذّر تحميل هذه الصفحة"}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {description ?? "حدث خلل مؤقت في الاتصال. أعد المحاولة أو ارجع للرئيسية."}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <button
          onClick={() => { router.invalidate(); reset?.(); }}
          className="rounded-md gold-gradient px-4 py-2 text-xs font-semibold text-ink"
        >
          إعادة المحاولة
        </button>
        <a href="/" className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-ink-soft hover:border-[var(--gold-deep)]">
          الرئيسية
        </a>
      </div>
    </div>
  );
}