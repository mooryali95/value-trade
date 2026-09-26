import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Num } from "@/components/num";
import { NotFoundBlock } from "@/components/not-found-block";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { useI18n, pick } from "@/lib/i18n";
import { canonicalUrl } from "@/lib/config/site";
import { getPublicCompanyProfile } from "@/lib/market/public-market.functions";
import {
  ChangeText,
  InstrumentLoadError,
  Monogram,
  PriceText,
  ShariahPill,
  assetClassLabel,
  formatDateTime,
  instrumentName,
  markOf,
  sectorLabel,
} from "@/components/market-data";

export const Route = createFileRoute("/company/$id")({
  // Public profile of a company with at least one published instrument;
  // anything else (unknown id, nothing listed) is a 404.
  loader: async ({ params }) => {
    const profile = await getPublicCompanyProfile({ data: { id: params.id } });
    if (!profile) throw notFound();
    return { profile };
  },
  head: ({ loaderData }) => {
    const p = loaderData?.profile;
    return {
      meta: [
        { title: p ? `${p.nameAr} — وحدة القيمة` : "وحدة القيمة — Value Unit" },
        {
          name: "description",
          content: p
            ? `ملف ${p.nameAr} والأدوات المدرجة لها على وحدة القيمة. · ${p.nameEn} and its instruments listed on Value Unit.`
            : "ملف شركة على وحدة القيمة. · Company profile on Value Unit.",
        },
        { property: "og:title", content: p ? `${p.nameEn} — Value Unit` : "Value Unit" },
        { property: "og:description", content: "Company profile and listed instruments on Value Unit." },
        { property: "og:type", content: "website" },
        ...(p ? [{ property: "og:url", content: canonicalUrl(`/company/${p.id}`) }] : []),
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: p ? [{ rel: "canonical", href: canonicalUrl(`/company/${p.id}`) }] : [],
    };
  },
  errorComponent: ({ error, reset }) => (
    <AppShell><div className="py-16"><InstrumentLoadError error={error} reset={reset} /></div></AppShell>
  ),
  notFoundComponent: () => <NotFoundBlock kind="company" />,
  component: CompanyPage,
});

function CompanyPage() {
  const { profile } = Route.useLoaderData();
  const { t, lang } = useI18n();
  const name = pick(lang, profile.nameAr, profile.nameEn);
  const trades24h = profile.instruments.reduce((s, i) => s + i.trades24h, 0);
  const value24h = profile.instruments.reduce((s, i) => s + i.volume24hValue, 0);
  const lastTradeAt = profile.instruments
    .map((i) => i.lastTradeAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1) ?? null;

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("companyProfile")}
        title={name}
        description={profile.sector ? sectorLabel(profile.sector, t) : undefined}
        crumbs={[
          { label: t("marketOverview"), to: "/market" },
          { label: name },
        ]}
      />

      <dl className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("e2_listedInstruments")} value={<Num value={profile.instruments.length} kind="qty" />} />
        <Stat label={t("e2_trades24h")} value={<Num value={trades24h} kind="qty" />} />
        <Stat label={t("e2_value24h")} value={<Num value={value24h} kind="currency" />} />
        <Stat label={t("e2_lastTrade")} value={lastTradeAt ? formatDateTime(lastTradeAt, lang) : t("e2_noTradesYet")} small />
      </dl>

      <h2 className="mb-3 text-[15px] font-bold text-ink">{t("e2_companyInstruments")}</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {profile.instruments.map((b) => (
          <Link
            key={b.symbol}
            to="/market/$slug"
            params={{ slug: b.slug }}
            className="rounded-xl border border-border/70 bg-card p-4 shadow-card transition hover:border-[var(--gold)]/60 hover:shadow-luxury"
          >
            <div className="flex items-center gap-3">
              <Monogram symbol={b.symbol} className="h-10 w-10" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{instrumentName(b, lang)}</div>
                <div className="truncate text-xs text-muted-foreground">
                  <span dir="ltr">{b.symbol}</span>
                  {[b.sector ? sectorLabel(b.sector, t) : null, assetClassLabel(b.assetClass, t)].filter(Boolean).map((x) => ` · ${x}`).join("")}
                </div>
              </div>
              <div className="text-end">
                <PriceText mark={markOf(b)} className="text-sm font-semibold text-ink" />
                <div className="text-xs"><ChangeText pct={b.change24hPct} /></div>
              </div>
            </div>
            <div className="mt-3">
              <ShariahPill status={b.shariahStatus} />
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

function Stat({ label, value, small }: { label: string; value: ReactNode; small?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card p-4 shadow-card">
      <dt className="truncate text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-1.5 font-semibold text-ink ${small ? "text-sm" : "text-xl"}`}>{value}</dd>
    </div>
  );
}
