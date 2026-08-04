import type { ReactNode } from "react";
import { FolderOpen } from "@phosphor-icons/react";
import { ValueDots } from "@/components/dot-pattern";

type Props = { title: string; description?: string; icon?: ReactNode; action?: ReactNode };

export function EmptyState({ title, description, icon, action }: Props) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card px-6 py-12 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.05]">
        <div className="absolute -end-4 -top-4">
          <ValueDots size={72} color="var(--gold-deep)" />
        </div>
      </div>
      <div className="relative mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-[var(--gold)]/30 bg-[var(--gold-soft)] text-ink">
        {icon ?? <FolderOpen size={22} weight="duotone" />}
      </div>
      <h3 className="relative text-sm font-semibold text-ink">{title}</h3>
      {description && (
        <p className="relative mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="relative mt-4 flex justify-center">{action}</div>}
    </div>
  );
}