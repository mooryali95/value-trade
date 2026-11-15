import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Buildings,
  ChartLineUp,
  CheckCircle,
  Circle,
  ClipboardText,
  EnvelopeSimple,
  Scales,
  ShieldCheck,
  SignIn,
  Storefront,
  TrendUp,
  UserCircleGear,
  UserPlus,
  Vault,
} from "@phosphor-icons/react";
import { AppShell, useSessionUserId } from "@/components/app-shell";
import { useI18n, type Key } from "@/lib/i18n";
import { ar } from "@/lib/i18n/ar";
import { canonicalUrl } from "@/lib/config/site";
import { formatCurrency } from "@/lib/format";
import { DotDivider } from "@/components/dot-divider";
import { DotPattern } from "@/components/dot-pattern";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { Num } from "@/components/num";
import {
  ChangeText,
  MarketDataError,
  Monogram,
  NoListingsState,
  PriceText,
  ShariahPill,
  formatDateTime,
  instrumentName,
  loadOverviewOrNull,
  markOf,
  useMarketOverview,
} from "@/components/market-data";
import type { MarketOverview, PublicInstrument } from "@/lib/market/public-market.functions";
import { getMyPortfolio } from "@/lib/trading/portfolio.functions";
import { getMyAccountStatus, type AccountStatus } from "@/lib/account/account-status.functions";
import { fill } from "@/lib/account/fill";
import { isWorkingOrder } from "@/components/order-outcome";
import { useAppMode } from "@/lib/nav/app-mode";
import { BrandDashboard } from "@/components/brand-dashboard";
import { PlatformDashboard } from "@/components/platform-dashboard";
import { MotionReveal } from "@/components/motion-reveal";

export const Route = createFileRoute("/")({
  // The public board is read from the database; a failed read renders the
  // page with an explicit "market data unavailable" state, never numbers.
  loader: async () => ({ overview: await loadOverviewOrNull() }),
  head: () => ({
    meta: [
      { title: "وحدة القيمة — Value Unit | سوق خاصة للأدوات المالية" },
      {
        name: "description",
        content:
          "وحدة القيمة سوق خاصة للأسهم والصناديق والصكوك ووحدات العلامات التجارية، مع مراجعة واعتماد للإدراج. · Value Unit is a private market for financial instruments.",
      },
      { property: "og:title", content: "وحدة القيمة — Value Unit" },
      {
        property: "og:description",
        content: "A private market for stocks, funds, sukuk and brand units, with reviewed and approved listings.",
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

type MarketQuery = ReturnType<typeof useMarketOverview>;

function Index() {
  const { mode } = useAppMode();
  const userId = useSessionUserId();
  const { overview: initialOverview } = Route.useLoaderData();
  const market = useMarketOverview(initialOverview);

  if (userId && mode === "brand") {
    return (
      <AppShell>
        <BrandDashboard />
      </AppShell>
    );
  }
  if (userId && mode === "platform") {
    return (
      <AppShell>
        <PlatformDashboard />
      </AppShell>
    );
  }
  if (userId) {
    // The home explains the account's status in full, so the shell's
    // banner is not repeated here.
    return (
      <AppShell accountBanner={false}>
        <AccountHome userId={userId} />
        <LiveMarket market={market} />
      </AppShell>
    );
  }
  return <Landing market={market} />;
}

/* ------------------------------------------------------------------------ */
/* Shared bits                                                               */
/* ------------------------------------------------------------------------ */

function Arrow({ className }: { className?: string }) {
  const { dir } = useI18n();
  const Icon = dir === "rtl" ? ArrowLeft : ArrowRight;
  return <Icon size={16} weight="bold" className={className} aria-hidden />;
}

const btnPrimary =
  "group inline-flex min-h-11 items-center justify-center gap-2 rounded-md gold-gradient px-5 text-sm font-semibold text-ink shadow-gold transition hover:brightness-105";
const btnSecondary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--ink)]/15 bg-card px-5 text-sm font-semibold text-ink transition hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)]";
const btnGhost =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold text-[var(--gold-ink)] underline-offset-4 transition hover:underline";

function SectionHeading({ id, title, sub }: { id: string; title: string; sub?: string }) {
  return (
    <MotionReveal className="max-w-2xl">
      <h2 id={id} className="text-2xl font-bold text-ink md:text-3xl">
        {title}
      </h2>
      {sub && <p className="mt-2 text-sm leading-relaxed text-ink-soft md:text-[15px]">{sub}</p>}
    </MotionReveal>
  );
}

/* ------------------------------------------------------------------------ */
/* Visitor landing                                                           */
/* ------------------------------------------------------------------------ */

function Landing({ market }: { market: MarketQuery }) {
  const { t } = useI18n();
  const instruments = market.data?.instruments ?? [];
  const hasListings = (market.data?.summary.listedCount ?? 0) > 0;

  return (
    <AppShell>
      {/* HERO */}
      <section className="relative overflow-hidden rounded-2xl border border-border/70 ivory-gradient px-5 py-12 shadow-luxury sm:px-8 md:px-12 md:py-20">
        <DotPattern size={22} radius={1} opacity={0.05} color="var(--gold-deep)" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(700px circle at 85% 15%, oklch(0.72 0.11 82 / 0.14), transparent 60%), radial-gradient(500px circle at 8% 90%, oklch(0.38 0.11 20 / 0.06), transparent 60%)",
          }}
        />
        <div aria-hidden className="institutional-rule pointer-events-none absolute inset-x-0 top-0 h-px hairline-gold" />
        <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center">
          <MotionReveal className="institutional-actions min-w-0">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--gold)]/40 bg-card px-3 py-1 text-xs font-medium text-[var(--gold-ink)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" aria-hidden />
                {t("brands256")}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bull)]/30 bg-[var(--bull)]/5 px-3 py-1 text-xs font-medium text-[var(--bull)]">
                <ShieldCheck size={14} weight="duotone" aria-hidden />
                {t("featTitle2")}
              </span>
            </div>
            <h1 className="font-display text-4xl font-bold leading-tight text-ink md:text-5xl">{t("heroHeadline")}</h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-soft md:text-lg">{t("heroSub")}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link to="/market" className={btnPrimary}>
                {t("ctaPrimary")}
                <Arrow className="transition group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5" />
              </Link>
              <Link to="/request-access" search={{ kind: "invest" }} className={btnSecondary}>
                <UserPlus size={17} weight="duotone" aria-hidden />
                {t("u_ctaInvestor")}
              </Link>
            </div>
            <p className="mt-3 max-w-xl text-caption text-ink-soft">{t("ux_browseAccess")}</p>
            <div className="mt-3">
              <Link to="/auth" className={btnGhost}>
                <SignIn size={16} weight="bold" aria-hidden />
                {t("u_memberSignIn")}
              </Link>
            </div>

            <MarketSummaryStrip loading={market.isLoading} summary={market.data?.summary ?? null} />
          </MotionReveal>

          <MotionReveal className="min-w-0">
          <MarketBoard
            loading={market.isLoading}
            failed={!market.data && !market.isLoading}
            error={market.error}
            onRetry={() => market.refetch()}
            instruments={instruments}
          />
          </MotionReveal>
        </div>
      </section>

      {/* AUDIENCES */}
      <section aria-labelledby="audiences" className="mt-16">
        <SectionHeading id="audiences" title={t("u_audTitle")} sub={t("u_audSub")} />
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <AudienceCard
            icon={<Buildings size={22} weight="duotone" />}
            title={t("u_audCompaniesTitle")}
            desc={t("u_audCompaniesDesc")}
            action={
              <Link to="/request-access" search={{ kind: "new" }} className={btnSecondary}>
                {t("u_ctaCompany")}
              </Link>
            }
          />
          <AudienceCard
            featured
            icon={<ChartLineUp size={22} weight="duotone" />}
            title={t("u_audInvestorsTitle")}
            desc={t("u_audInvestorsDesc")}
            action={
              <Link to="/request-access" search={{ kind: "invest" }} className={btnPrimary}>
                {t("u_ctaInvestor")}
              </Link>
            }
          />
          <AudienceCard
            icon={<UserCircleGear size={22} weight="duotone" />}
            title={t("u_audMembersTitle")}
            desc={t("u_audMembersDesc")}
            action={
              <Link to="/auth" className={btnSecondary}>
                {t("u_audMembersCta")}
              </Link>
            }
          />
        </div>
      </section>

      {/* HOW IT WORKS: the two tracks */}
      <DotDivider className="mt-16" />
      <section aria-labelledby="how-it-works" className="mt-10">
        <SectionHeading id="how-it-works" title={t("howItWorksTitle")} sub={t("u_howSub")} />
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <TrackCard
            icon={<Buildings size={18} weight="duotone" />}
            title={t("u_trackCompanies")}
            steps={[
              ["u_co1T", "u_co1D"],
              ["u_co2T", "u_co2D"],
              ["u_co3T", "u_co3D"],
              ["u_co4T", "u_co4D"],
            ]}
          />
          <TrackCard
            icon={<ChartLineUp size={18} weight="duotone" />}
            title={t("u_trackInvestors")}
            steps={[
              ["u_in1T", "u_in1D"],
              ["u_in2T", "u_in2D"],
              ["u_in3T", "u_in3D"],
              ["u_in4T", "u_in4D"],
            ]}
          />
        </div>
      </section>

      {/* SHARIAH REVIEW */}
      <section aria-labelledby="shariah-review" className="mt-16 rounded-2xl border border-border/70 bg-card p-5 shadow-card sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
          <div>
            <div className="mb-3 inline-grid h-11 w-11 place-items-center rounded-lg bg-[var(--bull)]/10 text-[var(--bull)]">
              <Scales size={22} weight="duotone" aria-hidden />
            </div>
            <SectionHeading id="shariah-review" title={t("u_shTitle")} sub={t("u_shSub")} />
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{t("e2_shariahNote")}</p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
              <Link to="/shariah" className={btnGhost}>
                {t("u_shLink")}
                <Arrow />
              </Link>
              <Link to="/legal/shariah-disclosures" className={btnGhost}>
                {t("legalShariahDisclosures")}
              </Link>
            </div>
          </div>
          <ul className="divide-y divide-border/70 rounded-xl border border-border/70 bg-background/60">
            {(
              [
                ["halal", "u_shHalalD"],
                ["reviewing", "u_shReviewingD"],
                ["non_halal", "u_shNonHalalD"],
              ] as const
            ).map(([status, desc]) => (
              <li key={status} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
                <span className="shrink-0 sm:w-40">
                  <ShariahPill status={status} />
                </span>
                <span className="text-sm leading-relaxed text-ink-soft">{t(desc)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* MARKET MOVERS: only instruments with a real 24h change */}
      {hasListings && <Movers instruments={instruments} />}

      {/* PRINCIPLES */}
      <DotDivider className="mt-16" />
      <section className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Feature icon={<ChartLineUp size={20} weight="duotone" />} title={t("featTitle1")} desc={t("featDesc1")} />
        <Feature icon={<ShieldCheck size={20} weight="duotone" />} title={t("featTitle2")} desc={t("featDesc2")} />
        <Feature icon={<Buildings size={20} weight="duotone" />} title={t("featTitle3")} desc={t("featDesc3")} />
        <Feature icon={<TrendUp size={20} weight="duotone" />} title={t("featTitle4")} desc={t("featDesc4")} />
      </section>

      {/* PRICING */}
      <section aria-labelledby="plans" className="mt-16">
        <SectionHeading id="plans" title={t("plansTitle")} sub={t("plansSub")} />
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
              className={`flex flex-col rounded-xl border bg-card p-6 ${
                plan.featured ? "border-[var(--gold)]/60 shadow-luxury" : "border-border/70 shadow-card"
              }`}
            >
              <h3 className="text-base font-bold text-ink">{plan.name}</h3>
              <div className="mt-1 text-lg font-semibold text-[var(--gold-ink)]">{plan.price}</div>
              <ul className="mt-4 flex-1 space-y-2.5 text-sm text-ink-soft">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle size={16} weight="duotone" className="mt-0.5 shrink-0 text-[var(--gold-deep)]" aria-hidden />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/request-access" search={{ kind: "new" }} className={`mt-6 ${btnSecondary}`}>
                {t("plansCta")}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq" className="mt-16">
        <SectionHeading id="faq" title={t("faqTitle")} />
        <dl className="mt-6 grid gap-4 md:grid-cols-2">
          {[
            { q: t("faqQ1"), a: t("faqA1") },
            { q: t("faqQ2"), a: t("faqA2") },
            { q: t("faqQ3"), a: t("faqA3") },
            { q: t("faqQ4"), a: t("faqA4") },
          ].map((item) => (
            <div key={item.q} className="rounded-xl border border-border/70 bg-card p-5">
              <dt className="text-[15px] font-semibold text-ink">{item.q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-ink-soft">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* CLOSING CTA */}
      <section className="relative mt-16 overflow-hidden rounded-2xl ink-gradient px-5 py-10 text-ivory sm:px-10">
        <DotPattern size={22} radius={1} opacity={0.08} color="var(--gold)" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <h2 className="text-2xl font-bold text-ivory md:text-3xl">{t("u_ctaBandTitle")}</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ivory/80">{t("u_ctaBandDesc")}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link to="/request-access" search={{ kind: "invest" }} className={btnPrimary}>
              {t("u_ctaInvestor")}
            </Link>
            <Link
              to="/request-access"
              search={{ kind: "new" }}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-ivory/30 px-5 text-sm font-semibold text-ivory transition hover:border-[var(--gold)] hover:text-[var(--gold)]"
            >
              {t("u_ctaCompany")}
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function AudienceCard({
  icon,
  title,
  desc,
  action,
  featured,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  action: ReactNode;
  featured?: boolean;
}) {
  return (
    <MotionReveal
      className={`institutional-card institutional-actions flex flex-col rounded-xl border bg-card p-6 ${
        featured ? "border-[var(--gold)]/60 shadow-luxury" : "border-border/70 shadow-card"
      }`}
    >
      <div className="mb-4 inline-grid h-11 w-11 place-items-center rounded-lg bg-[var(--gold-soft)] text-[var(--gold-ink)]" aria-hidden>
        {icon}
      </div>
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-soft">{desc}</p>
      <div className="mt-5 [&>a]:w-full">{action}</div>
    </MotionReveal>
  );
}

function TrackCard({ icon, title, steps }: { icon: ReactNode; title: string; steps: Array<[Key, Key]> }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-border/70 bg-card p-5 shadow-card sm:p-6">
      <div className="mb-5 flex items-center gap-2 text-[var(--gold-ink)]">
        <span aria-hidden>{icon}</span>
        <h3 className="text-base font-bold text-ink">{title}</h3>
      </div>
      <ol className="relative space-y-5">
        {steps.map(([title, desc], i) => (
          <li key={title} className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-4">
            {i < steps.length - 1 && (
              <span aria-hidden className="absolute start-[15px] top-9 h-[calc(100%-12px)] w-px bg-border" />
            )}
            <span
              aria-hidden
              className="relative grid h-8 w-8 place-items-center rounded-full border border-[var(--gold)]/50 bg-[var(--gold-soft)] text-sm font-bold text-[var(--gold-ink)]"
            >
              <span dir="ltr">{i + 1}</span>
            </span>
            <div className="pt-1">
              <div className="text-[15px] font-semibold text-ink">{t(title)}</div>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{t(desc)}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-5">
      <div className="mb-3 inline-grid h-10 w-10 place-items-center rounded-md bg-[var(--gold)]/10 text-[var(--gold-deep)]" aria-hidden>
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{desc}</p>
    </div>
  );
}

/** Real market totals from the database, or nothing when there are none. */
function MarketSummaryStrip({
  loading,
  summary,
  className = "mt-10 border-t border-border pt-6",
}: {
  loading: boolean;
  summary: MarketOverview["summary"] | null;
  className?: string;
}) {
  const { t, lang } = useI18n();
  if (loading) {
    return (
      <div className={className}>
        <LuxurySkeleton lines={2} className="max-w-sm" />
      </div>
    );
  }
  // A failed read is reported once, by the board beside it; with no listing
  // the board shows the "first listings" state.
  if (!summary || summary.listedCount === 0) return null;
  return (
    <div className={className}>
      <dl className="grid grid-cols-3 gap-4">
        <Stat label={t("e2_listedInstruments")} value={<Num value={summary.listedCount} kind="qty" />} />
        <Stat label={t("e2_trades24h")} value={<Num value={summary.trades24h} kind="qty" />} />
        <Stat
          label={t("e2_value24h")}
          value={
            <span dir="ltr" className="tabular-nums" style={{ unicodeBidi: "isolate" }}>
              {formatCurrency(summary.volume24hValue, true)}
            </span>
          }
        />
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        {summary.lastTradeAt
          ? `${t("e2_lastTradeAt")} ${formatDateTime(summary.lastTradeAt, lang)} (${t("e2_riyadhTime")})`
          : t("e2_noTradesYetMarket")}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-semibold text-ink md:text-xl">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Signed-in home                                                            */
/* ------------------------------------------------------------------------ */

type InvestorState = "hold" | "notActivated" | "awaitingFunding" | "active" | "staff";

function AccountHome({ userId }: { userId: string }) {
  const { t } = useI18n();
  const statusFn = useServerFn(getMyAccountStatus);
  const portfolioFn = useServerFn(getMyPortfolio);
  // Same key as the shell's AccountStatusBanner, so the two share one read.
  const status = useQuery({
    queryKey: ["account-status", userId],
    queryFn: () => statusFn(),
    staleTime: 60_000,
    retry: false,
  });
  const s = status.data;
  const needsPortfolio = !!s && (s.isTrader || s.onHold || s.cashBalance > 0);
  const portfolio = useQuery({
    queryKey: ["home-portfolio", userId],
    queryFn: () => portfolioFn(),
    enabled: needsPortfolio,
    staleTime: 30_000,
  });

  if (status.isLoading) {
    return (
      <section className="mb-10 rounded-2xl border border-border/70 bg-card p-6">
        <LuxurySkeleton lines={4} />
      </section>
    );
  }
  if (!s) {
    return (
      <div className="mb-10">
        <ErrorState reset={() => status.refetch()} />
      </div>
    );
  }

  const staff = s.isPlatformAdmin || s.isShariahReviewer || s.companies.length > 0;
  const hasHoldings = (portfolio.data?.positions.length ?? 0) > 0;
  const state: InvestorState = s.onHold
    ? "hold"
    : !s.isTrader
      ? staff && !s.pendingAccessRequest
        ? "staff"
        : "notActivated"
      : portfolio.data && s.cashBalance === 0 && !hasHoldings
        ? "awaitingFunding"
        : "active";

  const head: Record<InvestorState, { title: Key; sub: Key }> = {
    hold: { title: "u_homeHoldTitle", sub: "u_homeHoldSub" },
    notActivated: { title: "u_homeNotActivatedTitle", sub: "u_homeNotActivatedSub" },
    awaitingFunding: { title: "u_homeFundingTitle", sub: "u_homeFundingSub" },
    active: { title: "u_homeActiveTitle", sub: "u_homeActiveSub" },
    staff: { title: "u_homeStaffTitle", sub: "u_homeStaffSub" },
  };
  const tone =
    state === "hold"
      ? "border-[var(--bear)]/30"
      : state === "active" || state === "staff"
        ? "border-border/70"
        : "border-[var(--gold)]/40";

  return (
    <div className="mb-12 space-y-6">
      <section className={`relative overflow-hidden rounded-2xl border ${tone} ivory-gradient p-5 shadow-card sm:p-8`}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px hairline-gold" />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="min-w-0">
            <div className="text-xs font-semibold leading-5 text-[var(--gold-ink)]">{t("u_homeEyebrow")}</div>
            {/* Room above the title for Arabic diacritics (tanween). */}
            <h1 className="mt-2 text-title leading-snug text-ink">{t(head[state].title)}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{t(head[state].sub)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(state === "active" || state === "hold") && (
              <Link to={"/portfolio" as never} className={btnPrimary}>
                <Vault size={17} weight="duotone" aria-hidden />
                {t("u_viewPortfolio")}
              </Link>
            )}
            <Link to="/market" className={state === "active" || state === "hold" ? btnSecondary : btnPrimary}>
              <Storefront size={17} weight="duotone" aria-hidden />
              {t("u_browseMarket")}
            </Link>
          </div>
        </div>

        {(state === "active" || state === "hold") && (
          <div className="mt-6">
            <PortfolioKpis q={portfolio} onHold={state === "hold"} />
          </div>
        )}
      </section>

      {(state === "notActivated" || state === "awaitingFunding") && <OnboardingSteps s={s} state={state} />}

      <Shortcuts s={s} />
    </div>
  );
}

type PortfolioData = Awaited<ReturnType<typeof getMyPortfolio>>;

function PortfolioKpis({ q, onHold }: { q: UseQueryResult<PortfolioData>; onHold?: boolean }) {
  const { t } = useI18n();
  if (q.isLoading) return <LuxurySkeleton lines={3} />;
  if (q.isError || !q.data) return <MarketDataError error={q.error} onRetry={() => q.refetch()} />;
  const { summary, positions, orders } = q.data;
  const openOrders = orders.filter((o) => isWorkingOrder(o.status)).length;
  const pnlTone =
    Math.round(summary.unrealizedPnl * 100) > 0
      ? "text-[var(--bull)]"
      : Math.round(summary.unrealizedPnl * 100) < 0
        ? "text-[var(--bear)]"
        : "text-ink";
  const usesReference = positions.some((p) => p.mark_source === "reference");
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t("totalValue")} value={<Num value={summary.totalValue} kind="currency" />} strong />
        <Kpi
          label={t("u_kpiCash")}
          value={<Num value={summary.cash} kind="currency" />}
          hint={
            summary.reserved > 0
              ? fill(t("u_kpiReserved"), { amount: <Num value={summary.reserved} kind="currency" /> })
              : undefined
          }
        />
        {/* On hold no order can be placed, so buying power would mislead. */}
        {!onHold && <Kpi label={t("m_buyingPower")} value={<Num value={summary.buyingPower} kind="currency" />} />}
        <Kpi label={t("u_kpiHoldings")} value={<Num value={summary.marketValue} kind="currency" />} />
        <Kpi
          label={t("u_kpiUnrealized")}
          value={
            <span className={pnlTone}>
              <Num value={summary.unrealizedPnl} kind="currency" signed />
              {summary.unrealizedPct != null && (
                <span className="ms-1.5 inline-block whitespace-nowrap text-xs font-medium">
                  (<Num value={summary.unrealizedPct} kind="pct" signed />)
                </span>
              )}
            </span>
          }
        />
        <Kpi label={t("u_kpiOpenOrders")} value={<Num value={openOrders} kind="qty" />} />
      </dl>
      {(summary.unpricedCount > 0 || usesReference) && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {summary.unpricedCount > 0 && fill(t("u_unpricedNote"), { n: <Num value={summary.unpricedCount} kind="qty" /> })}
          {summary.unpricedCount > 0 && usesReference ? " " : ""}
          {usesReference && t("e2_valuationReferenceNote")}
        </p>
      )}
    </>
  );
}

function Kpi({ label, value, hint, strong }: { label: string; value: ReactNode; hint?: ReactNode; strong?: boolean }) {
  return (
    <div className={`min-w-0 rounded-xl border p-3.5 ${strong ? "border-[var(--gold)]/40 bg-card" : "border-border/70 bg-card/80"}`}>
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      {/* Money values and their hints wrap instead of being cut with an ellipsis. */}
      <dd className={`mt-1 break-words font-mono font-semibold text-ink ${strong ? "text-lg" : "text-base"}`}>{value}</dd>
      {hint && <dd className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">{hint}</dd>}
    </div>
  );
}

type Step = { title: Key; desc?: Key; done: boolean; action?: ReactNode };

function OnboardingSteps({ s, state }: { s: AccountStatus; state: "notActivated" | "awaitingFunding" }) {
  const { t } = useI18n();
  const req = s.pendingAccessRequest;
  const requestDone = req?.status === "approved" || state === "awaitingFunding";
  const steps: Step[] = [
    { title: "u_stepEmail", desc: s.emailConfirmed ? undefined : "u_stepEmailTodo", done: s.emailConfirmed },
    {
      title: "u_stepRequest",
      desc: requestDone ? "u_stepRequestApproved" : req?.status === "pending" ? "u_stepRequestPending" : "u_stepRequestNone",
      done: requestDone,
      action:
        !requestDone && !req ? (
          <Link to="/request-access" search={{ kind: "invest" }} className="text-sm font-semibold text-[var(--gold-ink)] underline underline-offset-4">
            {t("u_ctaInvestor")}
          </Link>
        ) : undefined,
    },
    { title: "u_stepActivation", desc: "u_stepActivationDesc", done: s.isTrader },
    { title: "u_stepFunding", desc: "u_stepFundingDesc", done: false },
  ];
  const current = steps.findIndex((x) => !x.done);
  return (
    <section aria-labelledby="next-steps" className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6">
      <h2 id="next-steps" className="text-lg font-bold text-ink">
        {t("u_stepsTitle")}
      </h2>
      <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, i) => {
          const isCurrent = i === current;
          return (
            <li
              key={step.title}
              aria-current={isCurrent ? "step" : undefined}
              className={`rounded-xl border p-4 ${
                isCurrent
                  ? "border-[var(--gold)]/60 bg-[var(--gold-soft)]/40"
                  : step.done
                    ? "border-[var(--bull)]/25 bg-[var(--bull)]/5"
                    : "border-border/70 bg-background/60"
              }`}
            >
              <div className="flex items-center gap-2">
                {step.done ? (
                  <CheckCircle size={20} weight="fill" className="shrink-0 text-[var(--bull)]" aria-hidden />
                ) : (
                  <Circle size={20} weight={isCurrent ? "bold" : "regular"} className={`shrink-0 ${isCurrent ? "text-[var(--gold-deep)]" : "text-muted-foreground"}`} aria-hidden />
                )}
                <span className="text-xs font-semibold text-muted-foreground">
                  {step.done ? t("u_stepDone") : isCurrent ? t("u_stepCurrent") : t("u_stepUpcoming")}
                </span>
              </div>
              <div className="mt-2 text-[15px] font-semibold text-ink">{t(step.title)}</div>
              {step.desc && <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{t(step.desc)}</p>}
              {step.action && <div className="mt-2">{step.action}</div>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Shortcuts({ s }: { s: AccountStatus }) {
  const { t, lang } = useI18n();
  const cards: ReactNode[] = [];
  if (s.pendingInvitations > 0) {
    cards.push(
      <ShortcutCard
        key="inv"
        to="/invitations"
        icon={<EnvelopeSimple size={20} weight="duotone" />}
        title={t("u_invitesCardTitle")}
        desc={fill(t("u_invitesCardDesc"), { n: <Num value={s.pendingInvitations} kind="qty" /> })}
        highlight
      />,
    );
  }
  if (s.companies.length > 0) {
    const roleKey: Record<string, Key> = {
      owner: "ownerRole",
      finance: "financeRole",
      shariah: "shariahRole",
      trader: "traderRole",
      viewer: "viewerRole",
    };
    cards.push(
      <ShortcutCard
        key="co"
        to="/workspace"
        icon={<Buildings size={20} weight="duotone" />}
        title={t("u_companyCardTitle")}
        desc={
          <span className="flex flex-col gap-0.5">
            {s.companies.slice(0, 3).map((c) => (
              <span key={c.id} className="truncate">
                {(lang === "ar" ? c.nameAr || c.nameEn : c.nameEn || c.nameAr) || "—"}
                <span className="text-muted-foreground"> · {roleKey[c.role] ? t(roleKey[c.role]) : c.role}</span>
              </span>
            ))}
          </span>
        }
      />,
    );
  }
  if (s.isShariahReviewer) {
    cards.push(
      <ShortcutCard
        key="rev"
        to="/shariah/review"
        icon={<Scales size={20} weight="duotone" />}
        title={t("shariahReview")}
        desc={t("u_reviewerCardDesc")}
      />,
    );
  }
  if (s.isPlatformAdmin) {
    cards.push(
      <ShortcutCard
        key="adm"
        to="/admin/investors"
        icon={<ClipboardText size={20} weight="duotone" />}
        title={t("modePlatform")}
        desc={t("u_adminCardDesc")}
      />,
    );
  }
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="shortcuts">
      <h2 id="shortcuts" className="mb-3 text-lg font-bold text-ink">
        {t("u_shortcutsTitle")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards}</div>
    </section>
  );
}

function ShortcutCard({
  to,
  icon,
  title,
  desc,
  highlight,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  desc: ReactNode;
  highlight?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Link
      to={to as never}
      className={`group flex min-w-0 flex-col rounded-xl border bg-card p-5 transition hover:shadow-luxury ${
        highlight ? "border-[var(--gold)]/60" : "border-border/70 hover:border-[var(--gold)]/50"
      }`}
    >
      <div className="mb-3 inline-grid h-10 w-10 place-items-center rounded-md bg-[var(--gold)]/10 text-[var(--gold-deep)]" aria-hidden>
        {icon}
      </div>
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      <div className="mt-1 min-w-0 flex-1 text-[13px] leading-relaxed text-ink-soft">{desc}</div>
      <div className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--gold-ink)]">
        {t("u_open")}
        <Arrow className="transition group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function LiveMarket({ market }: { market: MarketQuery }) {
  const { t } = useI18n();
  const instruments = market.data?.instruments ?? [];
  const hasListings = (market.data?.summary.listedCount ?? 0) > 0;
  return (
    <section aria-labelledby="market-now">
      <SectionHeading id="market-now" title={t("u_marketNowTitle")} sub={t("u_marketNowSub")} />
      {hasListings && (
        <div className="mt-5 rounded-xl border border-border/70 bg-card p-5">
          <MarketSummaryStrip loading={false} summary={market.data?.summary ?? null} className="" />
        </div>
      )}
      <div className="mt-4">
        <MarketBoard
          loading={market.isLoading}
          failed={!market.data && !market.isLoading}
          error={market.error}
          onRetry={() => market.refetch()}
          instruments={instruments}
        />
      </div>
      {hasListings && <Movers instruments={instruments} />}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Market data blocks                                                        */
/* ------------------------------------------------------------------------ */

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
    <div className="relative min-w-0 rounded-xl border border-border bg-card p-4 shadow-luxury">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-bold text-ink">{t("e2_boardTitle")}</h2>
        {items.length > 0 && (
          <Link to="/market" className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-[var(--gold-ink)] hover:underline">
            {t("exploreMarket")}
            <Arrow />
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
            <InstrumentRow key={b.symbol} b={b} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
}

function InstrumentRow({ b, lang }: { b: PublicInstrument; lang: "ar" | "en" }) {
  return (
    <Link
      to="/market/$slug"
      params={{ slug: b.slug }}
      className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 transition hover:bg-secondary/60"
    >
      <Monogram symbol={b.symbol} className="h-9 w-9" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink">{instrumentName(b, lang)}</span>
          <ShariahPill status={b.shariahStatus} compact />
        </div>
        <div className="text-xs text-muted-foreground" dir="ltr" style={{ unicodeBidi: "isolate", textAlign: "start" }}>
          {b.symbol}
        </div>
      </div>
      <div className="text-end">
        <PriceText mark={markOf(b)} className="text-sm font-semibold text-ink" />
        <div className="text-xs">
          <ChangeText pct={b.change24hPct} />
        </div>
      </div>
    </Link>
  );
}

/** Top gainers / losers over 24h: only instruments that actually traded. */
function Movers({ instruments }: { instruments: PublicInstrument[] }) {
  const { t } = useI18n();
  const moved = instruments.filter((i) => i.change24hPct != null);
  const gainers = moved
    .filter((i) => (i.change24hPct ?? 0) > 0)
    .sort((a, b) => (b.change24hPct ?? 0) - (a.change24hPct ?? 0))
    .slice(0, 5);
  const losers = moved
    .filter((i) => (i.change24hPct ?? 0) < 0)
    .sort((a, b) => (a.change24hPct ?? 0) - (b.change24hPct ?? 0))
    .slice(0, 5);
  if (gainers.length === 0 && losers.length === 0) {
    return (
      <section className="mt-10">
        <EmptyState
          icon={<TrendUp size={22} weight="duotone" />}
          title={t("e2_noMoversTitle")}
          description={t("e2_noMoversDesc")}
          action={
            <Link to="/market" className={btnSecondary}>
              {t("exploreMarket")}
            </Link>
          }
        />
      </section>
    );
  }
  return (
    <section className="mt-10 grid gap-4 lg:grid-cols-2">
      <MoverCard title={t("topGainers")} rows={gainers} />
      <MoverCard title={t("topLosers")} rows={losers} />
    </section>
  );
}

function MoverCard({ title, rows }: { title: string; rows: PublicInstrument[] }) {
  const { lang, t } = useI18n();
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h3 className="mb-2 px-1 text-sm font-bold text-ink">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("e2_noMoversSide")}</p>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((b) => (
            <InstrumentRow key={b.symbol} b={b} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
}
