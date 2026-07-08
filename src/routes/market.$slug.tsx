import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CandlestickChart } from "@/components/candlestick-chart";
import { useI18n } from "@/lib/i18n";
import { getBrand, generateCandles, generateOrderBook } from "@/lib/mock-data";
import { formatCurrency, formatPct, formatInt } from "@/lib/format";
import { ShieldCheck, TrendingUp, TrendingDown } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

export const Route = createFileRoute("/market/$slug")({
  loader: ({ params }) => {
    const brand = getBrand(params.slug);
    if (!brand) throw notFound();
    return { brand };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.brand.nameAr} (${loaderData.brand.symbol}) — قيمة` },
          { name: "description", content: `تداول ${loaderData.brand.nameAr} على منصة قيمة. القطاع: ${loaderData.brand.sector}.` },
        ]
      : [{ title: "براند — قيمة" }],
  }),
  errorComponent: ({ error, reset }) => (
    <AppShell><div className="py-16"><ErrorState reset={reset} description={String(error?.message ?? "")} /></div></AppShell>
  ),
  notFoundComponent: () => (
    <AppShell><div className="py-16"><EmptyState title="العنصر غير موجود" description="الرمز المطلوب غير مدرج على المنصة." action={<Link to="/market" className="rounded-md gold-gradient px-4 py-2 text-xs font-semibold text-ink">السوق العام</Link>} /></div></AppShell>
  ),
  component: BrandDetail,
});

function BrandDetail() {
  const { brand } = Route.useLoaderData();
  const { t, lang } = useI18n();
  const candles = generateCandles(brand.slug, 180, brand.price);
  const { bids, asks } = generateOrderBook(brand.price, brand.slug);
  const up = brand.change24h >= 0;

  return (
    <AppShell>
      {/* Header */}
      <header className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl text-sm font-bold text-ivory shadow-lg" style={{ background: brand.color }}>
            {brand.symbol.slice(0, 3)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold text-foreground md:text-2xl">{lang === "ar" ? brand.nameAr : brand.nameEn}</h1>
              {brand.shariah === "halal" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--bull)]/30 bg-[var(--bull)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--bull)]">
                  <ShieldCheck className="h-3 w-3" /> {t("halal")}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {brand.symbol} · {brand.sector} · {t(brand.instrument === "sukuk" ? "sukuk" : "equity")} · <Link to="/company/$id" params={{ id: brand.companyId }} className="text-primary hover:underline">{lang === "ar" ? brand.companyNameAr : brand.companyNameEn}</Link>
            </div>
          </div>
        </div>
        <div className="text-end">
          <div className="font-mono text-2xl font-bold text-foreground md:text-3xl">{brand.price.toFixed(2)}</div>
          <div className={`mt-1 inline-flex items-center gap-1 font-mono text-sm ${up ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
            {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {formatPct(brand.change24h)}
          </div>
        </div>
      </header>

      {/* Stats strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("marketCap")} value={formatCurrency(brand.marketCap, true, lang)} />
        <Stat label={t("volume24h")} value={formatInt(brand.volume24h, true)} />
        <Stat label={t("high")} value={(brand.price * 1.03).toFixed(2)} />
        <Stat label={t("low")} value={(brand.price * 0.96).toFixed(2)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Chart + trade panel */}
        <div className="rounded-xl border border-border/60 bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">{t("chart")}</h2>
            <Link
              to="/trade/$symbol"
              params={{ symbol: brand.slug }}
              className="rounded-md gold-gradient px-3 py-1.5 text-xs font-semibold text-[oklch(0.16_0.04_260)]"
            >
              {t("nav_trade")} →
            </Link>
          </div>
          <CandlestickChart candles={candles} height={440} />
        </div>

        {/* Order book */}
        <div className="rounded-xl border border-border/60 bg-card/60 p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">{t("orderBook")}</h2>
          <div className="grid grid-cols-3 gap-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <div>{t("price")}</div>
            <div className="text-end">{t("qty")}</div>
            <div className="text-end">{t("total")}</div>
          </div>
          <div className="space-y-0.5 text-xs font-mono">
            {asks.slice().reverse().map((r, i) => (
              <div key={"a" + i} className="relative grid grid-cols-3 gap-2 rounded px-1 py-0.5">
                <div className="absolute inset-y-0 end-0 bg-[var(--bear)]/10" style={{ width: `${Math.min(100, r.qty / 10)}%` }} />
                <div className="relative text-[var(--bear)]">{r.price.toFixed(2)}</div>
                <div className="relative text-end text-foreground/80">{r.qty}</div>
                <div className="relative text-end text-muted-foreground">{formatInt(r.total, true)}</div>
              </div>
            ))}
            <div className="my-2 rounded bg-secondary/40 px-1 py-1 text-center text-sm font-bold text-primary">{brand.price.toFixed(2)}</div>
            {bids.map((r, i) => (
              <div key={"b" + i} className="relative grid grid-cols-3 gap-2 rounded px-1 py-0.5">
                <div className="absolute inset-y-0 end-0 bg-[var(--bull)]/10" style={{ width: `${Math.min(100, r.qty / 10)}%` }} />
                <div className="relative text-[var(--bull)]">{r.price.toFixed(2)}</div>
                <div className="relative text-end text-foreground/80">{r.qty}</div>
                <div className="relative text-end text-muted-foreground">{formatInt(r.total, true)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Panel title={t("overview")}>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {lang === "ar"
              ? `${brand.nameAr} علامة تجارية ضمن ${brand.companyNameAr}، تعمل في قطاع ${brand.sector}. مطروحة كأداة ${brand.instrument === "sukuk" ? "صكوك" : brand.instrument === "mudarabah" ? "مضاربة" : "أسهم"}.`
              : `${brand.nameEn} is a brand within ${brand.companyNameEn}, operating in ${brand.sector}. Listed as ${brand.instrument}.`}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <KV k={t("sector")} v={brand.sector} />
            <KV k={t("established")} v={String(brand.established)} />
            <KV k="Instrument" v={brand.instrument} />
            <KV k={t("valuation")} v={formatCurrency(brand.marketCap, true, lang)} />
          </div>
        </Panel>
        <Panel title={t("financials")}>
          <FinancialRow k="Revenue TTM" v={formatCurrency(brand.marketCap * 0.18, true, lang)} />
          <FinancialRow k="Net income" v={formatCurrency(brand.marketCap * 0.04, true, lang)} />
          <FinancialRow k="Dividend yield" v={`${(1 + (brand.change24h % 3 + 3)).toFixed(2)}%`} />
          <FinancialRow k="P/E" v={(15 + brand.change24h).toFixed(1)} />
          <FinancialRow k="Free float" v={`${(30 + (brand.price % 40)).toFixed(0)}%`} />
        </Panel>
        <Panel title={t("shariah")}>
          <div className={`mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${brand.shariah === "halal" ? "border border-[var(--bull)]/30 bg-[var(--bull)]/10 text-[var(--bull)]" : "border border-border bg-secondary/40 text-muted-foreground"}`}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {brand.shariah === "halal" ? t("halal") : t("reviewing")}
          </div>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li>· AAOIFI-21 Investment Sukuk</li>
            <li>· Debt ratio &lt; 33%</li>
            <li>· Non-permissible income &lt; 5%</li>
            <li>· No interest-based leverage</li>
          </ul>
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
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}
function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded border border-border/40 bg-secondary/30 px-2.5 py-2">
      <div className="text-[10px] text-muted-foreground">{k}</div>
      <div className="mt-0.5 font-mono text-foreground">{v}</div>
    </div>
  );
}
function FinancialRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-2 text-xs last:border-b-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-foreground">{v}</span>
    </div>
  );
}