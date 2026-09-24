import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { NotFoundBlock } from "@/components/not-found-block";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { useI18n, pick } from "@/lib/i18n";
import { canonicalUrl } from "@/lib/config/site";
import { formatCurrency, formatInt } from "@/lib/format";
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
        description={profile.sector ?? undefined}
        crumbs={[
          { label: t("marketOverview"), to: "/market" },
          { label: name },
        ]}
      />

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("e2_listedInstruments")} value={formatInt(profile.instruments.length)} />
        <Stat label={t("e2_trades24h")} value={formatInt(trades24h)} />
        <Stat label={t("e2_value24h")} value={formatCurrency(value24h, true, lang)} />
        <Stat label={t("e2_lastTrade")} value={lastTradeAt ? formatDateTime(lastTradeAt, lang) : t("e2_noTradesYet")} small />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-foreground">{t("e2_companyInstruments")}</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {profile.instruments.map((b) => (
          <Link
            key={b.symbol}
            to="/market/$slug"
            params={{ slug: b.slug }}
            className="rounded-xl border border-border/60 bg-card/60 p-4 transition hover:border-primary/40"
          >
            <div className="flex items-center gap-3">
              <Monogram symbol={b.symbol} className="h-10 w-10 text-[10px]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{instrumentName(b, lang)}</div>
                <div className="text-[10px] text-muted-foreground">
                  {[b.symbol, b.sector, assetClassLabel(b.assetClass, t)].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="text-end">
                <PriceText mark={markOf(b)} className="text-sm text-foreground" />
                <div className="text-[10px]"><ChangeText pct={b.change24hPct} /></div>
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

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono font-semibold text-foreground ${small ? "text-sm" : "text-lg"}`}>{value}</div>
    </div>
  );
}
