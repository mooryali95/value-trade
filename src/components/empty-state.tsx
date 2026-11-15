import type { ReactNode } from "react";
import { FolderOpen } from "@phosphor-icons/react";
import { ValueDots } from "@/components/dot-pattern";

type Props = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  /** Extra guidance shown under the action (e.g. "clearing filters restores the list"). */
  hint?: string;
};

export function EmptyState({ title, description, icon, action, hint }: Props) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="relative overflow-hidden rounded-xl border border-border/70 bg-card px-5 py-10 text-center sm:px-8 sm:py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.05]">
        <div className="absolute -end-4 -top-4">
          <ValueDots size={72} color="var(--gold-deep)" />
        </div>
      </div>
      <div aria-hidden className="relative mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-[var(--gold)]/30 bg-[var(--gold-soft)] text-ink">
        {icon ?? <FolderOpen size={22} weight="duotone" />}
      </div>
      <h3 className="relative text-base font-bold text-ink">{title}</h3>
      {description && (
        <p className="relative mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="relative mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
      {hint && <p className="relative mx-auto mt-3 max-w-md text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}