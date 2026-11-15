import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TableStatus } from "@/components/live-region";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n, type Key } from "@/lib/i18n";
import { getMyPortfolio, type MarkSource, type ValuedPosition } from "@/lib/trading/portfolio.functions";
import { cancelOrder, modifyOrder, restoreOrder } from "@/lib/trading/order-mutations.functions";
import { formatDateTime, instrumentName, monogramColor } from "@/components/market-data";
import { weight } from "@/lib/trading/calc";
import { Num } from "@/components/num";
import { StatusBadge } from "@/components/status-badge";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useAccountStatus } from "@/hooks/use-account-status";
import { useConfirm } from "@/components/confirm-dialog";
import { useErrorMessage } from "@/hooks/use-error-message";
import { describeOrderOutcome, isWorkingOrder, validatePrice, validateQty, type OrderOutcome } from "@/components/order-outcome";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const SearchSchema = z.object({
  tab: z.enum(["positions", "orders"]).catch("positions").default("positions"),
  q: z.string().catch("").default(""),
  status: z.string().catch("all").default("all"),
  side: z.string().catch("all").default("all"),
  sortBy: z.string().catch("symbol").default("symbol"),
  sortDir: z.enum(["asc", "desc"]).catch("asc").default("asc"),
  page: z.coerce.number().int().catch(1).default(1),
  pageSize: z.coerce.number().int().catch(25).default(25),
});
type SearchState = z.infer<typeof SearchSchema>;

export const Route = createFileRoute("/_authenticated/portfolio")({
  validateSearch: (s: Record<string, unknown>) => SearchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "المحفظة — وحدة القيمة | Portfolio — Value Unit" },
      { name: "description", content: "مراكزك، رصيدك النقدي، وسجل أوامرك." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: PortfolioPage,
});

/** Plain decimal for CSV exports (no grouping, fixed decimals); empty when missing. */
function csvNum(n: number | null | undefined, decimals: number): string {
  if (n == null || !Number.isFinite(n)) return "";
  const s = n.toFixed(decimals);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

function PortfolioPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { isTrader, isLoading: rolesLoading } = useMyRoles();
  const notActivated = !rolesLoading && !isTrader;
  // A review hold pauses trading: buying power and trade links are not shown.
  const onHold = useAccountStatus().data?.onHold === true;
  const confirm = useConfirm();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const updateSearch = (patch: Partial<SearchState>) =>
    navigate({ search: (prev: SearchState) => ({ ...prev, ...patch }), replace: true });
  const fetchPortfolio = useServerFn(getMyPortfolio);
  const cancelFn = useServerFn(cancelOrder);
  const restoreFn = useServerFn(restoreOrder);
  const modifyFn = useServerFn(modifyOrder);
  // Holdings arrive valued by the server from the database: the last traded
  // price, else the band reference price (labelled), else no price at all.
  // The investor's own average cost is never used as a market price.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => fetchPortfolio(),
    staleTime: 15_000,
  });
  const [editing, setEditing] = useState<null | { id: string; qty: string; price: string }>(null);
  const errorMessage = useErrorMessage();
  // Cancel, modify and restore all change the working order set: every
  // view of it (portfolio, trade-page open orders, the book) refreshes.
  const refreshOrders = () => {
    qc.invalidateQueries({ queryKey: ["portfolio"] });
    qc.invalidateQueries({ queryKey: ["open-orders"] });
    qc.invalidateQueries({ queryKey: ["book"] });
  };
  const announce = (res: unknown, qty: number) => {
    const o = describeOrderOutcome(res as OrderOutcome, qty, t);
    if (o.tone === "error") toast.error(o.message);
    else if (o.tone === "warning") toast.warning(o.message);
    else toast.success(o.message);
  };
  const tab = search.tab;
  const pageSize = Math.max(5, Math.min(100, search.pageSize));
  const page = Math.max(1, search.page);

  const cancelMut = useMutation({
    mutationFn: (v: { orderId: string; remaining: number }) => cancelFn({ data: { orderId: v.orderId } }),
    onSuccess: (_res, v) => {
      refreshOrders();
      toast.success(t("orderCancelled"), {
        action: {
          label: t("undo"),
          onClick: async () => {
            // Undo re-places the remaining quantity as a NEW order through
            // the full checks, so it can fail (e.g. cash already used).
            try {
              const res = await restoreFn({ data: { orderId: v.orderId } });
              announce(res, v.remaining);
            } catch (e) {
              toast.error(`${t("undoFailed")}: ${errorMessage(e)}`);
            } finally {
              refreshOrders();
            }
          },
        },
      });
    },
    onError: (e: unknown) => {
      toast.error(errorMessage(e));
      refreshOrders();
    },
  });
  const askCancel = async (orderId: string, symbol: string, remaining: number) => {
    const ok = await confirm({
      title: t("cancelOrder"),
      description: `${symbol} — ${t("onlyPendingEditable")}`,
      confirmLabel: t("cancelOrder"),
      cancelLabel: t("keepOrder"),
      tone: "danger",
    });
    if (ok) cancelMut.mutate({ orderId, remaining });
  };
  const modifyMut = useMutation({
    mutationFn: (v: { orderId: string; qty: number; price: number }) => modifyFn({ data: v }),
    onSuccess: (res, v) => {
      // The old order is cancelled and a new one placed (new id).
      announce(res, v.qty);
      setEditing(null);
      refreshOrders();
    },
    onError: (e: unknown) => {
      toast.error(errorMessage(e));
      refreshOrders();
    },
  });
  const editQtyError = editing ? validateQty(editing.qty) : null;
  const editPriceError = editing ? validatePrice(editing.price) : null;

  if (isLoading) {
    return (
      <AppShell>
        <div className="space-y-4">
          <LuxurySkeleton lines={2} className="max-w-md" />
          <LuxurySkeleton lines={6} />
        </div>
      </AppShell>
    );
  }
  if (isError || !data) {
    return (<AppShell><div className="py-16"><ErrorState reset={() => refetch()} /></div></AppShell>);
  }

  const summary = data.summary;
  const positions = data.positions;
  const displayName = (p: ValuedPosition) =>
    p.name_ar || p.name_en ? instrumentName({ nameAr: p.name_ar ?? "", nameEn: p.name_en ?? "" }, lang) : p.symbol;
  const hasReference = positions.some((p) => p.mark_source === "reference");
  const unpriced = positions.filter((p) => p.mark_source === "none").length;
  const pnlTone = (n: number | null | undefined) =>
    n == null || n === 0 ? "text-ink" : n > 0 ? "text-[var(--bull)]" : "text-[var(--bear)]";
  const markTag = (p: ValuedPosition) => {
    const tag = (label: string, hint: string) => (
      <span className="ms-1 whitespace-nowrap rounded border border-border px-1 text-[9px] font-medium text-muted-foreground" title={hint}>
        {label}
      </span>
    );
    if (p.mark_source === "reference") return tag(t("e2_refShort"), t("e2_referencePriceHint"));
    if (p.mark_source === "last" && !p.published) return tag(t("m_notListedShort"), t("m_notListedHint"));
    return null;
  };

  const dir = search.sortDir === "asc" ? 1 : -1;
  const cmp = (a: number | string, b: number | string) =>
    (a < b ? -1 : a > b ? 1 : 0) * dir;
  // Missing values (no market price) always sort last.
  const cmpN = (a: number | null, b: number | null) =>
    a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : cmp(a, b);

  const sortedPositions = (() => {
    const q = search.q.trim().toUpperCase();
    const filtered = q
      ? positions.filter((p) => p.symbol.toUpperCase().includes(q) || displayName(p).toUpperCase().includes(q))
      : positions.slice();
    return filtered.sort((a, b) => {
      switch (search.sortBy) {
        case "qty": return cmp(a.qty, b.qty);
        case "avg": return cmp(a.avg_price, b.avg_price);
        case "mark": return cmpN(a.mark_price, b.mark_price);
        case "value":
        case "weight": return cmpN(a.market_value, b.market_value);
        case "pnl": return cmpN(a.unrealized_pnl, b.unrealized_pnl);
        default: return cmp(a.symbol, b.symbol);
      }
    });
  })();

  const filteredOrders = (() => {
    const q = search.q.trim().toUpperCase();
    const list = data.orders.filter((o) => {
      if (search.status !== "all" && !matchesStatusFilter(o.status, search.status)) return false;
      if (search.side !== "all" && o.side !== search.side) return false;
      if (q && !o.symbol.toUpperCase().includes(q)) return false;
      return true;
    });
    return list.sort((a, b) => {
      switch (search.sortBy) {
        case "side": return cmp(a.side, b.side);
        case "qty": return cmp(Number(a.qty), Number(b.qty));
        case "price": return cmp(Number(a.price ?? a.filled_price ?? 0), Number(b.price ?? b.filled_price ?? 0));
        case "status": return cmp(a.status, b.status);
        case "time": return cmp(Date.parse(a.created_at), Date.parse(b.created_at));
        default: return cmp(a.symbol, b.symbol);
      }
    });
  })();

  const activeList = tab === "positions" ? sortedPositions : filteredOrders;
  const pageCount = Math.max(1, Math.ceil(activeList.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedPositions = tab === "positions" ? sortedPositions.slice(pageStart, pageStart + pageSize) : [];
  const pagedOrders = tab === "orders" ? filteredOrders.slice(pageStart, pageStart + pageSize) : [];
  const weightOf = (p: ValuedPosition) =>
    p.market_value == null || summary.marketValue <= 0 ? null : weight(p.market_value, summary.marketValue);

  // Exports exactly what the user is currently looking at: the active tab,
  // after search/filters and sorting, not the raw server payload.
  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows: string[] = [];
    if (tab === "positions") {
      rows.push([
        "symbol", "qty", "reserved_in_sell_orders", "avg_cost", "cost_basis", "market_price", "price_source",
        "market_value", "unrealized_pnl", "unrealized_pct", "weight_pct",
      ].join(","));
      for (const p of sortedPositions) {
        rows.push([
          p.symbol, p.qty, p.reserved_qty, csvNum(p.avg_price, 4), csvNum(p.cost_basis, 2), csvNum(p.mark_price, 2),
          p.mark_source, csvNum(p.market_value, 2), csvNum(p.unrealized_pnl, 2), csvNum(p.unrealized_pct, 2),
          csvNum(weightOf(p), 2),
        ].map(esc).join(","));
      }
    } else {
      rows.push(["created_at", "symbol", "side", "type", "qty", "filled_qty", "limit_price", "avg_fill_price", "status"].join(","));
      for (const o of filteredOrders) {
        rows.push([
          o.created_at, o.symbol, o.side, o.type, o.qty, o.filled_qty ?? 0,
          o.price == null ? "" : csvNum(Number(o.price), 2),
          o.filled_price == null ? "" : csvNum(Number(o.filled_price), 4),
          o.status,
        ].map(esc).join(","));
      }
    }
    const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const positionCols: { key: string; label: string; align?: "start" | "end" }[] = [
    { key: "symbol", label: t("m_colInstrument") },
    { key: "qty", label: t("qty"), align: "end" },
    { key: "avg", label: t("m_avgCost"), align: "end" },
    { key: "mark", label: t("m_markPrice"), align: "end" },
    { key: "value", label: t("m_marketValue"), align: "end" },
    { key: "pnl", label: t("m_unrealizedPnl"), align: "end" },
    { key: "weight", label: t("weight"), align: "end" },
  ];
  const orderCols: { key: string; label: string; align?: "start" | "end" }[] = [
    { key: "symbol", label: t("e2_colSymbol") },
    { key: "side", label: t("orderType") },
    { key: "qty", label: t("m_colFilledOfQty"), align: "end" },
    { key: "price", label: t("m_colPriceAvgFill"), align: "end" },
    { key: "status", label: t("filterStatus"), align: "end" },
    { key: "time", label: t("e2_colTime"), align: "end" },
  ];
  const SortHeader = ({ k, label, align }: { k: string; label: string; align?: "start" | "end" }) => (
    <button
      type="button"
      onClick={() => updateSearch({
        sortBy: k,
        sortDir: search.sortBy === k && search.sortDir === "asc" ? "desc" : "asc",
        page: 1,
      })}
      aria-sort={search.sortBy === k ? (search.sortDir === "asc" ? "ascending" : "descending") : undefined}
      className={`inline-flex items-center gap-1 uppercase tracking-wider ${align === "end" ? "w-full justify-end" : ""} ${search.sortBy === k ? "text-[var(--gold-deep)]" : ""}`}
    >
      {label}{search.sortBy === k && <span aria-hidden>{search.sortDir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
  const orderPrice = (o: (typeof data.orders)[number]) => (
    <>
      {o.price == null ? <span>{t("market")}</span> : <Num value={Number(o.price)} />}
      {Number(o.filled_qty ?? 0) > 0 && o.filled_price != null && (
        <span className="block text-[10px] text-muted-foreground">
          {t("m_avgFillShort")} <Num value={Number(o.filled_price)} decimals={4} />
        </span>
      )}
    </>
  );
  const orderQty = (o: (typeof data.orders)[number]) => (
    <><Num value={Number(o.filled_qty ?? 0)} kind="qty" /> / <Num value={Number(o.qty)} kind="qty" /></>
  );

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("portfolio")}
        title={t("portfolio")}
        description={`${t("myPositions")} · ${positions.length}`}
        crumbs={[{ label: t("portfolio") }]}
        actions={
          <>
          <Link
            to="/portfolio/realized"
            search={{ from: "", to: "", symbol: "" }}
            className="inline-flex min-h-9 items-center rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-[var(--gold-deep)]"
          >
            {t("realizedPnl")}
          </Link>
          <button
            type="button"
            onClick={exportCsv}
            disabled={activeList.length === 0}
            className="min-h-9 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-[var(--gold-deep)] disabled:opacity-40"
          >
            {t("exportCsv")}
          </button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI
          label={t("totalValue")}
          value={<Num value={summary.totalValue} kind="currency" />}
          hint={t("m_totalValueHint")}
        />
        <KPI
          label={t("m_buyingPower")}
          value={onHold ? <Num value={null} /> : <Num value={summary.buyingPower} kind="currency" />}
          hint={
            <>
              {onHold && <span className="block font-medium text-[var(--bear)]">{t("fx3_onHoldShort")}</span>}
              <span className="block">{t("m_cashBalance")} <Num value={summary.cash} kind="currency" /></span>
              <span className="block">{t("m_reservedByOrders")} <Num value={summary.reserved} kind="currency" /></span>
            </>
          }
        />
        <KPI
          label={t("m_holdingsValue")}
          value={<Num value={summary.marketValue} kind="currency" />}
          hint={<>{t("costBasis")} <Num value={summary.pricedCostBasis} kind="currency" /></>}
        />
        <KPI
          label={t("m_unrealizedPnl")}
          value={<Num value={summary.unrealizedPnl} kind="currency" signed />}
          tone={pnlTone(summary.unrealizedPnl)}
          hint={summary.unrealizedPct == null ? undefined : <Num value={summary.unrealizedPct} kind="pct" signed />}
        />
      </div>

      {positions.length > 0 && (
        <div className="mb-4 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
          <p>{t("m_valuationNote")}{hasReference ? ` ${t("e2_valuationReferenceNote")}` : ""}</p>
          {unpriced > 0 && (
            <p className="text-[var(--bear)]">{t("m_unpricedNote").replace("{n}", String(unpriced))}</p>
          )}
        </div>
      )}

      {summary.marketValue > 0 && (
        <AllocationBar
          positions={positions
            .filter((p) => p.market_value != null && p.market_value > 0)
            .map((p) => ({ symbol: p.symbol, value: p.market_value as number, color: monogramColor(p.symbol) }))}
          total={summary.marketValue}
          label={t("weight")}
        />
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-border/60" role="tablist" aria-label={t("portfolio")}>
        {[["positions", t("tabPositions")], ["orders", t("tabOrders")]].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => updateSearch({ tab: key as "positions" | "orders", page: 1, sortBy: key === "positions" ? "symbol" : "time", sortDir: key === "positions" ? "asc" : "desc" })}
            className={`min-h-10 border-b-2 px-3 py-2 text-sm font-medium transition ${tab === key ? "border-[var(--gold-deep)] text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
          >{label}</button>
        ))}
      </div>

      {/* Shared filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TableStatus
          count={activeList.length}
          sortLabel={
            (tab === "positions" ? positionCols : orderCols).find((c) => c.key === search.sortBy)?.label ??
            search.sortBy
          }
          sortDir={search.sortDir === "desc" ? "desc" : "asc"}
          labels={{ results: t("a11yResults"), sortedBy: t("a11ySortedBy"), asc: t("sortAsc"), desc: t("sortDesc") }}
        />
        <input
          value={search.q}
          onChange={(e) => updateSearch({ q: e.target.value, page: 1 })}
          placeholder={tab === "positions" ? t("fx3_searchPositions") : t("searchOrders")}
          aria-label={tab === "positions" ? t("fx3_searchPositions") : t("searchOrders")}
          className="min-w-0 flex-1 basis-full rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none sm:basis-[220px]"
        />
        {tab === "orders" && (
          <>
            <select aria-label={t("filterStatus")} value={search.status} onChange={(e) => updateSearch({ status: e.target.value, page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
              <option value="all">{t("filterAll")}</option>
              <option value="open">{t("statusOpen")}</option>
              <option value="partial">{t("statusPartial")}</option>
              <option value="filled">{t("filled")}</option>
              <option value="cancelled">{t("statusClosed")}</option>
            </select>
            <select aria-label={t("orderType")} value={search.side} onChange={(e) => updateSearch({ side: e.target.value, page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
              <option value="all">{t("filterAll")}</option>
              <option value="buy">{t("filterBuy")}</option>
              <option value="sell">{t("filterSell")}</option>
            </select>
          </>
        )}
        <select aria-label={t("rowsPerPage")} value={String(pageSize)} onChange={(e) => updateSearch({ pageSize: Number(e.target.value), page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} {t("rowsPerPage")}</option>)}
        </select>
        {tab === "positions" && (
          <select
            aria-label={t("a11ySortedBy")}
            value={`${search.sortBy}:${search.sortDir}`}
            onChange={(e) => {
              const [sortBy, sortDir] = e.target.value.split(":");
              updateSearch({ sortBy, sortDir: sortDir === "desc" ? "desc" : "asc", page: 1 });
            }}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs md:hidden"
          >
            {positionCols.flatMap((c) => [
              <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} ▲</option>,
              <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} ▼</option>,
            ])}
          </select>
        )}
      </div>

      {tab === "positions" ? (
        <section className="mb-8">
          {sortedPositions.length === 0 ? (
          <EmptyState
            title={t("emptyPositions")}
            description={onHold ? t("fx3_tradeOnHold") : notActivated ? t("fx3_tradeNotActivated") : t("emptyPositionsDesc")}
            action={
              !onHold && notActivated ? (
                <Link to="/request-access" search={{ kind: "invest" }} className="rounded-md gold-gradient px-4 py-2 text-xs font-semibold text-ink">{t("fx3_tradeNotActivatedCta")}</Link>
              ) : (
                <Link to="/market" className="rounded-md gold-gradient px-4 py-2 text-xs font-semibold text-ink">{t("nav_market")}</Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
            <div className="hidden min-w-[900px] grid-cols-[minmax(0,2fr)_repeat(6,minmax(0,1fr))_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground md:grid">
              {positionCols.map((c) => (
                <div key={c.key} className={c.align === "end" ? "text-end" : ""}>
                  <SortHeader k={c.key} label={c.label} align={c.align} />
                </div>
              ))}
              <div className="w-16" />
            </div>
            {pagedPositions.map((p) => {
              const w = weightOf(p);
              const trade = p.published && p.slug && !onHold ? (
                <Link to="/trade/$symbol" params={{ symbol: p.slug }} className="inline-flex min-h-8 items-center rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]">{t("nav_trade")}</Link>
              ) : null;
              return (
              <div key={p.symbol}>
                <div className="hidden min-w-[900px] grid-cols-[minmax(0,2fr)_repeat(6,minmax(0,1fr))_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-sm last:border-b-0 md:grid">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{displayName(p)}</div>
                    <div className="text-[10px] uppercase text-muted-foreground">{p.symbol}</div>
                  </div>
                  <div className="text-end font-mono">
                    <Num value={p.qty} kind="qty" />
                    {p.reserved_qty > 0 && (
                      <span className="block text-[10px] text-muted-foreground">
                        {t("m_inSellOrders")} <Num value={p.reserved_qty} kind="qty" />
                      </span>
                    )}
                  </div>
                  <div className="text-end font-mono text-muted-foreground"><Num value={p.avg_price} decimals={p.avg_price === Math.round(p.avg_price * 100) / 100 ? 2 : 4} /></div>
                  <div className="text-end font-mono">
                    {p.mark_price == null ? <NoPrice t={t} /> : <><Num value={p.mark_price} />{markTag(p)}</>}
                  </div>
                  <div className="text-end font-mono"><Num value={p.market_value} kind="currency" /></div>
                  <div className={`text-end font-mono ${pnlTone(p.unrealized_pnl)}`}>
                    <Num value={p.unrealized_pnl} kind="currency" signed />
                    <span className="block text-[10px]"><Num value={p.unrealized_pct} kind="pct" signed /></span>
                  </div>
                  <div className="text-end font-mono text-muted-foreground"><Num value={w} kind="pct" /></div>
                  <div className="w-16 text-end">{trade}</div>
                </div>
                {/* mobile card */}
                <div className="border-b border-border/40 px-4 py-3 last:border-b-0 md:hidden">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{displayName(p)}</div>
                      <div className="text-[10px] uppercase text-muted-foreground">{p.symbol}</div>
                    </div>
                    <div className={`shrink-0 text-end font-mono text-xs ${pnlTone(p.unrealized_pnl)}`}>
                      <Num value={p.unrealized_pnl} kind="currency" signed />
                      <span className="block text-[10px]"><Num value={p.unrealized_pct} kind="pct" signed /></span>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <CardStat label={t("qty")} value={<Num value={p.qty} kind="qty" />} />
                    <CardStat label={t("m_marketValue")} value={<Num value={p.market_value} kind="currency" />} end />
                    <CardStat label={t("m_avgCost")} value={<Num value={p.avg_price} decimals={p.avg_price === Math.round(p.avg_price * 100) / 100 ? 2 : 4} />} />
                    <CardStat
                      label={t("m_markPrice")}
                      value={p.mark_price == null ? <NoPrice t={t} /> : <><Num value={p.mark_price} />{markTag(p)}</>}
                      end
                    />
                    <CardStat label={t("costBasis")} value={<Num value={p.cost_basis} kind="currency" />} />
                    <CardStat label={t("weight")} value={<Num value={w} kind="pct" />} end />
                    {p.reserved_qty > 0 && (
                      <CardStat label={t("m_availableUnits")} value={<Num value={Math.max(0, p.qty - p.reserved_qty)} kind="qty" />} />
                    )}
                  </dl>
                  {trade && <div className="mt-2 flex justify-end">{trade}</div>}
                </div>
              </div>
              );
            })}
            <Pager page={safePage} pageCount={pageCount} onPage={(p) => updateSearch({ page: p })} t={t} />
          </div>
        )}
        </section>
      ) : (
        <section>
          {filteredOrders.length === 0 ? (
            <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} hint={t("emptyHint")} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
              <div className="hidden min-w-[860px] grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_1fr_1.2fr_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground md:grid">
                {orderCols.map((c) => (
                  <div key={c.key} className={c.align === "end" ? "text-end" : ""}>
                    <SortHeader k={c.key} label={c.label} align={c.align} />
                  </div>
                ))}
                <div className="w-24" />
              </div>
              {pagedOrders.map((o) => (
                <div key={o.id}>
                <div className="hidden min-w-[860px] grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_1fr_1.2fr_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0 md:grid">
                  <div className="font-mono font-semibold text-ink">{o.symbol}</div>
                  <div className={`font-mono ${o.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{o.side === "buy" ? t("buy") : t("sell")} · {o.type === "market" ? t("market") : t("limit")}</div>
                  <div className="text-end font-mono">{orderQty(o)}</div>
                  <div className="text-end font-mono text-muted-foreground">{orderPrice(o)}</div>
                  <div className="text-end"><StatusBadge status={o.status} /></div>
                  <div className="text-end text-muted-foreground">{formatDateTime(o.created_at, lang)}</div>
                  <div className="flex w-24 justify-end gap-1">
                    {isWorkingOrder(o.status) ? (
                      <>
                        {o.type === "limit" && (
                          <button type="button" disabled={!isTrader || modifyMut.isPending} title={!isTrader ? t("traderRequired") : undefined} onClick={() => setEditing({ id: o.id, qty: String(remainingQty(o)), price: o.price == null ? "" : Number(o.price).toFixed(2) })} className="rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)] disabled:opacity-40">{t("modifyOrder")}</button>
                        )}
                        <button type="button" disabled={cancelMut.isPending} onClick={() => askCancel(o.id, o.symbol, remainingQty(o))} className="rounded border border-[var(--bear)]/40 px-2 py-1 text-[10px] text-[var(--bear)] disabled:opacity-40">{t("cancelOrder")}</button>
                      </>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
                {/* mobile card */}
                <div className="border-b border-border/40 px-4 py-3 last:border-b-0 md:hidden">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold text-ink">{o.symbol}</div>
                      <div className={`text-[10px] font-mono ${o.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{o.side === "buy" ? t("buy") : t("sell")} · {o.type === "market" ? t("market") : t("limit")}</div>
                    </div>
                    <StatusBadge status={o.status} />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <CardStat label={t("m_colFilledOfQty")} value={orderQty(o)} />
                    <CardStat label={t("m_colPriceAvgFill")} value={orderPrice(o)} end />
                  </dl>
                  <div className="mt-1 text-[10px] text-muted-foreground">{formatDateTime(o.created_at, lang)}</div>
                  {isWorkingOrder(o.status) && (
                    <div className="mt-2 flex justify-end gap-1">
                      {o.type === "limit" && (
                        <button type="button" disabled={!isTrader || modifyMut.isPending} onClick={() => setEditing({ id: o.id, qty: String(remainingQty(o)), price: o.price == null ? "" : Number(o.price).toFixed(2) })} className="min-h-8 rounded border border-border px-2 py-1 text-[10px] text-ink-soft disabled:opacity-40">{t("modifyOrder")}</button>
                      )}
                      <button type="button" disabled={cancelMut.isPending} onClick={() => askCancel(o.id, o.symbol, remainingQty(o))} className="min-h-8 rounded border border-[var(--bear)]/40 px-2 py-1 text-[10px] text-[var(--bear)] disabled:opacity-40">{t("cancelOrder")}</button>
                    </div>
                  )}
                </div>
              </div>
              ))}
              <Pager page={safePage} pageCount={pageCount} onPage={(p) => updateSearch({ page: p })} t={t} />
            </div>
          )}
        </section>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("modifyOrder")}</DialogTitle>
              <DialogDescription>{t("modifyOrderDesc")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <label className="text-[10px] uppercase text-muted-foreground">{t("qty")}
                <input type="number" inputMode="numeric" dir="ltr" min="1" max="10000000" step="1" value={editing.qty} onChange={(e) => setEditing({ ...editing, qty: e.target.value })} aria-invalid={!!editQtyError} aria-describedby={editQtyError ? "modify-qty-error" : undefined} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-[var(--gold-deep)] focus:outline-none" />
              </label>
              {editQtyError && <p id="modify-qty-error" className="text-[10px] text-[var(--bear)]">{t(editQtyError)}</p>}
              <label className="text-[10px] uppercase text-muted-foreground">{t("price")}
                <input type="number" inputMode="decimal" dir="ltr" min="0.01" step="0.01" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} aria-invalid={!!editPriceError} aria-describedby={editPriceError ? "modify-price-error" : undefined} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-[var(--gold-deep)] focus:outline-none" />
              </label>
              {editPriceError && <p id="modify-price-error" className="text-[10px] text-[var(--bear)]">{t(editPriceError)}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className="rounded border border-border px-3 py-1.5 text-xs text-ink-soft">{t("cancel")}</button>
                <button
                  type="button"
                  disabled={modifyMut.isPending || !!editQtyError || !!editPriceError}
                  onClick={() => modifyMut.mutate({ orderId: editing.id, qty: Number(editing.qty), price: Number(editing.price) })}
                  className="rounded-md gold-gradient px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
                >{t("submit")}</button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </AppShell>
  );
}

function remainingQty(o: { qty: number | string; filled_qty?: number | string | null }): number {
  return Math.max(0, Number(o.qty) - Number(o.filled_qty ?? 0));
}

/** Status filter buckets; legacy "modified" orders are closed, like cancelled ones. */
function matchesStatusFilter(status: string, filter: string): boolean {
  if (filter === "open") return status === "open" || status === "pending";
  if (filter === "cancelled") return status === "cancelled" || status === "modified";
  return status === filter;
}

/** A holding with no market price: shown as such, never at the investor's cost. */
function NoPrice({ t }: { t: (k: Key) => string }) {
  return (
    <span className="whitespace-nowrap text-[10px] text-muted-foreground" title={t("m_noPriceHint")}>
      {t("m_noPrice")}
    </span>
  );
}

function CardStat({ label, value, end }: { label: string; value: ReactNode; end?: boolean }) {
  return (
    <div className={`min-w-0 ${end ? "text-end" : ""}`}>
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className="font-mono text-ink">{value}</dd>
    </div>
  );
}

function KPI({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-card p-3 sm:p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 break-words font-mono text-base font-semibold sm:text-lg ${tone ?? "text-ink"}`}>{value}</div>
      {hint && <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{hint}</div>}
    </div>
  );
}

function AllocationBar({
  positions,
  total,
  label,
}: {
  positions: { symbol: string; value: number; color: string }[];
  total: number;
  label: string;
}) {
  if (total <= 0 || positions.length === 0) return null;
  const sorted = [...positions].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 8);
  const others = sorted.length - top.length;
  const othersValue = sorted.slice(top.length).reduce((s, p) => s + p.value, 0);
  const segments = [
    ...top.map((p) => ({ symbol: p.symbol, value: p.value, color: p.color })),
    ...(others > 0 ? [{ symbol: `+${others}`, value: othersValue, color: "var(--muted-foreground)" }] : []),
  ];
  return (
    <div className="mb-6 rounded-xl border border-border/60 bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-[10px] font-mono text-muted-foreground"><Num value={positions.length} kind="qty" /></div>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary" dir="ltr">
        {segments.map((s) => (
          <span
            key={s.symbol}
            title={`${s.symbol} · ${((s.value / total) * 100).toFixed(1)}%`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        {segments.map((s) => (
          <span key={s.symbol} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
            <span className="font-mono text-ink-soft">{s.symbol}</span>
            <Num value={(s.value / total) * 100} kind="pct" decimals={1} />
          </span>
        ))}
      </div>
    </div>
  );
}

function Pager({ page, pageCount, onPage, t }: { page: number; pageCount: number; onPage: (p: number) => void; t: (k: Key) => string }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-border/40 px-4 py-2 text-[11px] text-muted-foreground">
      <span>{t("page")} <Num value={page} kind="qty" /> {t("of")} <Num value={pageCount} kind="qty" /></span>
      <div className="flex gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="min-h-8 rounded border border-border px-2 py-1 disabled:opacity-40">{t("prev")}</button>
        <button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)} className="min-h-8 rounded border border-border px-2 py-1 disabled:opacity-40">{t("next")}</button>
      </div>
    </div>
  );
}
