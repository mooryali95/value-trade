import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { formatCurrency, formatPct } from "@/lib/format";
import { getRealizedPnl } from "@/lib/trading/realized.functions";

const SearchSchema = z.object({
  from: z.string().catch("").default(""),
  to: z.string().catch("").default(""),
  symbol: z.string().catch("").default(""),
});
type SearchState = z.infer<typeof SearchSchema>;

export const Route = createFileRoute("/_authenticated/portfolio_/realized")({
  validateSearch: (s: Record<string, unknown>) => SearchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "الأرباح المحققة — وحدة القيمة" },
      { name: "description", content: "كشف الأرباح والخسائر المحققة على الإغلاقات حسب الرمز والمدة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ reset }) => (
    <AppShell>
      <div className="py-16">
        <ErrorState reset={reset} />
      </div>
    </AppShell>
  ),
  component: RealizedPage,
});

function RealizedPage() {
  const { t, lang } = useI18n();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const patch = (p: Partial<SearchState>) =>
    navigate({ search: (prev: SearchState) => ({ ...prev, ...p }), replace: true });

  const fn = useServerFn(getRealizedPnl);
  const { data, isLoading } = useQuery({
    queryKey: ["realized", search.from, search.to, search.symbol],
    queryFn: () =>
      fn({
        data: {
          from: search.from || undefined,
          to: search.to || undefined,
          symbol: search.symbol || undefined,
        },
      }),
  });

  const totals = data?.totals;
  const pnlColor = (n: number) =>
    n > 0 ? "text-[var(--bull)]" : n < 0 ? "text-[var(--bear)]" : "text-ink";

  const exportCsv = () => {
    const rows = data?.trades ?? [];
    const header = ["symbol", "at", "qty", "exit_price", "cost_basis", "proceeds", "realized", "return_pct"];
    const csv = [
      header.join(","),
      ...rows.map((r) =>
        [r.symbol, r.at, r.qty, r.exitPrice, r.costBasis, r.proceeds, r.realized, r.returnPct].join(","),
      ),
    ].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `realized-pnl-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("portfolio")}
        title={t("realizedPnl")}
        description={t("realizedPnlDesc")}
        crumbs={[{ label: t("portfolio"), to: "/portfolio" }, { label: t("realizedPnl") }]}
        actions={
          <button
            onClick={exportCsv}
            disabled={!data?.trades.length}
            className="min-h-11 rounded-md border border-border px-4 text-sm font-semibold text-ink hover:border-[var(--gold-deep)] disabled:opacity-40"
          >
            {t("exportCsv")}
          </button>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-caption text-ink-soft">
          <span className="block">{t("dateFrom")}</span>
          <input
            type="date"
            value={search.from}
            onChange={(e) => patch({ from: e.target.value })}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <label className="text-caption text-ink-soft">
          <span className="block">{t("dateTo")}</span>
          <input
            type="date"
            value={search.to}
            onChange={(e) => patch({ to: e.target.value })}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <label className="min-w-[160px] flex-1 text-caption text-ink-soft">
          <span className="block">{t("search")}</span>
          <input
            value={search.symbol}
            onChange={(e) => patch({ symbol: e.target.value })}
            placeholder="SYMBOL"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono uppercase text-ink"
          />
        </label>
        <button
          onClick={() => patch({ from: "", to: "", symbol: "" })}
          className="min-h-9 rounded-md border border-border px-2 py-1.5 text-xs text-ink-soft hover:border-[var(--gold-deep)]"
        >
          {t("resetFilters")}
        </button>
      </div>

      {isLoading ? (
        <LuxurySkeleton lines={6} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="status" aria-live="polite">
            <Kpi label={t("realizedTotal")} value={formatCurrency(totals?.realized ?? 0, false, lang)} tone={pnlColor(totals?.realized ?? 0)} />
            <Kpi label={t("proceeds")} value={formatCurrency(totals?.proceeds ?? 0, false, lang)} />
            <Kpi label={t("costBasis")} value={formatCurrency(totals?.costBasis ?? 0, false, lang)} />
            <Kpi
              label={t("closedTrades")}
              value={`${data?.trades.length ?? 0}`}
              hint={`${totals?.wins ?? 0} ${t("winningTrades")} · ${totals?.losses ?? 0} ${t("losingTrades")}`}
            />
          </div>

          {!data?.trades.length ? (
            <div className="mt-4">
              <EmptyState title={t("noRealizedTrades")} description={t("realizedPnlDesc")} />
            </div>
          ) : (
            <>
              <section className="mt-5">
                <h2 className="mb-2 text-label text-ink-soft">{t("bySymbol")}</h2>
                <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
                  {data.bySymbol.map((s) => (
                    <div key={s.symbol} className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0">
                      <span className="font-mono font-semibold uppercase text-ink">{s.symbol}</span>
                      <span className="text-ink-soft">{s.qty}</span>
                      <span className={`font-mono ${pnlColor(s.realized)}`}>{formatCurrency(s.realized, false, lang)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mt-5">
                <h2 className="mb-2 text-label text-ink-soft">{t("closedTrades")}</h2>
                <div className="hidden overflow-hidden rounded-xl border border-border/60 bg-card md:block">
                  <div className="grid grid-cols-[minmax(0,1fr)_1fr_1fr_1fr_1fr_1fr] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>Symbol</span>
                    <span>{t("createdAt")}</span>
                    <span className="text-end">{t("qty")}</span>
                    <span className="text-end">{t("exitPrice")}</span>
                    <span className="text-end">{t("costBasis")}</span>
                    <span className="text-end">{t("realizedTotal")}</span>
                  </div>
                  {data.trades.map((tr) => (
                    <div key={tr.orderId} className="grid grid-cols-[minmax(0,1fr)_1fr_1fr_1fr_1fr_1fr] items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0">
                      <span className="font-mono font-semibold uppercase text-ink">{tr.symbol}</span>
                      <span className="text-ink-soft">{new Date(tr.at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</span>
                      <span className="text-end font-mono">{tr.qty}</span>
                      <span className="text-end font-mono">{formatCurrency(tr.exitPrice, false, lang)}</span>
                      <span className="text-end font-mono text-ink-soft">{formatCurrency(tr.costBasis, false, lang)}</span>
                      <span className={`text-end font-mono ${pnlColor(tr.realized)}`}>
                        {formatCurrency(tr.realized, false, lang)}
                        <span className="ms-1 text-[10px]">({formatPct(tr.returnPct)})</span>
                      </span>
                    </div>
                  ))}
                </div>

                <ul className="space-y-2 md:hidden">
                  {data.trades.map((tr) => (
                    <li key={tr.orderId} className="rounded-xl border border-border/60 bg-card p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold uppercase text-ink">{tr.symbol}</span>
                        <span className={`font-mono ${pnlColor(tr.realized)}`}>
                          {formatCurrency(tr.realized, false, lang)} ({formatPct(tr.returnPct)})
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] text-ink-soft">
                        {new Date(tr.at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")} · {tr.qty} @{" "}
                        {formatCurrency(tr.exitPrice, false, lang)} · {t("costBasis")}{" "}
                        {formatCurrency(tr.costBasis, false, lang)}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="text-label text-ink-soft">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${tone ?? "text-ink"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-ink-soft">{hint}</div>}
    </div>
  );
}
