import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TableStatus } from "@/components/live-region";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { getMyPortfolio } from "@/lib/trading/portfolio.functions";
import { cancelOrder, modifyOrder, restoreOrder } from "@/lib/trading/order-mutations.functions";
import { getBrand } from "@/lib/mock-data";
import { formatCurrency, formatPct } from "@/lib/format";
import { positionValue, unrealizedPnl, weight } from "@/lib/trading/calc";
import { StatusBadge } from "@/components/status-badge";
import { useMyRoles } from "@/hooks/use-my-roles";
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

function PortfolioPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { isTrader } = useMyRoles();
  const confirm = useConfirm();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const updateSearch = (patch: Partial<SearchState>) =>
    navigate({ search: (prev: SearchState) => ({ ...prev, ...patch }), replace: true });
  const fetchPortfolio = useServerFn(getMyPortfolio);
  const cancelFn = useServerFn(cancelOrder);
  const restoreFn = useServerFn(restoreOrder);
  const modifyFn = useServerFn(modifyOrder);
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

  const cash = Number(data.portfolio?.cash_balance ?? 0);
  const enriched = data.positions.map((p) => {
    const b = getBrand(p.symbol.toLowerCase());
    const last = b?.price ?? Number(p.avg_price);
    const qty = Number(p.qty);
    const avg = Number(p.avg_price);
    return {
      ...p, qty, avg, last,
      value: positionValue(qty, last),
      pnl: unrealizedPnl(qty, avg, last),
      brand: b,
    };
  });
  const positionsValue = enriched.reduce((s, p) => s + p.value, 0);
  const totalValue = cash + positionsValue;
  const totalPnl = enriched.reduce((s, p) => s + p.pnl, 0);

  const dir = search.sortDir === "asc" ? 1 : -1;
  const cmp = (a: number | string, b: number | string) =>
    (a < b ? -1 : a > b ? 1 : 0) * dir;

  const sortedPositions = (() => {
    const q = search.q.trim().toUpperCase();
    const filtered = q ? enriched.filter((p) => p.symbol.toUpperCase().includes(q)) : enriched.slice();
    return filtered.sort((a, b) => {
      switch (search.sortBy) {
        case "qty": return cmp(a.qty, b.qty);
        case "avg": return cmp(a.avg, b.avg);
        case "last": return cmp(a.last, b.last);
        case "pnl": return cmp(a.pnl, b.pnl);
        case "weight": return cmp(a.value, b.value);
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
        case "time": return cmp(a.created_at, b.created_at);
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

  // Exports exactly what the user is currently looking at: the active tab,
  // after search/filters and sorting, not the raw server payload.
  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows: string[] = [];
    if (tab === "positions") {
      rows.push(["symbol", "qty", "avg_price", "last_price", "value", "unrealized_pnl"].join(","));
      for (const p of sortedPositions) {
        rows.push([p.symbol, p.qty, p.avg, p.last, p.value.toFixed(2), p.pnl.toFixed(2)].map(esc).join(","));
      }
    } else {
      rows.push(["created_at", "symbol", "side", "type", "qty", "price", "filled_price", "status"].join(","));
      for (const o of filteredOrders) {
        rows.push([o.created_at, o.symbol, o.side, o.type, o.qty, o.price ?? "", o.filled_price ?? "", o.status].map(esc).join(","));
      }
    }
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const positionCols: { key: string; label: string; align?: "start"|"end" }[] = [
    { key: "symbol", label: "Symbol" },
    { key: "qty", label: t("qty"), align: "end" },
    { key: "avg", label: t("avgPrice"), align: "end" },
    { key: "last", label: t("lastPrice"), align: "end" },
    { key: "pnl", label: t("pnl"), align: "end" },
    { key: "weight", label: t("weight"), align: "end" },
  ];
  const orderCols: { key: string; label: string; align?: "start"|"end" }[] = [
    { key: "symbol", label: "Symbol" },
    { key: "side", label: t("orderType") },
    { key: "qty", label: t("qty"), align: "end" },
    { key: "price", label: t("price"), align: "end" },
    { key: "status", label: "Status", align: "end" },
    { key: "time", label: "Time", align: "end" },
  ];
  const SortHeader = ({ k, label, align }: { k: string; label: string; align?: "start"|"end" }) => (
    <button
      onClick={() => updateSearch({
        sortBy: k,
        sortDir: search.sortBy === k && search.sortDir === "asc" ? "desc" : "asc",
        page: 1,
      })}
      className={`inline-flex items-center gap-1 uppercase tracking-wider ${align === "end" ? "justify-end w-full" : ""} ${search.sortBy === k ? "text-[var(--gold-deep)]" : ""}`}
    >
      {label}{search.sortBy === k && <span>{search.sortDir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("portfolio")}
        title={t("portfolio")}
        description={`${t("myPositions")} · ${enriched.length}`}
        crumbs={[{ label: t("portfolio") }]}
        actions={
          <>
          <Link
            to="/portfolio/realized"
            search={{ from: "", to: "", symbol: "" }}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-[var(--gold-deep)]"
          >
            {t("realizedPnl")}
          </Link>
          <button
            onClick={exportCsv}
            disabled={activeList.length === 0}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-[var(--gold-deep)] disabled:opacity-40"
          >
            {t("exportCsv")}
          </button>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <KPI label={t("totalValue")} value={formatCurrency(totalValue, false, lang)} />
        <KPI label={t("cashAvailable")} value={formatCurrency(cash, false, lang)} />
        <KPI label={t("myPositions")} value={String(enriched.length)} />
        <KPI label={t("pnl")} value={formatCurrency(totalPnl, false, lang)} tone={totalPnl >= 0 ? "bull" : "bear"} />
      </div>

      {enriched.length > 0 && (
        <AllocationBar
          positions={enriched.map((p) => ({
            symbol: p.symbol,
            value: p.value,
            color: p.brand?.color ?? "var(--gold)",
          }))}
          total={positionsValue}
          label={t("weight")}
        />
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-border/60">
        {[["positions", t("tabPositions")], ["orders", t("tabOrders")]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => updateSearch({ tab: key as "positions"|"orders", page: 1 })}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition ${tab === key ? "border-[var(--gold-deep)] text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
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
          placeholder={t("searchOrders")}
          className="min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
        />
        {tab === "orders" && (
          <>
            <select value={search.status} onChange={(e) => updateSearch({ status: e.target.value, page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
              <option value="all">{t("filterAll")}</option>
              <option value="open">{t("statusOpen")}</option>
              <option value="partial">{t("statusPartial")}</option>
              <option value="filled">{t("filled")}</option>
              <option value="cancelled">{t("statusClosed")}</option>
            </select>
            <select value={search.side} onChange={(e) => updateSearch({ side: e.target.value, page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
              <option value="all">{t("filterAll")}</option>
              <option value="buy">{t("filterBuy")}</option>
              <option value="sell">{t("filterSell")}</option>
            </select>
          </>
        )}
        <select value={String(pageSize)} onChange={(e) => updateSearch({ pageSize: Number(e.target.value), page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} {t("rowsPerPage")}</option>)}
        </select>
      </div>

      {tab === "positions" ? (
        <section className="mb-8">
          {sortedPositions.length === 0 ? (
          <EmptyState
            title={t("emptyPositions")}
            description={t("emptyPositionsDesc")}
            action={<Link to="/market" className="rounded-md gold-gradient px-4 py-2 text-xs font-semibold text-ink">{t("nav_market")}</Link>}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
            <div className="hidden md:grid min-w-[720px] grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              {positionCols.map((c) => (
                <div key={c.key} className={c.align === "end" ? "text-end" : ""}>
                  <SortHeader k={c.key} label={c.label} align={c.align} />
                </div>
              ))}
              <div className="w-16" />
            </div>
            {pagedPositions.map((p) => (
              <div key={p.id}>
                <div className="hidden md:grid min-w-[720px] grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-sm last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">{lang === "ar" ? (p.brand?.nameAr ?? p.symbol) : (p.brand?.nameEn ?? p.symbol)}</div>
                  <div className="text-[10px] uppercase text-muted-foreground">{p.symbol} · {p.asset_class}</div>
                </div>
                <div className="text-end font-mono">{p.qty}</div>
                <div className="text-end font-mono text-muted-foreground">{p.avg.toFixed(2)}</div>
                <div className="text-end font-mono">{p.last.toFixed(2)}</div>
                <div className={`text-end font-mono ${p.pnl >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{formatPct((p.last - p.avg) / (p.avg || 1))}</div>
                <div className="text-end font-mono text-muted-foreground">{weight(p.value, positionsValue)}%</div>
                <div className="text-end">
                  {p.brand && (
                    <Link to="/trade/$symbol" params={{ symbol: p.brand.slug }} className="rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]">{t("nav_trade")}</Link>
                  )}
                </div>
                </div>
                {/* mobile card */}
                <div className="md:hidden border-b border-border/40 px-4 py-3 last:border-b-0">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{lang === "ar" ? (p.brand?.nameAr ?? p.symbol) : (p.brand?.nameEn ?? p.symbol)}</div>
                      <div className="text-[10px] uppercase text-muted-foreground">{p.symbol} · {p.asset_class}</div>
                    </div>
                    <div className={`shrink-0 font-mono text-xs ${p.pnl >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{formatPct((p.last - p.avg) / (p.avg || 1))}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div><span className="text-muted-foreground">{t("qty")}: </span>{p.qty}</div>
                    <div className="text-end"><span className="text-muted-foreground">{t("weight")}: </span>{weight(p.value, positionsValue)}%</div>
                    <div><span className="text-muted-foreground">{t("avgPrice")}: </span>{p.avg.toFixed(2)}</div>
                    <div className="text-end"><span className="text-muted-foreground">{t("lastPrice")}: </span>{p.last.toFixed(2)}</div>
                  </div>
                  {p.brand && (
                    <div className="mt-2 flex justify-end">
                      <Link to="/trade/$symbol" params={{ symbol: p.brand.slug }} className="rounded border border-border px-2 py-1 text-[10px] text-ink-soft">{t("nav_trade")}</Link>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <Pager page={safePage} pageCount={pageCount} onPage={(p) => updateSearch({ page: p })} t={t} />
          </div>
        )}
        </section>
      ) : (
        <section>
          {filteredOrders.length === 0 ? (
            <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
              <div className="hidden md:grid min-w-[820px] grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_1fr_1fr_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                {orderCols.map((c) => (
                  <div key={c.key} className={c.align === "end" ? "text-end" : ""}>
                    <SortHeader k={c.key} label={c.label} align={c.align} />
                  </div>
                ))}
                <div className="w-24" />
              </div>
              {pagedOrders.map((o) => (
                <div key={o.id}>
                <div className="hidden md:grid min-w-[820px] grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_1fr_1fr_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0">
                  <div className="font-mono font-semibold text-ink">{o.symbol}</div>
                  <div className={`font-mono ${o.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{o.side.toUpperCase()} · {o.type}</div>
                  <div className="text-end font-mono">{Number(o.qty)}</div>
                  <div className="text-end font-mono text-muted-foreground">{o.filled_price ? Number(o.filled_price).toFixed(2) : o.price ? Number(o.price).toFixed(2) : "—"}</div>
                  <div className="text-end"><StatusBadge status={o.status} /></div>
                  <div className="text-end font-mono text-muted-foreground">{new Date(o.created_at).toLocaleString(lang === "ar" ? "ar" : "en-US", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</div>
                  <div className="flex justify-end gap-1">
                    {isWorkingOrder(o.status) ? (
                      <>
                        {o.type === "limit" && (
                          <button disabled={!isTrader || modifyMut.isPending} title={!isTrader ? t("traderRequired") : undefined} onClick={() => setEditing({ id: o.id, qty: String(remainingQty(o)), price: o.price == null ? "" : Number(o.price).toFixed(2) })} className="rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)] disabled:opacity-40">{t("modifyOrder")}</button>
                        )}
                        <button disabled={cancelMut.isPending} onClick={() => askCancel(o.id, o.symbol, remainingQty(o))} className="rounded border border-[var(--bear)]/40 px-2 py-1 text-[10px] text-[var(--bear)] disabled:opacity-40">{t("cancelOrder")}</button>
                      </>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
                {/* mobile card */}
                <div className="md:hidden border-b border-border/40 px-4 py-3 last:border-b-0">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold text-ink">{o.symbol}</div>
                      <div className={`text-[10px] font-mono ${o.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{o.side.toUpperCase()} · {o.type}</div>
                    </div>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div><span className="text-muted-foreground">{t("qty")}: </span>{Number(o.qty)}</div>
                    <div className="text-end"><span className="text-muted-foreground">{t("price")}: </span>{o.filled_price ? Number(o.filled_price).toFixed(2) : o.price ? Number(o.price).toFixed(2) : "—"}</div>
                    <div className="col-span-2 text-muted-foreground">{new Date(o.created_at).toLocaleString(lang === "ar" ? "ar" : "en-US", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</div>
                  </div>
                  {isWorkingOrder(o.status) && (
                    <div className="mt-2 flex justify-end gap-1">
                      {o.type === "limit" && (
                        <button disabled={!isTrader || modifyMut.isPending} onClick={() => setEditing({ id: o.id, qty: String(remainingQty(o)), price: o.price == null ? "" : Number(o.price).toFixed(2) })} className="rounded border border-border px-2 py-1 text-[10px] text-ink-soft disabled:opacity-40">{t("modifyOrder")}</button>
                      )}
                      <button disabled={cancelMut.isPending} onClick={() => askCancel(o.id, o.symbol, remainingQty(o))} className="rounded border border-[var(--bear)]/40 px-2 py-1 text-[10px] text-[var(--bear)] disabled:opacity-40">{t("cancelOrder")}</button>
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
                <input type="number" inputMode="numeric" min="1" max="10000000" step="1" value={editing.qty} onChange={(e) => setEditing({ ...editing, qty: e.target.value })} aria-invalid={!!editQtyError} aria-describedby={editQtyError ? "modify-qty-error" : undefined} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-[var(--gold-deep)] focus:outline-none" />
              </label>
              {editQtyError && <p id="modify-qty-error" className="text-[10px] text-[var(--bear)]">{t(editQtyError)}</p>}
              <label className="text-[10px] uppercase text-muted-foreground">{t("price")}
                <input type="number" inputMode="decimal" min="0.01" step="0.01" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} aria-invalid={!!editPriceError} aria-describedby={editPriceError ? "modify-price-error" : undefined} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-[var(--gold-deep)] focus:outline-none" />
              </label>
              {editPriceError && <p id="modify-price-error" className="text-[10px] text-[var(--bear)]">{t(editPriceError)}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <button onClick={() => setEditing(null)} className="rounded border border-border px-3 py-1.5 text-xs text-ink-soft">{t("cancel")}</button>
                <button
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

function KPI({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${tone === "bull" ? "text-[var(--bull)]" : tone === "bear" ? "text-[var(--bear)]" : "text-ink"}`}>{value}</div>
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
  if (total <= 0) return null;
  const top = [...positions].sort((a, b) => b.value - a.value).slice(0, 8);
  const others = positions.length - top.length;
  const othersValue = positions.slice(top.length).reduce((s, p) => s + p.value, 0);
  const segments = [
    ...top.map((p) => ({ symbol: p.symbol, value: p.value, color: p.color })),
    ...(others > 0 ? [{ symbol: `+${others}`, value: othersValue, color: "var(--muted-foreground)" }] : []),
  ];
  return (
    <div className="mb-6 rounded-xl border border-border/60 bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-[10px] font-mono text-muted-foreground">{positions.length}</div>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
        {segments.map((s, i) => (
          <span
            key={`${s.symbol}-${i}`}
            title={`${s.symbol} · ${((s.value / total) * 100).toFixed(1)}%`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        {segments.map((s, i) => (
          <span key={`${s.symbol}-lg-${i}`} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
            <span className="font-mono text-ink-soft">{s.symbol}</span>
            <span>{((s.value / total) * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Pager({ page, pageCount, onPage, t }: { page: number; pageCount: number; onPage: (p: number) => void; t: (k: never) => string }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-border/40 px-4 py-2 text-[11px] text-muted-foreground">
      <span>{t("page" as never)} {page} {t("of" as never)} {pageCount}</span>
      <div className="flex gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">{t("prev" as never)}</button>
        <button disabled={page >= pageCount} onClick={() => onPage(page + 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">{t("next" as never)}</button>
      </div>
    </div>
  );
}