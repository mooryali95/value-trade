import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { Num } from "@/components/num";
import { formatDateTime } from "@/components/market-data";
import { useI18n } from "@/lib/i18n";
import { getRealizedPnl } from "@/lib/trading/realized.functions";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 25;
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
      { title: "الأرباح المحققة — وحدة القيمة | Realized P&L — Value Unit" },
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

/** Money as a plain two-decimal string for CSV (the values are exact cents). */
function csvMoney(n: number): string {
  const s = n.toFixed(2);
  return s === "-0.00" ? "0.00" : s;
}

function RealizedPage() {
  const { t, lang } = useI18n();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // Long histories render in pages; the CSV always has every row.
  const [shown, setShown] = useState(PAGE);
  const patch = (p: Partial<SearchState>) => {
    setShown(PAGE);
    return navigate({ search: (prev: SearchState) => ({ ...prev, ...p }), replace: true });
  };

  // Days are Asia/Riyadh trading days; the server applies the boundaries.
  const from = DAY.test(search.from) ? search.from : "";
  const to = DAY.test(search.to) ? search.to : "";
  const symbol = search.symbol.trim().toUpperCase();
  const rangeInvalid = !!from && !!to && from > to;

  const fn = useServerFn(getRealizedPnl);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["realized", from, to, symbol],
    queryFn: () =>
      fn({
        data: {
          from: from || undefined,
          to: to || undefined,
          symbol: symbol || undefined,
        },
      }),
    enabled: !rangeInvalid,
  });

  const totals = data?.totals;
  const pnlTone = (n: number | null | undefined) =>
    n == null || n === 0 ? "text-ink" : n > 0 ? "text-[var(--bull)]" : "text-[var(--bear)]";

  const exportCsv = () => {
    const rows = data?.trades ?? [];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "symbol", "order_id", "closed_at_utc", "closed_at_riyadh", "qty", "executions",
      "avg_exit_price", "proceeds", "cost_basis", "realized", "return_pct",
    ];
    const csv = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.symbol, r.orderId, r.at, formatDateTime(r.at, "en"), r.qty, r.fills,
          r.exitPrice.toFixed(4), csvMoney(r.proceeds), csvMoney(r.costBasis), csvMoney(r.realized),
          r.returnPct == null ? "" : r.returnPct.toFixed(2),
        ].map(esc).join(","),
      ),
    ].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `realized-pnl-${from || "start"}-${to || "today"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
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
            type="button"
            onClick={exportCsv}
            disabled={!data?.trades.length}
            className="min-h-10 rounded-md border border-border px-4 text-sm font-semibold text-ink hover:border-[var(--gold-deep)] disabled:opacity-40"
          >
            {t("exportCsv")}
          </button>
        }
      />

      <div className="mb-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <label className="min-w-0 text-caption text-ink-soft">
          <span className="block">{t("dateFrom")}</span>
          <input
            type="date"
            dir="ltr"
            value={from}
            max={to || undefined}
            onChange={(e) => patch({ from: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <label className="min-w-0 text-caption text-ink-soft">
          <span className="block">{t("dateTo")}</span>
          <input
            type="date"
            dir="ltr"
            value={to}
            min={from || undefined}
            onChange={(e) => patch({ to: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <label className="col-span-2 min-w-0 text-caption text-ink-soft sm:w-40 sm:flex-none">
          <span className="block">{t("e2_colSymbol")}</span>
          <input
            value={search.symbol}
            onChange={(e) => patch({ symbol: e.target.value })}
            placeholder={t("m_symbolExact")}
            dir="ltr"
            maxLength={32}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono uppercase text-ink"
          />
        </label>
        <button
          type="button"
          onClick={() => patch({ from: "", to: "", symbol: "" })}
          className="col-span-2 min-h-9 rounded-md border border-border px-3 py-1.5 text-xs text-ink-soft hover:border-[var(--gold-deep)] sm:col-span-1"
        >
          {t("resetFilters")}
        </button>
      </div>
      <p className="mb-4 text-[11px] leading-relaxed text-muted-foreground">{t("m_riyadhDays")}</p>

      {rangeInvalid ? (
        <p role="alert" className="rounded-md border border-[var(--bear)]/30 bg-[var(--bear)]/5 px-3 py-2 text-xs text-[var(--bear)]">
          {t("m_invalidRange")}
        </p>
      ) : isLoading ? (
        <LuxurySkeleton lines={6} />
      ) : isError || !data || !totals ? (
        <div className="py-10">
          <ErrorState reset={() => refetch()} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="status" aria-live="polite" aria-atomic="false">
            <Kpi
              label={t("realizedTotal")}
              value={<Num value={totals.realized} kind="currency" signed />}
              tone={pnlTone(totals.realized)}
              hint={totals.returnPct == null ? undefined : <>{t("m_returnPct")} <Num value={totals.returnPct} kind="pct" signed /></>}
            />
            <Kpi label={t("proceeds")} value={<Num value={totals.proceeds} kind="currency" />} />
            <Kpi label={t("costBasis")} value={<Num value={totals.costBasis} kind="currency" />} />
            <Kpi
              label={t("closedTrades")}
              value={<Num value={data.trades.length} kind="qty" />}
              hint={t("m_winsLosses")
                .replace("{w}", String(totals.wins))
                .replace("{l}", String(totals.losses))
                .replace("{f}", String(totals.flat))}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t("m_realizedMethod")}</p>

          {data.trades.length === 0 ? (
            <div className="mt-4">
              <EmptyState title={t("noRealizedTrades")} description={t("realizedPnlDesc")} />
            </div>
          ) : (
            <>
              <section className="mt-5">
                <h2 className="mb-2 text-label text-ink-soft">{t("bySymbol")}</h2>
                <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
                  <div className="hidden grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,1fr))] gap-3 border-b border-border/50 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground sm:grid">
                    <span>{t("e2_colSymbol")}</span>
                    <span className="text-end">{t("m_qtyClosed")}</span>
                    <span className="text-end">{t("proceeds")}</span>
                    <span className="text-end">{t("costBasis")}</span>
                    <span className="text-end">{t("realizedTotal")}</span>
                  </div>
                  {data.bySymbol.map((s) => (
                    <div key={s.symbol} className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-border/40 px-4 py-3 text-xs last:border-b-0 sm:grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,1fr))] sm:items-center">
                      <span className="font-mono font-semibold uppercase text-ink">{s.symbol}</span>
                      <span className={`text-end font-mono sm:order-last ${pnlTone(s.realized)}`}>
                        <Num value={s.realized} kind="currency" signed />
                        {s.returnPct != null && <span className="ms-1 text-[10px]">(<Num value={s.returnPct} kind="pct" signed />)</span>}
                      </span>
                      <span className="text-ink-soft sm:text-end"><span className="sm:hidden">{t("m_qtyClosed")} </span><Num value={s.qty} kind="qty" className="font-mono" /></span>
                      <span className="text-end text-ink-soft"><span className="sm:hidden">{t("proceeds")} </span><Num value={s.proceeds} kind="currency" className="font-mono" /></span>
                      <span className="hidden text-end font-mono text-ink-soft sm:block"><Num value={s.costBasis} kind="currency" /></span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mt-5">
                <h2 className="mb-2 text-label text-ink-soft">{t("closedTrades")}</h2>
                <div className="hidden overflow-x-auto rounded-xl border border-border/60 bg-card md:block">
                  <div className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_1.3fr_repeat(4,minmax(0,1fr))] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>{t("e2_colSymbol")}</span>
                    <span>{t("m_closedAt")}</span>
                    <span className="text-end">{t("qty")}</span>
                    <span className="text-end">{t("m_avgExitPrice")}</span>
                    <span className="text-end">{t("costBasis")}</span>
                    <span className="text-end">{t("realizedTotal")}</span>
                  </div>
                  {data.trades.slice(0, shown).map((tr) => (
                    <div key={`${tr.symbol}:${tr.orderId}`} className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_1.3fr_repeat(4,minmax(0,1fr))] items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0">
                      <span className="font-mono font-semibold uppercase text-ink">{tr.symbol}</span>
                      <span className="text-ink-soft">
                        {formatDateTime(tr.at, lang)}
                        {tr.fills > 1 && <span className="block text-[10px] text-muted-foreground">{t("m_executions").replace("{n}", String(tr.fills))}</span>}
                      </span>
                      <span className="text-end font-mono"><Num value={tr.qty} kind="qty" /></span>
                      <span className="text-end font-mono"><Num value={tr.exitPrice} decimals={exitDecimals(tr.exitPrice)} /></span>
                      <span className="text-end font-mono text-ink-soft"><Num value={tr.costBasis} kind="currency" /></span>
                      <span className={`text-end font-mono ${pnlTone(tr.realized)}`}>
                        <Num value={tr.realized} kind="currency" signed />
                        <span className="block text-[10px]"><Num value={tr.returnPct} kind="pct" signed /></span>
                      </span>
                    </div>
                  ))}
                </div>

                <ul className="space-y-2 md:hidden">
                  {data.trades.slice(0, shown).map((tr) => (
                    <li key={`${tr.symbol}:${tr.orderId}`} className="rounded-xl border border-border/60 bg-card p-3 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-mono font-semibold uppercase text-ink">{tr.symbol}</span>
                          <span className="block text-[10px] text-ink-soft">{formatDateTime(tr.at, lang)}</span>
                        </div>
                        <span className={`shrink-0 text-end font-mono ${pnlTone(tr.realized)}`}>
                          <Num value={tr.realized} kind="currency" signed />
                          <span className="block text-[10px]"><Num value={tr.returnPct} kind="pct" signed /></span>
                        </span>
                      </div>
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                        <MiniStat label={t("qty")} value={<Num value={tr.qty} kind="qty" />} />
                        <MiniStat label={t("m_avgExitPrice")} value={<Num value={tr.exitPrice} decimals={exitDecimals(tr.exitPrice)} />} />
                        <MiniStat label={t("costBasis")} value={<Num value={tr.costBasis} kind="currency" />} />
                      </dl>
                      {tr.fills > 1 && <div className="mt-1 text-[10px] text-muted-foreground">{t("m_executions").replace("{n}", String(tr.fills))}</div>}
                    </li>
                  ))}
                </ul>
                {data.trades.length > shown && (
                  <div className="mt-3 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setShown((n) => n + 50)}
                      className="min-h-10 rounded-md border border-border px-4 text-xs font-semibold text-ink hover:border-[var(--gold-deep)]"
                    >
                      {t("m_showMore").replace("{n}", String(data.trades.length - shown))}
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

/** An average exit price keeps up to 4 decimals only when it has them. */
function exitDecimals(p: number): number {
  return Math.round(p * 100) / 100 === p ? 2 : 4;
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-ink">{value}</dd>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-card p-3 sm:p-4">
      <div className="text-label text-ink-soft">{label}</div>
      <div className={`mt-1 break-words font-mono text-base font-semibold sm:text-lg ${tone ?? "text-ink"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-ink-soft">{hint}</div>}
    </div>
  );
}
