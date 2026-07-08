import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { BRANDS } from "@/lib/mock-data";
import { recordShariahDecision, listShariahDecisions } from "@/lib/trading/shariah.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/shariah/review")({
  head: () => ({
    meta: [
      { title: "لوحة المراجعة الشرعية — قيمة" },
      { name: "description", content: "اعتماد أو رفض أو طلب معلومات عن الأدوات المدرجة." },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: ReviewPage,
});

function ReviewPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listShariahDecisions);
  const recordFn = useServerFn(recordShariahDecision);
  const { data: decisions, isLoading } = useQuery({ queryKey: ["shariah-decisions"], queryFn: () => listFn() });
  const [reason, setReason] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (v: { symbol: string; status: "halal" | "non_halal" | "reviewing"; reason?: string }) => recordFn({ data: v }),
    onSuccess: () => {
      toast.success(t("submitDecision"));
      qc.invalidateQueries({ queryKey: ["shariah-decisions"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  const pool = BRANDS.filter((b) => b.assetClass !== "sukuk" || b.shariah === "reviewing").slice(0, 20);

  return (
    <AppShell>
      <header className="mb-6">
        <div className="mb-3 h-px hairline-gold" />
        <h1 className="text-2xl font-bold text-ink md:text-3xl">{t("shariahReview")}</h1>
      </header>

      <section className="mb-8">
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          {pool.map((b) => (
            <div key={b.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto] items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{lang === "ar" ? b.nameAr : b.nameEn}</div>
                <div className="text-[10px] uppercase text-muted-foreground">{b.symbol} · {b.sector}</div>
              </div>
              <input
                placeholder={t("reason")}
                value={reason[b.symbol] ?? ""}
                onChange={(e) => setReason((r) => ({ ...r, [b.symbol]: e.target.value }))}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
              />
              <div className="flex gap-2">
                <button onClick={() => mutation.mutate({ symbol: b.symbol, status: "halal", reason: reason[b.symbol] })} className="rounded border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bull)]">{t("approve")}</button>
                <button onClick={() => mutation.mutate({ symbol: b.symbol, status: "reviewing", reason: reason[b.symbol] })} className="rounded border border-border px-3 py-1.5 text-[11px] font-semibold text-ink-soft">{t("requestInfo")}</button>
                <button onClick={() => mutation.mutate({ symbol: b.symbol, status: "non_halal", reason: reason[b.symbol] })} className="rounded border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bear)]">{t("reject")}</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">{t("decisions")}</h2>
        {isLoading ? (
          <LuxurySkeleton lines={4} />
        ) : !decisions || decisions.length === 0 ? (
          <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            {decisions.map((d) => (
              <div key={d.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/40 px-4 py-2 text-xs last:border-b-0">
                <span className="font-mono font-semibold text-ink">{d.symbol}</span>
                <span className="truncate text-muted-foreground">{d.reason ?? "—"}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${d.status === "halal" ? "border-[var(--bull)]/40 text-[var(--bull)]" : d.status === "non_halal" ? "border-[var(--bear)]/40 text-[var(--bear)]" : "border-[var(--gold-deep)]/40 text-[var(--gold-deep)]"}`}>{d.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}