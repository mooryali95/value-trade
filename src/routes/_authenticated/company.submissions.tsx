import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { listCompanySubmissions } from "@/lib/submissions/submissions.functions";
import { StatusBadge } from "@/components/status-badge";

export const Route = createFileRoute("/_authenticated/company/submissions")({
  validateSearch: (s: Record<string, unknown>) =>
    z.object({ companyId: z.string().uuid() }).parse(s),
  head: () => ({
    meta: [
      { title: "طروحات الشركة — قيمة" },
      { name: "description", content: "حالة الطروحات المقدَّمة للاعتماد." },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: CompanySubmissions,
});

function CompanySubmissions() {
  const { t, lang } = useI18n();
  const { companyId } = Route.useSearch();
  const listFn = useServerFn(listCompanySubmissions);
  const { data, isLoading } = useQuery({
    queryKey: ["submissions", companyId],
    queryFn: () => listFn({ data: { companyId } }),
  });

  return (
    <AppShell>
      <header className="mb-6">
        <div className="h-px hairline-gold mb-3" />
        <h1 className="text-2xl font-bold text-ink md:text-3xl">{t("submissionsIn")}</h1>
      </header>
      {isLoading ? (
        <LuxurySkeleton lines={5} />
      ) : !data || data.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            <div>Symbol</div><div>Class</div><div>Sector</div><div>Submitted</div><div>Status</div>
          </div>
          {data.map((s) => (
            <div key={s.id} className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0">
              <div className="min-w-0">
                <div className="truncate font-semibold text-ink">{lang === "ar" ? s.name_ar : s.name_en}</div>
                <div className="text-[10px] font-mono uppercase text-muted-foreground">{s.symbol}</div>
              </div>
              <div className="font-mono">{s.asset_class}</div>
              <div className="text-muted-foreground">{s.sector ?? "—"}</div>
              <div className="text-muted-foreground">{new Date(s.submitted_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</div>
              <div><StatusBadge status={s.status} /></div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}