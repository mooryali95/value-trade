import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { CaretLeft, CaretRight, SortAscending, SortDescending } from "@phosphor-icons/react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { useI18n, type Key } from "@/lib/i18n";
import { canonicalUrl } from "@/lib/config/site";
import { Num } from "@/components/num";
import { fill } from "@/lib/account/fill";
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
  listedCountText,
  loadOverviewOrNull,
  markOf,
  sectorLabel,
  useMarketOverview,
} from "@/components/market-data";
import type { PublicInstrument } from "@/lib/market/public-market.functions";
import { AssetClassBadge } from "@/components/market-data";
import { ASSET_CLASSES, countByClass, isAssetClass, type AssetClass } from "@/lib/market/asset-classes";

export const Route = createFileRoute("/market")({
  validateSearch: (s: Record<string, unknown>): { class?: AssetClass } =>
    isAssetClass(s.class) ? { class: s.class } : {},
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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const assetClass: AssetClass | "all" = search.class ?? "all";
  const setAssetClass = (c: AssetClass | "all") =>
    navigate({ search: (s) => ({ ...s, class: c === "all" ? undefined : c }), replace: true, resetScroll: false });
  const [q, setQ] = useState("");
  const [sector, setSector] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const instruments = useMemo(() => market.data?.instruments ?? [], [market.data]);
  const summary = market.data?.summary ?? null;
  const classCounts = useMemo(() => countByClass(instruments), [instruments]);
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
      ? `${listedCountText(summary.listedCount, t, lang)} · ${t("u_pricesFromTrades")}`
      : t("e2_marketDescEmpty");

  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-full border px-4 text-[13px] font-medium transition sm:min-h-9 ${
      active
        ? "border-[var(--gold)] bg-[var(--gold-soft)] text-[var(--gold-ink)]"
        : "border-border bg-card text-ink-soft hover:border-[var(--gold)]/50 hover:text-ink"
    }`;

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
          <dl className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label={t("e2_listedInstruments")} value={<Num value={summary?.listedCount ?? 0} kind="qty" />} />
            <MetricCard label={t("e2_trades24h")} value={<Num value={summary?.trades24h ?? 0} kind="qty" />} />
            <MetricCard label={t("e2_value24h")} value={<Num value={summary?.volume24hValue ?? 0} kind="currency" />} />
            <MetricCard
              label={t("e2_lastTrade")}
              value={summary?.lastTradeAt ? formatDateTime(summary.lastTradeAt, lang) : t("e2_noTradesYet")}
              small
            />
          </dl>

          <div role="group" aria-label={t("a11yAssetClass")} className="mb-4 flex flex-wrap gap-2">
            {(["all", ...ASSET_CLASSES] as const).map((c) => {
              const n = c === "all" ? instruments.length : classCounts[c];
              return (
                <button key={c} type="button" aria-pressed={assetClass === c} onClick={() => setAssetClass(c)} className={chip(assetClass === c)}>
                  {c === "all" ? t("u_classAllCount") : assetClassLabel(c, t)}
                  <span className="ms-1.5 font-mono text-[11px] opacity-70">{n}</span>
                </button>
              );
            })}
          </div>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("e2_searchInstruments")}
                aria-label={t("e2_searchInstruments")}
                className="min-h-11 w-full rounded-md border border-border bg-card ps-10 pe-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-[var(--gold-deep)] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="market-sort">{t("sortBy")}</label>
              <select
                id="market-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-sm sm:flex-none"
              >
                {SORT_KEYS.map((k) => (
                  <option key={k.id} value={k.id}>{t("sortBy")}: {t(k.label)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                className="grid min-h-11 min-w-11 place-items-center rounded-md border border-border bg-card text-ink-soft transition hover:border-[var(--gold-deep)] hover:text-ink"
                aria-label={sortDir === "asc" ? t("sortAsc") : t("sortDesc")}
                title={sortDir === "asc" ? t("sortAsc") : t("sortDesc")}
              >
                {sortDir === "asc" ? <SortAscending size={18} aria-hidden /> : <SortDescending size={18} aria-hidden />}
              </button>
            </div>
          </div>

          {sectors.length > 1 && (
            <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label={t("sector")}>
              {["all", ...sectors].map((s) => (
                <button key={s} type="button" aria-pressed={sector === s} onClick={() => setSector(s)} className={chip(sector === s)}>
                  {s === "all" ? t("all") : sectorLabel(s, t)}
                </button>
              ))}
            </div>
          )}

          <div className="mb-2 text-xs text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">
            {fill(t("fx3_shownOfTotal"), {
              n: <Num value={filtered.length} kind="qty" />,
              total: <Num value={instruments.length} kind="qty" />,
            })}
          </div>

          {/* Table (desktop) / cards (mobile) */}
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-card">
            <div className="hidden grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))_auto] items-center gap-4 border-b border-border/70 bg-secondary/40 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid lg:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_auto]">
              <div>{t("e2_colInstrument")}</div>
              <div className="text-end">{t("price")}</div>
              <div className="text-end">{t("change24h")}</div>
              <div className="text-end">{t("e2_value24h")}</div>
              <div className="hidden text-end lg:block">{t("e2_lastTrade")}</div>
              <div className="w-4" />
            </div>
            <div className="divide-y divide-border/60">
              {filtered.map((b) => (
                <Link
                  key={b.symbol}
                  to="/market/$slug"
                  params={{ slug: b.slug }}
                  className="hidden grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))_auto] items-center gap-4 px-4 py-3 text-sm transition hover:bg-secondary/40 md:grid lg:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_auto]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Monogram symbol={b.symbol} className="h-10 w-10" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-ink">{instrumentName(b, lang)}</span>
                        <ShariahPill status={b.shariahStatus} compact />
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
                        <AssetClassBadge assetClass={b.assetClass} />
                        <span dir="ltr">{b.symbol}</span>
                        {b.sector ? ` · ${sectorLabel(b.sector, t)}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="text-end font-semibold text-ink"><PriceText mark={markOf(b)} /></div>
                  <div className="text-end"><ChangeText pct={b.change24hPct} /></div>
                  <div className="text-end text-ink-soft">
                    {b.trades24h > 0 ? <Num value={b.volume24hValue} kind="currency" /> : <Num value={null} />}
                  </div>
                  <div className="hidden text-end text-xs text-muted-foreground lg:block">
                    {b.lastTradeAt ? formatDateTime(b.lastTradeAt, lang) : t("e2_noTradesYet")}
                  </div>
                  <Chevron />
                </Link>
              ))}
              {/* mobile cards */}
              {filtered.map((b) => (
                <Link
                  key={`m-${b.symbol}`}
                  to="/market/$slug"
                  params={{ slug: b.slug }}
                  className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-secondary/40 md:hidden"
                >
                  <Monogram symbol={b.symbol} className="h-10 w-10" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-ink">{instrumentName(b, lang)}</span>
                      <ShariahPill status={b.shariahStatus} compact />
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <AssetClassBadge assetClass={b.assetClass} />
                      <span dir="ltr">{b.symbol}</span>
                      {b.sector ? ` · ${sectorLabel(b.sector, t)}` : ""}
                    </div>
                  </div>
                  <div className="text-end">
                    <PriceText mark={markOf(b)} className="text-sm font-semibold text-ink" />
                    <div className="text-xs"><ChangeText pct={b.change24hPct} /></div>
                  </div>
                </Link>
              ))}
              {filtered.length === 0 && (
                <div className="p-4">
                  <EmptyState
                    title={t("emptyTitle")}
                    description={assetClass !== "all" && classCounts[assetClass] === 0 ? t("u_classEmpty") : t("emptyDesc")}
                  />
                </div>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("e2_priceNote")}</p>
        </>
      )}
    </AppShell>
  );
}

function Chevron() {
  const { dir } = useI18n();
  const Icon = dir === "rtl" ? CaretLeft : CaretRight;
  return <Icon size={14} weight="bold" className="w-4 text-muted-foreground" aria-hidden />;
}

function MetricCard({ label, value, small }: { label: string; value: ReactNode; small?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card p-4 shadow-card">
      <dt className="truncate text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-1.5 font-semibold text-ink ${small ? "text-sm" : "text-xl"}`}>{value}</dd>
    </div>
  );
}
