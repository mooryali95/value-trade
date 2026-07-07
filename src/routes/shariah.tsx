import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";
import { SHARIAH_BOARD, SHARIAH_STANDARDS, BRANDS } from "@/lib/mock-data";
import { ShieldCheck, ScrollText } from "lucide-react";

export const Route = createFileRoute("/shariah")({
  head: () => ({
    meta: [
      { title: "الهيئة الشرعية — قيمة | Shariah Board — Value Unit" },
      { name: "description", content: "هيئة رقابة شرعية مستقلة وفق معايير AAOIFI." },
    ],
  }),
  component: ShariahPage,
});

function ShariahPage() {
  const { t, lang } = useI18n();
  const decisions = BRANDS.slice(0, 8);
  return (
    <AppShell>
      <header className="mb-8 grid gap-3">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <ShieldCheck className="h-3.5 w-3.5" /> AAOIFI Aligned
        </div>
        <h1 className="text-3xl font-bold text-foreground md:text-4xl">{t("aboutBoard")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground md:text-base">{t("aboutBoardDesc")}</p>
      </header>

      <section className="mb-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("members")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SHARIAH_BOARD.map((m) => (
            <div key={m.nameEn} className="rounded-xl border border-border/60 bg-card/60 p-5">
              <div className="mb-3 grid h-14 w-14 place-items-center rounded-full gold-gradient text-lg font-bold text-[oklch(0.16_0.04_260)]">
                {(lang === "ar" ? m.nameAr : m.nameEn).split(" ")[0][0]}
              </div>
              <div className="font-semibold text-foreground">{lang === "ar" ? m.nameAr : m.nameEn}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{lang === "ar" ? m.roleAr : m.roleEn}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("decisions")}</h2>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
            {decisions.map((b) => (
              <div key={b.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: b.color }}>{b.symbol.slice(0,3)}</div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{lang === "ar" ? b.nameAr : b.nameEn}</div>
                  <div className="text-[10px] text-muted-foreground">{b.symbol} · AAOIFI-{21 + (b.price | 0) % 10}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${b.shariah === "halal" ? "bg-[var(--bull)]/15 text-[var(--bull)]" : "bg-secondary text-muted-foreground"}`}>
                  {b.shariah === "halal" ? t("halal") : t("reviewing")}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("standards")}</h2>
          <div className="space-y-3">
            {SHARIAH_STANDARDS.map((s) => (
              <div key={s.code} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-xl border border-border/60 bg-card/60 p-4">
                <ScrollText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="text-xs font-mono text-primary">{s.code}</div>
                  <div className="mt-0.5 text-sm font-semibold text-foreground">{lang === "ar" ? s.ar : s.en}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}