import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { getMyPortfolio } from "@/lib/trading/portfolio.functions";
import { getBrand } from "@/lib/mock-data";
import { formatCurrency, formatPct } from "@/lib/format";
import { positionValue, unrealizedPnl, weight } from "@/lib/trading/calc";

export const Route = createFileRoute("/_authenticated/portfolio")({
  head: () => ({
    meta: [
      { title: "المحفظة — قيمة | Portfolio — Value Unit" },
      { name: "description", content: "مراكزك، رصيدك النقدي، وسجل أوامرك." },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: PortfolioPage,
});

function PortfolioPage() {
  const { t, lang } = useI18n();
  const fetchPortfolio = useServerFn(getMyPortfolio);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => fetchPortfolio(),
    staleTime: 15_000,
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="space-y-4">
          <LuxurySkeleton lines={2} className="max-w-md" />
          <LuxurySkeleton lines={6} />
        </div>
      </AppShell>
    );
  }
  if (isError || !data) {
    return (<AppShell><div className="py-16"><ErrorState reset={() => refetch()} /></div></AppShell>);
  }

  const cash = Number(data.portfolio?.cash_balance ?? 0);
  const enriched = data.positions.map((p) => {
    const b = getBrand(p.symbol.toLowerCase());
    const last = b?.price ?? Number(p.avg_price);
    const qty = Number(p.qty);
    const avg = Number(p.avg_price);
    return {
      ...p, qty, avg, last,
      value: positionValue(qty, last),
      pnl: unrealizedPnl(qty, avg, last),
      brand: b,
    };
  });
  const positionsValue = enriched.reduce((s, p) => s + p.value, 0);
  const totalValue = cash + positionsValue;
  const totalPnl = enriched.reduce((s, p) => s + p.pnl, 0);

  return (
    <AppShell>
      <header className="mb-6">
        <div className="h-px hairline-gold mb-3" />
        <h1 className="text-2xl font-bold text-ink md:text-3xl">{t("portfolio")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("myPositions")} · {enriched.length}</p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <KPI label={t("totalValue")} value={formatCurrency(totalValue, false, lang)} />
        <KPI label={t("cashAvailable")} value={formatCurrency(cash, false, lang)} />
        <KPI label={t("myPositions")} value={String(enriched.length)} />
        <KPI label={t("pnl")} value={formatCurrency(totalPnl, false, lang)} tone={totalPnl >= 0 ? "bull" : "bear"} />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-ink">{t("myPositions")}</h2>
        {enriched.length === 0 ? (
          <EmptyState
            title={t("emptyPositions")}
            description={t("emptyPositionsDesc")}
            action={<Link to="/market" className="rounded-md gold-gradient px-4 py-2 text-xs font-semibold text-ink">{t("nav_market")}</Link>}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <div className="grid grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div>Symbol</div>
              <div className="text-end">{t("qty")}</div>
              <div className="text-end">{t("avgPrice")}</div>
              <div className="text-end">{t("lastPrice")}</div>
              <div className="text-end">{t("pnl")}</div>
              <div className="text-end">{t("weight")}</div>
              <div className="w-16" />
            </div>
            {enriched.map((p) => (
              <div key={p.id} className="grid grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-sm last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">{lang === "ar" ? (p.brand?.nameAr ?? p.symbol) : (p.brand?.nameEn ?? p.symbol)}</div>
                  <div className="text-[10px] uppercase text-muted-foreground">{p.symbol} · {p.asset_class}</div>
                </div>
                <div className="text-end font-mono">{p.qty}</div>
                <div className="text-end font-mono text-muted-foreground">{p.avg.toFixed(2)}</div>
                <div className="text-end font-mono">{p.last.toFixed(2)}</div>
                <div className={`text-end font-mono ${p.pnl >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{formatPct((p.last - p.avg) / (p.avg || 1))}</div>
                <div className="text-end font-mono text-muted-foreground">{weight(p.value, positionsValue)}%</div>
                <div className="text-end">
                  {p.brand && (
                    <Link to="/trade/$symbol" params={{ symbol: p.brand.slug }} className="rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]">{t("nav_trade")}</Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">{t("orderHistory")}</h2>
        {data.orders.length === 0 ? (
          <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <div className="grid grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div>Symbol</div>
              <div>{t("orderType")}</div>
              <div className="text-end">{t("qty")}</div>
              <div className="text-end">{t("price")}</div>
              <div className="text-end">Status</div>
              <div className="text-end">Time</div>
            </div>
            {data.orders.map((o) => (
              <div key={o.id} className="grid grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))] items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0">
                <div className="font-mono font-semibold text-ink">{o.symbol}</div>
                <div className={`font-mono ${o.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{o.side.toUpperCase()} · {o.type}</div>
                <div className="text-end font-mono">{Number(o.qty)}</div>
                <div className="text-end font-mono text-muted-foreground">{o.filled_price ? Number(o.filled_price).toFixed(2) : "—"}</div>
                <div className="text-end font-mono text-[var(--gold-deep)]">{o.status}</div>
                <div className="text-end font-mono text-muted-foreground">{new Date(o.created_at).toLocaleString(lang === "ar" ? "ar" : "en-US", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

function KPI({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${tone === "bull" ? "text-[var(--bull)]" : tone === "bear" ? "text-[var(--bear)]" : "text-ink"}`}>{value}</div>
    </div>
  );
}