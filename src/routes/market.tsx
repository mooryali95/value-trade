import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { useI18n, type Key } from "@/lib/i18n";
import { canonicalUrl } from "@/lib/config/site";
import { formatCurrency, formatInt } from "@/lib/format";
import { Search } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import {
  ChangeText,
  MarketDataError,
  Monogram,
  NoListingsState,
  PriceText,
  ShariahPill,
  assetClassLabel,
  formatDateTime,
  instrumentName,
  loadOverviewOrNull,
  markOf,
  useMarketOverview,
} from "@/components/market-data";
import type { PublicInstrument } from "@/lib/market/public-market.functions";

export const Route = createFileRoute("/market")({
  loader: async () => ({ overview: await loadOverviewOrNull() }),
  head: () => ({
    meta: [
      { title: "السوق — وحدة القيمة | Market — Value Unit" },
      {
        name: "description",
        content:
          "الأدوات المدرجة في وحدة القيمة بأسعار آخر الصفقات المنفذة. · Instruments listed on Value Unit, priced from executed trades.",
      },
      { property: "og:title", content: "Market — Value Unit" },
      { property: "og:description", content: "Instruments listed on Value Unit, priced from executed trades." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonicalUrl("/market") },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/market") }],
  }),
  errorComponent: ({ reset }) => (<AppShell><ErrorState reset={reset} /></AppShell>),
  component: MarketPage,
});

type SortKey = "symbol" | "name" | "price" | "change" | "value" | "trades" | "lastTrade";

const SORT_KEYS: Array<{ id: SortKey; label: Key }> = [
  { id: "value", label: "e2_value24h" },
  { id: "trades", label: "e2_trades24h" },
  { id: "change", label: "change24h" },
  { id: "price", label: "price" },
  { id: "lastTrade", label: "e2_lastTrade" },
  { id: "symbol", label: "e2_colSymbol" },
  { id: "name", label: "e2_colName" },
];

function sortValue(i: PublicInstrument, key: SortKey, lang: "ar" | "en"): number | string | null {
  switch (key) {
    case "symbol": return i.symbol;
    case "name": return instrumentName(i, lang);
    case "price": return markOf(i).price;
    case "change": return i.change24hPct;
    case "value": return i.volume24hValue;
    case "trades": return i.trades24h;
    case "lastTrade": return i.lastTradeAt;
  }
}

function MarketPage() {
  const { t, lang } = useI18n();
  const { overview } = Route.useLoaderData();
  const market = useMarketOverview(overview);
  const [q, setQ] = useState("");
  const [sector, setSector] = useState<string>("all");
  const [assetClass, setAssetClass] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const instruments = useMemo(() => market.data?.instruments ?? [], [market.data]);
  const summary = market.data?.summary ?? null;
  const classes = useMemo(() => Array.from(new Set(instruments.map((i) => i.assetClass))).sort(), [instruments]);
  const sectors = useMemo(
    () => Array.from(new Set(instruments.map((i) => i.sector).filter((s): s is string => !!s))).sort(),
    [instruments],
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = instruments.filter((b) => {
      if (assetClass !== "all" && b.assetClass !== assetClass) return false;
      if (sector !== "all" && b.sector !== sector) return false;
      if (!s) return true;
      return (
        b.symbol.toLowerCase().includes(s) ||
        b.nameAr.includes(q.trim()) ||
        b.nameEn.toLowerCase().includes(s) ||
        (b.companyNameEn ?? "").toLowerCase().includes(s) ||
        (b.companyNameAr ?? "").includes(q.trim())
      );
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const va = sortValue(a, sortBy, lang);
      const vb = sortValue(b, sortBy, lang);
      // Instruments without the value (no trade yet) always sort last.
      if (va == null && vb == null) return a.symbol.localeCompare(b.symbol);
      if (va == null) return 1;
      if (vb == null) return -1;
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return c * dir || a.symbol.localeCompare(b.symbol);
    });
  }, [instruments, q, sector, assetClass, sortBy, sortDir, lang]);

  const description = !summary
    ? undefined
    : summary.listedCount > 0
      ? t("e2_marketDescListed").replace("{n}", formatInt(summary.listedCount))
      : t("e2_marketDescEmpty");

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("nav_market")}
        title={t("marketOverview")}
        description={description}
        crumbs={[{ label: t("marketOverview") }]}
      />

      {market.isLoading ? (
        <div className="space-y-4">
          <LuxurySkeleton lines={2} className="max-w-md" />
          <LuxurySkeleton lines={8} />
        </div>
      ) : !market.data ? (
        <div className="mx-auto max-w-md py-10">
          <MarketDataError error={market.error} onRetry={() => market.refetch()} />
        </div>
      ) : instruments.length === 0 ? (
        <div className="py-6">
          <NoListingsState />
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label={t("e2_listedInstruments")} value={formatInt(summary?.listedCount ?? 0)} />
            <MetricCard label={t("e2_trades24h")} value={formatInt(summary?.trades24h ?? 0)} />
            <MetricCard label={t("e2_value24h")} value={formatCurrency(summary?.volume24hValue ?? 0, true, lang)} />
            <MetricCard
              label={t("e2_lastTrade")}
              value={summary?.lastTradeAt ? formatDateTime(summary.lastTradeAt, lang) : t("e2_noTradesYet")}
              small
            />
          </div>

          {classes.length > 1 && (
            <div role="group" aria-label={t("a11yAssetClass")} className="mb-4 inline-flex rounded-lg border border-border bg-card p-1 text-sm">
              {["all", ...classes].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={assetClass === c}
                  onClick={() => setAssetClass(c)}
                  className={`rounded-md px-4 py-1.5 text-xs font-semibold transition ${
                    assetClass === c
                      ? "bg-[var(--gold-soft)] text-[var(--gold-deep)]"
                      : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {c === "all" ? t("all") : assetClassLabel(c, t)}
                </button>
              ))}
            </div>
          )}

          <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground start-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("e2_searchInstruments")}
                aria-label={t("e2_searchInstruments")}
                className="w-full rounded-md border border-border bg-card px-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="market-sort">{t("sortBy")}</label>
              <select
                id="market-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="rounded-md border border-border bg-card px-2 py-2 text-xs"
              >
                {SORT_KEYS.map((k) => (
                  <option key={k.id} value={k.id}>{t("sortBy")}: {t(k.label)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                className="rounded-md border border-border bg-card px-2 py-2 text-xs text-ink-soft hover:border-[var(--gold-deep)]"
                aria-label={sortDir === "asc" ? t("sortAsc") : t("sortDesc")}
              >
                {sortDir === "asc" ? "▲" : "▼"}
              </button>
            </div>
          </div>

          {sectors.length > 1 && (
            <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label={t("sector")}>
              {["all", ...sectors].map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={sector === s}
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
          )}

          <div className="mb-2 text-xs text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">
            {filtered.length} / {instruments.length} {t("a11yResults")}
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
            <div className="hidden md:grid grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] items-center gap-4 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div>{t("e2_colInstrument")}</div>
              <div className="text-end">{t("price")}</div>
              <div className="text-end">{t("change24h")}</div>
              <div className="text-end">{t("e2_value24h")}</div>
              <div className="hidden text-end lg:block">{t("e2_lastTrade")}</div>
              <div className="w-6" />
            </div>
            <div className="max-h-[70vh] divide-y divide-border/40 overflow-y-auto">
              {filtered.map((b) => (
                <Link
                  key={b.symbol}
                  to="/market/$slug"
                  params={{ slug: b.slug }}
                  className="hidden md:grid grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] items-center gap-4 px-4 py-3 text-sm transition hover:bg-secondary/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Monogram symbol={b.symbol} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-foreground">{instrumentName(b, lang)}</span>
                        <ShariahPill status={b.shariahStatus} compact />
                      </div>
                      <div className="text-[10px] uppercase text-muted-foreground">
                        {[b.symbol, b.sector, assetClassLabel(b.assetClass, t)].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </div>
                  <div className="text-end text-foreground"><PriceText mark={markOf(b)} /></div>
                  <div className="text-end"><ChangeText pct={b.change24hPct} /></div>
                  <div className="text-end font-mono text-muted-foreground">
                    {b.trades24h > 0 ? formatCurrency(b.volume24hValue, true, lang) : "—"}
                  </div>
                  <div className="hidden text-end text-xs text-muted-foreground lg:block">
                    {b.lastTradeAt ? formatDateTime(b.lastTradeAt, lang) : t("e2_noTradesYet")}
                  </div>
                  <div className="w-6 text-end text-muted-foreground rtl:rotate-180">›</div>
                </Link>
              ))}
              {/* mobile cards */}
              {filtered.map((b) => (
                <Link
                  key={`m-${b.symbol}`}
                  to="/market/$slug"
                  params={{ slug: b.slug }}
                  className="md:hidden grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-secondary/40"
                >
                  <Monogram symbol={b.symbol} className="h-10 w-10 text-[10px]" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-foreground">{instrumentName(b, lang)}</span>
                      <ShariahPill status={b.shariahStatus} compact />
                    </div>
                    <div className="text-[10px] uppercase text-muted-foreground">{[b.symbol, b.sector].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="text-end">
                    <PriceText mark={markOf(b)} className="text-sm text-foreground" />
                    <div className="text-[10px]"><ChangeText pct={b.change24hPct} /></div>
                  </div>
                </Link>
              ))}
              {filtered.length === 0 && (
                <div className="p-4">
                  <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
                </div>
              )}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">{t("e2_priceNote")}</p>
        </>
      )}
    </AppShell>
  );
}

function MetricCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono font-semibold text-foreground ${small ? "text-sm" : "text-lg"}`}>{value}</div>
    </div>
  );
}
