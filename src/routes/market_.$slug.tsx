import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { NotFoundBlock } from "@/components/not-found-block";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { useI18n, type Key } from "@/lib/i18n";
import { Num } from "@/components/num";
import { canonicalUrl } from "@/lib/config/site";
import { getPublicInstrument } from "@/lib/market/public-market.functions";
import {
  ChangeText,
  InstrumentLoadError,
  ShariahPill,
  assetClassLabel,
  formatDateTime,
  instrumentName,
  markOf,
  sectorLabel,
} from "@/components/market-data";
import { InstrumentAssistant } from "@/components/instrument-assistant";
import { ChartPanel, OrderBookPanel, Panel, RecentTradesPanel, useLiveInstrument } from "@/components/market-panels";

export const Route = createFileRoute("/market_/$slug")({
  loader: async ({ params }) => {
    const instrument = await getPublicInstrument({ data: { slug: params.slug } });
    if (!instrument) throw notFound();
    return { instrument };
  },
  head: ({ loaderData }) => {
    const i = loaderData?.instrument;
    return {
      meta: i
        ? [
            { title: `${i.nameAr} (${i.symbol}) — وحدة القيمة` },
            { name: "description", content: `${i.nameAr} (${i.symbol}) على وحدة القيمة. · ${i.nameEn} (${i.symbol}) on Value Unit.` },
            { property: "og:title", content: `${i.nameEn} (${i.symbol}) — Value Unit` },
            { property: "og:description", content: `${i.nameEn} (${i.symbol}) on Value Unit.` },
            { property: "og:type", content: "website" },
            { property: "og:url", content: canonicalUrl(`/market/${i.slug}`) },
            { name: "twitter:card", content: "summary_large_image" },
          ]
        : [{ title: "وحدة القيمة — Value Unit" }],
      links: i ? [{ rel: "canonical", href: canonicalUrl(`/market/${i.slug}`) }] : [],
    };
  },
  errorComponent: ({ error, reset }) => (
    <AppShell><div className="py-16"><InstrumentLoadError error={error} reset={reset} /></div></AppShell>
  ),
  notFoundComponent: () => <NotFoundBlock kind="symbol" />,
  component: BrandDetail,
});

function BrandDetail() {
  const { instrument: initial } = Route.useLoaderData();
  const brand = useLiveInstrument(initial);
  const { t, lang, dir } = useI18n();
  const name = instrumentName(brand, lang);
  const mark = markOf(brand);
  const companyName = lang === "ar" ? brand.companyNameAr || brand.companyNameEn : brand.companyNameEn || brand.companyNameAr;
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  const meaning: Key =
    brand.shariahStatus === "halal"
      ? "u_shHalalD"
      : brand.shariahStatus === "non_halal"
        ? "u_shNonHalalD"
        : brand.shariahStatus === "reviewing"
          ? "u_shReviewingD"
          : "e2_shariahNoneNote";

  return (
    <AppShell>
      <PageHeader
        eyebrow={brand.symbol}
        title={name}
        description={[sectorLabel(brand.sector, t), assetClassLabel(brand.assetClass, t)].filter(Boolean).join(" · ")}
        crumbs={[
          { label: t("marketOverview"), to: "/market" },
          { label: name },
        ]}
        actions={
          <div className="flex w-full flex-wrap items-end justify-between gap-4 sm:w-auto sm:justify-end">
            <div className="sm:text-end">
              <div className="text-[28px] font-bold leading-none text-ink md:text-[34px]">
                <Num value={mark.price} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:justify-end">
                <span className="text-muted-foreground">
                  {mark.isReference ? t("e2_referencePriceNoTrades") : t("lastPrice")}
                </span>
                <span aria-hidden className="text-border">|</span>
                <span className="inline-flex items-center gap-1">
                  <ChangeText pct={brand.change24hPct} className="font-semibold" />
                  <span className="text-muted-foreground">{t("change24h")}</span>
                </span>
              </div>
            </div>
            <Link
              to="/trade/$symbol"
              params={{ symbol: brand.slug }}
              className="inline-flex min-h-11 items-center gap-2 rounded-md gold-gradient px-5 text-sm font-semibold text-ink shadow-gold transition hover:brightness-105"
            >
              {t("u_tradeCta")}
              <Arrow size={16} weight="bold" aria-hidden />
            </Link>
          </div>
        }
      />

      {/* Ruling in force, next to the price: what it means for trading. */}
      <div
        className={`mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 ${
          brand.shariahStatus === "non_halal"
            ? "border-[var(--bear)]/30 bg-[var(--bear)]/5"
            : brand.shariahStatus === "halal"
              ? "border-[var(--bull)]/25 bg-[var(--bull)]/5"
              : "border-border/70 bg-card"
        }`}
      >
        <ShariahPill status={brand.shariahStatus} />
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-soft">{t(meaning)}</p>
        <Link to="/shariah" className="inline-flex min-h-9 items-center text-xs font-semibold text-[var(--gold-ink)] underline-offset-4 hover:underline">
          {t("e2_seeRulings")}
        </Link>
      </div>

      {/* Key figures: today's session (Asia/Riyadh) and the last 24h, from executed trades */}
      <dl className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label={t("e2_dayOpen")} value={<Num value={brand.dayOpen} />} />
        <Stat label={t("e2_dayHigh")} value={<Num value={brand.dayHigh} />} />
        <Stat label={t("e2_dayLow")} value={<Num value={brand.dayLow} />} />
        <Stat label={t("referencePrice")} value={<Num value={brand.referencePrice} />} />
        <Stat
          label={t("e2_allowedRange")}
          value={
            <span dir="ltr" className="inline-flex gap-1" style={{ unicodeBidi: "isolate" }}>
              <Num value={brand.bandLow} />
              <span aria-hidden>–</span>
              <Num value={brand.bandHigh} />
            </span>
          }
        />
        <Stat label={t("e2_volumeUnits24h")} value={<Num value={brand.volume24hUnits} kind="qty" />} />
        <Stat
          label={t("e2_value24h")}
          value={brand.trades24h > 0 ? <Num value={brand.volume24hValue} kind="currency" /> : <Num value={null} />}
        />
        <Stat label={t("e2_trades24h")} value={<Num value={brand.trades24h} kind="qty" />} />
      </dl>
      <p className="mb-6 text-xs leading-relaxed text-muted-foreground">
        {brand.dayOpen == null ? `${t("e2_noTradesToday")} ` : ""}
        {t("e2_bandNote")}
      </p>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ChartPanel symbol={brand.symbol} height={480} />
        <div className="grid content-start gap-4">
          <OrderBookPanel symbol={brand.symbol} />
          <RecentTradesPanel symbol={brand.symbol} limit={12} />
        </div>
      </div>

      <div className="mt-6">
        <Panel title={t("overview")}>
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 xl:grid-cols-6">
            <KV k={t("e2_colSymbol")} v={<span dir="ltr">{brand.symbol}</span>} />
            <KV k={t("e2_assetClass")} v={assetClassLabel(brand.assetClass, t)} />
            {brand.sector && <KV k={t("sector")} v={sectorLabel(brand.sector, t)} />}
            <KV k={t("referencePrice")} v={<Num value={brand.referencePrice} />} />
            <KV k={t("e2_lastTrade")} v={brand.lastTradeAt ? formatDateTime(brand.lastTradeAt, lang) : t("e2_noTradesYet")} />
            {brand.companyId && companyName && (
              <KV
                k={t("e2_issuer")}
                v={
                  <Link to="/company/$id" params={{ id: brand.companyId }} className="text-[var(--gold-ink)] underline-offset-4 hover:underline">
                    {companyName}
                  </Link>
                }
              />
            )}
          </dl>
          {brand.shariahStatus != null && (
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{t("e2_shariahNote")}</p>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <InstrumentAssistant slug={brand.slug} />
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card px-3 py-2.5">
      <dt className="truncate text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5">
      <dt className="text-[11px] font-medium text-muted-foreground">{k}</dt>
      <dd className="mt-0.5 truncate font-medium text-ink">{v}</dd>
    </div>
  );
}
