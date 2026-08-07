import { ChartLine, Briefcase, ShieldCheck, CaretDown } from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n";
import { useAppMode, type AppMode } from "@/lib/nav/app-mode";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MODE_ICON: Record<
  AppMode,
  React.ComponentType<{ size?: number; weight?: "regular" | "duotone" | "bold" }>
> = {
  investor: ChartLine,
  brand: Briefcase,
  platform: ShieldCheck,
};

export function ModeSwitcher() {
  const { t } = useI18n();
  const { mode, setMode, availableModes } = useAppMode();

  // Nothing to switch between -- keep single-persona users' header uncluttered.
  if (availableModes.length <= 1) return null;

  const label = (m: AppMode) =>
    m === "investor" ? t("modeInvestor") : m === "brand" ? t("modeBrand") : t("modePlatform");

  const Icon = MODE_ICON[mode];
  const accent =
    mode === "platform" ? "var(--navy)" : mode === "brand" ? "var(--bull)" : "var(--gold-deep)";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] font-semibold outline-none transition"
        style={{
          borderColor: `color-mix(in oklch, ${accent} 40%, transparent)`,
          backgroundColor: `color-mix(in oklch, ${accent} 6%, transparent)`,
          color: accent,
        }}
      >
        <Icon size={15} weight="duotone" />
        <span className="hidden sm:inline">{label(mode)}</span>
        <CaretDown size={10} weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <div className="px-2 pb-1.5 pt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {t("modeSwitcherLabel")}
        </div>
        {availableModes.map((m) => {
          const MIcon = MODE_ICON[m];
          return (
            <DropdownMenuItem
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center gap-2 ${m === mode ? "text-[var(--gold-deep)]" : "text-ink"}`}
            >
              <MIcon size={15} weight={m === mode ? "duotone" : "regular"} />
              {label(m)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
