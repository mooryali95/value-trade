import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";
import { BRANDS, MARKET_STATS, type Sector, type AssetClass } from "@/lib/mock-data";
import { formatCurrency, formatPct, formatInt } from "@/lib/format";
import { Search, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";

export const Route = createFileRoute("/market")({
  head: () => ({
    meta: [
      { title: "السوق العام — قيمة | Market — Value Unit" },
      { name: "description", content: "استكشف 256 براند نشط داخل منظومة قيمة مع بيانات لحظية." },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><ErrorState reset={reset} /></AppShell>),
  component: MarketPage,
});

const SECTORS: (Sector | "all")[] = ["all","tech","fintech","food","fashion","media","health","energy","logistics","realestate","education","retail","auto"];

const CLASS_TABS: Array<{ id: AssetClass | "all"; label: Record<"ar" | "en", string> }> = [
  { id: "all", label: { ar: "الكل", en: "All" } },
  { id: "brand", label: { ar: "العلامات", en: "Brands" } },
  { id: "stock", label: { ar: "الأسهم", en: "Stocks" } },
  { id: "sukuk", label: { ar: "الصكوك", en: "Sukuk" } },
];

function MarketPage() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [sector, setSector] = useState<Sector | "all">("all");
  const [assetClass, setAssetClass] = useState<AssetClass | "all">("all");

  const filtered = useMemo(() => {
    return BRANDS.filter((b) => {
      if (assetClass !== "all" && (b.assetClass ?? "brand") !== assetClass) return false;
      if (sector !== "all" && b.sector !== sector) return false;
      if (!q) return true;
      const s = q.toLowerCase();
      return b.symbol.toLowerCase().includes(s) || b.nameAr.includes(q) || b.nameEn.toLowerCase().includes(s);
    });
  }, [q, sector, assetClass]);

  return (
    <AppShell>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-foreground md:text-3xl">{t("marketOverview")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("brands256")} · {formatCurrency(MARKET_STATS.totalMarketCap, true, lang)} {t("marketCap")}</p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label={t("activeInstruments")} value={String(MARKET_STATS.activeInstruments)} />
        <MetricCard label={t("totalCap")} value={formatCurrency(MARKET_STATS.totalMarketCap, true, lang)} />
        <MetricCard label={t("dayVolume")} value={formatCurrency(MARKET_STATS.dayVolume, true, lang)} />
        <MetricCard label={t("liveMarket")} value="●" tone="bull" />
      </div>

      {/* Asset-class tabs */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-1 text-sm">
        {CLASS_TABS.map((c) => (
          <button
            key={c.id}
            onClick={() => setAssetClass(c.id)}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold transition ${
              assetClass === c.id
                ? "bg-[var(--gold-soft)] text-[var(--gold-deep)]"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {c.label[lang]}
          </button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground start-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            className="w-full rounded-md border border-border bg-card px-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
          />
        </div>
        <div className="hidden text-xs text-muted-foreground md:block">{filtered.length} / 256</div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {SECTORS.map((s) => (
          <button
            key={s}
            onClick={() => setSector(s)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              sector === s
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            {s === "all" ? t("all") : s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
        <div className="grid grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] items-center gap-4 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
          <div>Brand</div>
          <div className="text-end">{t("price")}</div>
          <div className="hidden text-end md:block">{t("change24h")}</div>
          <div className="hidden text-end md:block">{t("volume24h")}</div>
          <div className="hidden text-end lg:block">{t("marketCap")}</div>
          <div className="w-6" />
        </div>
        <div className="max-h-[70vh] divide-y divide-border/40 overflow-y-auto">
          {filtered.map((b) => (
            <Link
              key={b.id}
              to="/market/$slug"
              params={{ slug: b.slug }}
              className="grid grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] items-center gap-4 px-4 py-3 text-sm transition hover:bg-secondary/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[10px] font-bold text-ivory" style={{ background: b.color }}>
                  {b.symbol.slice(0, 3)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{lang === "ar" ? b.nameAr : b.nameEn}</span>
                    {b.shariah === "halal" && (
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[var(--bull)]" aria-label="halal" />
                    )}
                  </div>
                  <div className="text-[10px] uppercase text-muted-foreground">{b.symbol} · {b.sector} · {b.instrument}</div>
                </div>
              </div>
              <div className="text-end font-mono text-foreground">{b.price.toFixed(2)}</div>
              <div className={`hidden text-end font-mono md:block ${b.change24h >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                {formatPct(b.change24h)}
              </div>
              <div className="hidden text-end font-mono text-muted-foreground md:block">{formatInt(b.volume24h, true)}</div>
              <div className="hidden text-end font-mono text-muted-foreground lg:block">{formatCurrency(b.marketCap, true, lang)}</div>
              <div className="w-6 text-end text-muted-foreground">›</div>
            </Link>
          ))}
          {filtered.length === 0 && (
            <div className="p-4">
              <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${tone === "bull" ? "text-[var(--bull)]" : "text-foreground"}`}>{value}</div>
    </div>
  );
}