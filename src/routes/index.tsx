import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";
import { ar } from "@/lib/i18n/ar";
import { canonicalUrl } from "@/lib/config/site";
import { formatCurrency, formatInt } from "@/lib/format";
import { ArrowRight, TrendingUp, ShieldCheck, Building2, LineChart } from "lucide-react";
import { DotDivider } from "@/components/dot-divider";
import { DotPattern } from "@/components/dot-pattern";
import { EmptyState } from "@/components/empty-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import {
  ChangeText,
  MarketDataError,
  Monogram,
  NoListingsState,
  PriceText,
  formatDateTime,
  indexBySymbol,
  instrumentName,
  loadOverviewOrNull,
  markOf,
  useMarketOverview,
} from "@/components/market-data";
import type { PublicInstrument } from "@/lib/market/public-market.functions";
import { supabase } from "@/integrations/supabase/client";
import { getMyPortfolio } from "@/lib/trading/portfolio.functions";
import { positionValue, unrealizedPnl } from "@/lib/trading/calc";
import { isWorkingOrder } from "@/components/order-outcome";
import { useAppMode } from "@/lib/nav/app-mode";
import { BrandDashboard } from "@/components/brand-dashboard";
import { PlatformDashboard } from "@/components/platform-dashboard";

export const Route = createFileRoute("/")({
  // The public board is read from the database; a failed read renders the
  // page with an explicit "market data unavailable" state, never numbers.
  loader: async () => ({ overview: await loadOverviewOrNull() }),
  head: () => ({
    meta: [
      { title: "وحدة القيمة — Value Unit | سوق خاص لوحدات العلامات التجارية" },
      {
        name: "description",
        content:
          "وحدة القيمة سوق خاص بالدعوة تُدرج فيه الشركات المعتمدة وحدات علاماتها التجارية بعد المراجعة الشرعية. · Value Unit is a private, invitation-only market for brand units.",
      },
      { property: "og:title", content: "وحدة القيمة — Value Unit" },
      {
        property: "og:description",
        content: "A private, invitation-only market where approved companies list brand units after Shariah review.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonicalUrl("/") },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/") }],
    scripts: [
      {
        type: "application/ld+json",
        // Same questions and answers as the FAQ section (Arabic, the default language).
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            { q: ar.faqQ1, a: ar.faqA1 },
            { q: ar.faqQ2, a: ar.faqA2 },
            { q: ar.faqQ3, a: ar.faqA3 },
            { q: ar.faqQ4, a: ar.faqA4 },
          ].map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: { "@type": "Answer", text: item.a },
          })),
        }),
      },
    ],
  }),

  component: Index,
});

function Index() {
  const { t, dir } = useI18n();
  const { mode } = useAppMode();
  const { overview: initialOverview } = Route.useLoaderData();
  const market = useMarketOverview(initialOverview);

  if (mode === "brand") {
    return (
      <AppShell>
        <BrandDashboard />
      </AppShell>
    );
  }
  if (mode === "platform") {
    return (
      <AppShell>
        <PlatformDashboard />
      </AppShell>
    );
  }

  const instruments = market.data?.instruments ?? [];
  const hasListings = (market.data?.summary.listedCount ?? 0) > 0;

  return (
    <AppShell>
      <AuthedSummary />
      {/* HERO */}
      <section className="relative overflow-hidden rounded-2xl border border-border/70 ivory-gradient px-6 py-16 shadow-luxury md:px-12 md:py-24">
        <DotPattern size={22} radius={1} opacity={0.05} color="var(--gold-deep)" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(700px circle at 85% 15%, oklch(0.72 0.11 82 / 0.14), transparent 60%), radial-gradient(500px circle at 8% 90%, oklch(0.38 0.11 20 / 0.06), transparent 60%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px hairline-gold"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px hairline-gold"
        />
        <div className="relative grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--gold)]/40 bg-card px-3 py-1 text-xs font-medium text-[var(--gold-deep)] shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
                {t("brands256")}
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bull)]/30 bg-[var(--bull)]/5 px-3 py-1 text-xs font-medium text-[var(--bull)] shadow-sm">
                <ShieldCheck className="h-3.5 w-3.5" />
                {t("featTitle2")}
              </div>
            </div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-ink md:text-6xl">
              {t("heroHeadline")}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              {t("heroSub")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/market"
                className="group inline-flex items-center gap-2 rounded-md gold-gradient px-5 py-3 text-sm font-semibold text-ink shadow-[0_8px_24px_oklch(0.72_0.11_82/0.28)] transition hover:brightness-105"
              >
                {t("ctaPrimary")}
                <ArrowRight
                  className={`h-4 w-4 transition group-hover:translate-x-1 ${dir === "rtl" ? "rotate-180 group-hover:-translate-x-1 group-hover:translate-x-0" : ""}`}
                />
              </Link>
              <Link
                to="/request-access"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground/90 transition hover:border-primary/60 hover:text-[var(--gold-deep)]"
              >
                {t("ctaSecondary")}
              </Link>
            </div>

            <MarketSummaryStrip loading={market.isLoading} summary={market.data?.summary ?? null} />
          </div>

          <MarketBoard
            loading={market.isLoading}
            failed={!market.data && !market.isLoading}
            error={market.error}
            onRetry={() => market.refetch()}
            instruments={instruments}
          />
        </div>
      </section>

      {/* FEATURES */}
      <DotDivider className="mt-14" />
      <section className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Feature icon={LineChart} title={t("featTitle1")} desc={t("featDesc1")} />
        <Feature icon={ShieldCheck} title={t("featTitle2")} desc={t("featDesc2")} />
        <Feature icon={Building2} title={t("featTitle3")} desc={t("featDesc3")} />
        <Feature icon={TrendingUp} title={t("featTitle4")} desc={t("featDesc4")} />
      </section>

      {/* MARKET MOVERS: only instruments with a real 24h change */}
      {hasListings && <Movers instruments={instruments} />}

      {/* HOW IT WORKS */}
      <DotDivider className="mt-16" />
      <section aria-labelledby="how-it-works" className="mt-10">
        <h2 id="how-it-works" className="text-2xl font-bold tracking-tight text-ink md:text-3xl">
          {t("howItWorksTitle")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t("howItWorksSub")}
        </p>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { title: t("hiw1Title"), desc: t("hiw1Desc") },
            { title: t("hiw2Title"), desc: t("hiw2Desc") },
            { title: t("hiw3Title"), desc: t("hiw3Desc") },
          ].map((step) => (
            <li
              key={step.title}
              className="rounded-xl border border-border/70 bg-card/70 p-5 shadow-sm"
            >
              <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* PRICING */}
      <section aria-labelledby="plans" className="mt-16">
        <h2 id="plans" className="text-2xl font-bold tracking-tight text-ink md:text-3xl">
          {t("plansTitle")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t("plansSub")}
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            {
              name: t("planStarterName"),
              price: t("planStarterPrice"),
              features: [t("planStarterF1"), t("planStarterF2"), t("planStarterF3")],
              featured: false,
            },
            {
              name: t("planGrowthName"),
              price: t("planGrowthPrice"),
              features: [t("planGrowthF1"), t("planGrowthF2"), t("planGrowthF3")],
              featured: true,
            },
            {
              name: t("planEnterpriseName"),
              price: t("planEnterprisePrice"),
              features: [t("planEnterpriseF1"), t("planEnterpriseF2"), t("planEnterpriseF3")],
              featured: false,
            },
          ].map((plan) => (
            <div
              key={plan.name}
              className={`flex flex-col rounded-xl border bg-card/70 p-5 shadow-sm ${
                plan.featured ? "border-[var(--gold)]/50 shadow-luxury" : "border-border/70"
              }`}
            >
              <h3 className="text-sm font-semibold text-foreground">{plan.name}</h3>
              <div className="mt-2 font-mono text-xl font-bold text-ink">{plan.price}</div>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-muted-foreground">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--gold-deep)]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/request-access"
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground/90 transition hover:border-primary/60 hover:text-[var(--gold-deep)]"
              >
                {t("plansCta")}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq" className="mt-16 mb-4">
        <h2 id="faq" className="text-2xl font-bold tracking-tight text-ink md:text-3xl">
          {t("faqTitle")}
        </h2>
        <dl className="mt-6 grid gap-4 md:grid-cols-2">
          {[
            { q: t("faqQ1"), a: t("faqA1") },
            { q: t("faqQ2"), a: t("faqA2") },
            { q: t("faqQ3"), a: t("faqA3") },
            { q: t("faqQ4"), a: t("faqA4") },
          ].map((item) => (
            <div
              key={item.q}
              className="rounded-xl border border-border/70 bg-card/70 p-5 shadow-sm"
            >
              <dt className="text-sm font-semibold text-foreground">{item.q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </AppShell>
  );
}


function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-foreground md:text-xl">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Real market totals from the database, or an honest state when there are none. */
function MarketSummaryStrip({
  loading,
  summary,
}: {
  loading: boolean;
  summary: { listedCount: number; trades24h: number; volume24hValue: number; lastTradeAt: string | null } | null;
}) {
  const { t, lang } = useI18n();
  if (loading) {
    return (
      <div className="mt-10 border-t border-border pt-6">
        <LuxurySkeleton lines={2} className="max-w-sm" />
      </div>
    );
  }
  // A failed read is reported once, by the board beside it.
  if (!summary) return null;
  // No listing yet: the board beside it shows the "first listings" state.
  if (summary.listedCount === 0) return null;
  return (
    <div className="mt-10 border-t border-border pt-6">
      <div className="grid grid-cols-3 gap-4 text-start">
        <Stat label={t("e2_listedInstruments")} value={formatInt(summary.listedCount)} />
        <Stat label={t("e2_trades24h")} value={formatInt(summary.trades24h)} />
        <Stat label={t("e2_value24h")} value={formatCurrency(summary.volume24hValue, true, lang)} />
      </div>
      <div className="mt-3 text-[11px] text-muted-foreground">
        {summary.lastTradeAt
          ? `${t("e2_lastTradeAt")} ${formatDateTime(summary.lastTradeAt, lang)} (${t("e2_riyadhTime")})`
          : t("e2_noTradesYetMarket")}
      </div>
    </div>
  );
}

function AuthedSummary() {
  const { t, lang } = useI18n();
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setAuthed(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  const fetchPortfolio = useServerFn(getMyPortfolio);
  const q = useQuery({
    queryKey: ["portfolio-summary"],
    queryFn: () => fetchPortfolio(),
    enabled: authed === true,
    staleTime: 30_000,
  });
  const market = useMarketOverview(undefined, { enabled: authed === true });
  if (!authed || !q.data || market.isLoading) return null;
  const bySymbol = indexBySymbol(market.data?.instruments);
  const cash = Number(q.data.portfolio?.cash_balance ?? 0);
  // A position is valued at the last trade (or the listing reference
  // price); one with no market price (e.g. delisted) is carried at cost
  // and has no unrealized P/L.
  const valued = q.data.positions.map((p) => {
    const inst = bySymbol.get(p.symbol.toUpperCase());
    const qty = Number(p.qty);
    const avg = Number(p.avg_price);
    const m = inst ? markOf(inst) : null;
    const mark = m ? m.price : avg;
    return {
      value: positionValue(qty, mark),
      pnl: inst ? unrealizedPnl(qty, avg, mark) : 0,
      source: !m ? ("cost" as const) : m.isReference ? ("reference" as const) : ("trade" as const),
    };
  });
  const positionsValue = valued.reduce((s, v) => s + v.value, 0);
  const pnl = valued.reduce((s, v) => s + v.pnl, 0);
  const total = cash + positionsValue;
  const openOrders = q.data.orders.filter((o) => isWorkingOrder(o.status)).length;
  // Market data could not be read: holdings have no market price, so the
  // total and the P/L are not shown as numbers (never valued at cost as if
  // it were a market price).
  const marketDown = market.isError && !market.data && q.data.positions.length > 0;
  const losingPositions = marketDown ? 0 : valued.filter((v) => v.pnl < 0).length;
  const attention = [
    openOrders > 0
      ? {
          key: "orders",
          label: t("attnOpenOrders"),
          count: openOrders,
          tab: "orders" as const,
        }
      : null,
    losingPositions > 0
      ? {
          key: "losing",
          label: t("attnLosingPositions"),
          count: losingPositions,
          tab: "positions" as const,
        }
      : null,
  ].filter(Boolean) as { key: string; label: string; count: number; tab: "orders" | "positions" }[];
  return (
    <section className="mb-6 rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {t("acct_snapshot")}
          </div>
          <div className="mt-1 text-sm font-semibold text-ink">{t("acct_snapshotSub")}</div>
        </div>
        <Link
          to="/portfolio"
          search={{
            tab: "positions",
            q: "",
            status: "all",
            side: "all",
            sortBy: "symbol",
            sortDir: "asc",
            page: 1,
            pageSize: 25,
          }}
          className="text-xs font-semibold text-[var(--gold-deep)] hover:underline"
        >
          {t("portfolio")} →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniKPI label={t("totalValue")} value={marketDown ? "—" : formatCurrency(total, false, lang)} />
        <MiniKPI label={t("cashAvailable")} value={formatCurrency(cash, false, lang)} />
        <MiniKPI label={t("myPositions")} value={String(q.data.positions.length)} />
        <MiniKPI
          label={t("pnl")}
          value={marketDown ? "—" : formatCurrency(pnl, false, lang)}
          tone={marketDown ? undefined : pnl >= 0 ? "bull" : "bear"}
        />
      </div>
      {marketDown ? (
        <div className="mt-3">
          <MarketDataError error={market.error} onRetry={() => market.refetch()} />
        </div>
      ) : (
        (valued.some((v) => v.source === "reference") || valued.some((v) => v.source === "cost")) && (
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {[
              valued.some((v) => v.source === "reference") ? t("e2_valuationReferenceNote") : "",
              valued.some((v) => v.source === "cost") ? t("e2_valuationCostNote") : "",
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
        )
      )}
      {/* Decision-oriented: what needs the user to act, not just numbers. */}
      <div className="mt-4 rounded-xl border border-border/60 bg-background/60 p-3">
        <div className="mb-2 text-label text-muted-foreground">{t("needsAttention")}</div>
        {attention.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("allClear")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {attention.map((a) => (
              <li key={a.key} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-caption text-ink">
                  <span className="num me-2 text-[var(--gold-deep)]">{a.count}</span>
                  {a.label}
                </span>
                <Link
                  to="/portfolio"
                  search={{
                    tab: a.tab,
                    q: "",
                    status: "all",
                    side: "all",
                    sortBy: "symbol",
                    sortDir: "asc",
                    page: 1,
                    pageSize: 25,
                  }}
                  className="shrink-0 text-caption font-semibold text-[var(--gold-deep)] hover:underline"
                >
                  {t("reviewNow")} →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function MiniKPI({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`mt-1 font-mono text-base font-semibold ${
          tone === "bull"
            ? "text-[var(--bull)]"
            : tone === "bear"
              ? "text-[var(--bear)]"
              : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <div className="group rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/50 hover:shadow-luxury">
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[var(--gold)]/10 text-[var(--gold-deep)]">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

/** The public board: published instruments from the database, most traded first. */
function MarketBoard({
  loading,
  failed,
  error,
  onRetry,
  instruments,
}: {
  loading: boolean;
  failed: boolean;
  error: unknown;
  onRetry: () => void;
  instruments: PublicInstrument[];
}) {
  const { t, lang } = useI18n();
  const items = [...instruments]
    .sort((a, b) => b.volume24hValue - a.volume24hValue || b.trades24h - a.trades24h || a.symbol.localeCompare(b.symbol))
    .slice(0, 8);
  return (
    <div className="relative rounded-xl border border-border bg-card p-4 shadow-luxury">
      <div className="mb-3 flex items-center justify-between px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{t("e2_boardTitle")}</span>
        {items.length > 0 && (
          <Link to="/market" className="normal-case tracking-normal text-[var(--gold-deep)] hover:underline">
            {t("exploreMarket")} →
          </Link>
        )}
      </div>
      {loading ? (
        <LuxurySkeleton lines={8} className="px-1 py-2" />
      ) : failed ? (
        <MarketDataError error={error} onRetry={onRetry} />
      ) : items.length === 0 ? (
        <NoListingsState compact />
      ) : (
        <div className="divide-y divide-border">
          {items.map((b) => (
            <Link
              to="/market/$slug"
              params={{ slug: b.slug }}
              key={b.symbol}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-2 py-2.5 text-sm transition hover:bg-secondary/60"
            >
              <Monogram symbol={b.symbol} className="h-8 w-8 text-[10px]" />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-ink">{instrumentName(b, lang)}</div>
                <div className="text-[10px] uppercase text-muted-foreground">{b.symbol}</div>
              </div>
              <PriceText mark={markOf(b)} className="text-xs text-foreground" />
              <ChangeText pct={b.change24hPct} className="text-xs" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Top gainers / losers over 24h: only instruments that actually traded. */
function Movers({ instruments }: { instruments: PublicInstrument[] }) {
  const { t } = useI18n();
  const moved = instruments.filter((i) => i.change24hPct != null);
  const gainers = moved
    .filter((i) => (i.change24hPct ?? 0) > 0)
    .sort((a, b) => (b.change24hPct ?? 0) - (a.change24hPct ?? 0))
    .slice(0, 6);
  const losers = moved
    .filter((i) => (i.change24hPct ?? 0) < 0)
    .sort((a, b) => (a.change24hPct ?? 0) - (b.change24hPct ?? 0))
    .slice(0, 6);
  if (gainers.length === 0 && losers.length === 0) {
    return (
      <section className="mt-14">
        <EmptyState
          icon={<TrendingUp className="h-5 w-5" />}
          title={t("e2_noMoversTitle")}
          description={t("e2_noMoversDesc")}
          action={
            <Link to="/market" className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-ink hover:border-[var(--gold-deep)]">
              {t("exploreMarket")}
            </Link>
          }
        />
      </section>
    );
  }
  return (
    <section className="mt-14 grid gap-4 lg:grid-cols-2">
      <MoverCard title={t("topGainers")} rows={gainers} />
      <MoverCard title={t("topLosers")} rows={losers} />
    </section>
  );
}

function MoverCard({ title, rows }: { title: string; rows: PublicInstrument[] }) {
  const { lang, t } = useI18n();
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <Link to="/market" className="text-xs text-[var(--gold-deep)] hover:underline">
          {t("exploreMarket")} →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{t("e2_noMoversSide")}</p>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((b) => (
            <Link
              key={b.symbol}
              to="/market/$slug"
              params={{ slug: b.slug }}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 text-sm transition hover:opacity-80"
            >
              <Monogram symbol={b.symbol} className="h-8 w-8 text-[10px]" />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-foreground">{instrumentName(b, lang)}</div>
                <div className="text-[10px] text-muted-foreground">{b.symbol}</div>
              </div>
              <PriceText mark={markOf(b)} className="text-xs text-foreground" />
              <ChangeText pct={b.change24hPct} className="text-xs" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
