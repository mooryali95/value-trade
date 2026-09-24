import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { NotFoundBlock } from "@/components/not-found-block";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { canonicalUrl } from "@/lib/config/site";
import { formatCurrency, formatInt } from "@/lib/format";
import { getPublicInstrument } from "@/lib/market/public-market.functions";
import {
  ChangeText,
  InstrumentLoadError,
  ShariahPill,
  assetClassLabel,
  formatDateTime,
  formatPrice,
  instrumentName,
  markOf,
} from "@/components/market-data";
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
  const { t, lang } = useI18n();
  const name = instrumentName(brand, lang);
  const mark = markOf(brand);
  const companyName = lang === "ar" ? brand.companyNameAr || brand.companyNameEn : brand.companyNameEn || brand.companyNameAr;

  return (
    <AppShell>
      <PageHeader
        eyebrow={brand.symbol}
        title={name}
        description={[brand.sector, assetClassLabel(brand.assetClass, t)].filter(Boolean).join(" · ")}
        crumbs={[
          { label: t("marketOverview"), to: "/market" },
          { label: name },
        ]}
        actions={
          <div className="text-end">
            <div className="font-mono text-2xl font-bold text-ink md:text-3xl">{formatPrice(mark.price)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {mark.isReference ? t("e2_referencePriceNoTrades") : t("lastPrice")}
            </div>
            <div className="mt-1 text-sm">
              <ChangeText pct={brand.change24hPct} /> <span className="text-[10px] text-muted-foreground">{t("change24h")}</span>
            </div>
          </div>
        }
      />

      {/* Stats strip: today's session (Asia/Riyadh) and the last 24h, from executed trades */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label={t("e2_dayOpen")} value={brand.dayOpen != null ? formatPrice(brand.dayOpen) : "—"} />
        <Stat label={t("e2_dayHigh")} value={brand.dayHigh != null ? formatPrice(brand.dayHigh) : "—"} />
        <Stat label={t("e2_dayLow")} value={brand.dayLow != null ? formatPrice(brand.dayLow) : "—"} />
        <Stat label={t("e2_volumeUnits24h")} value={formatInt(brand.volume24hUnits)} />
        <Stat label={t("e2_value24h")} value={formatCurrency(brand.volume24hValue, true, lang)} />
        <Stat label={t("e2_trades24h")} value={formatInt(brand.trades24h)} />
        <Stat label={t("e2_allowedRange")} value={`${formatPrice(brand.bandLow)} – ${formatPrice(brand.bandHigh)}`} />
      </div>
      {brand.dayOpen == null && (
        <p className="-mt-2 mb-4 text-[11px] text-muted-foreground">{t("e2_noTradesToday")}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ChartPanel
          symbol={brand.symbol}
          actions={
            <Link
              to="/trade/$symbol"
              params={{ symbol: brand.slug }}
              className="rounded-md gold-gradient px-3 py-1.5 text-xs font-semibold text-[oklch(0.16_0.04_260)]"
            >
              {t("nav_trade")} →
            </Link>
          }
        />
        <div className="space-y-4">
          <OrderBookPanel symbol={brand.symbol} />
          <RecentTradesPanel symbol={brand.symbol} />
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title={t("overview")}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <KV k={t("e2_colSymbol")} v={brand.symbol} />
            <KV k={t("e2_assetClass")} v={assetClassLabel(brand.assetClass, t)} />
            {brand.sector && <KV k={t("sector")} v={brand.sector} />}
            <KV k={t("referencePrice")} v={formatPrice(brand.referencePrice)} />
            <KV k={t("e2_lastTrade")} v={brand.lastTradeAt ? formatDateTime(brand.lastTradeAt, lang) : t("e2_noTradesYet")} />
            {brand.companyId && companyName && (
              <div className="rounded border border-border/40 bg-secondary/30 px-2.5 py-2">
                <div className="text-[10px] text-muted-foreground">{t("e2_issuer")}</div>
                <Link to="/company/$id" params={{ id: brand.companyId }} className="mt-0.5 block truncate text-[var(--gold-deep)] hover:underline">
                  {companyName}
                </Link>
              </div>
            )}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">{t("e2_bandNote")}</p>
        </Panel>
        <Panel title={t("shariah")}>
          <ShariahPill status={brand.shariahStatus} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {brand.shariahStatus === "non_halal"
              ? t("e2_shariahNonHalalNote")
              : brand.shariahStatus == null
                ? t("e2_shariahNoneNote")
                : t("e2_shariahNote")}
          </p>
          <Link to="/shariah" className="mt-3 inline-block text-xs font-semibold text-[var(--gold-deep)] hover:underline">
            {t("e2_seeRulings")} →
          </Link>
        </Panel>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded border border-border/40 bg-secondary/30 px-2.5 py-2">
      <div className="text-[10px] text-muted-foreground">{k}</div>
      <div className="mt-0.5 truncate font-mono text-foreground">{v}</div>
    </div>
  );
}
