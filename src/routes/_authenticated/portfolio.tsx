import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { getMyPortfolio } from "@/lib/trading/portfolio.functions";
import { cancelOrder, modifyOrder } from "@/lib/trading/order-mutations.functions";
import { getBrand } from "@/lib/mock-data";
import { formatCurrency, formatPct } from "@/lib/format";
import { positionValue, unrealizedPnl, weight } from "@/lib/trading/calc";
import { StatusBadge } from "@/components/status-badge";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useConfirm } from "@/components/confirm-dialog";
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
      { title: "المحفظة — قيمة | Portfolio — Value Unit" },
      { name: "description", content: "مراكزك، رصيدك النقدي، وسجل أوامرك." },
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
  const modifyFn = useServerFn(modifyOrder);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => fetchPortfolio(),
    staleTime: 15_000,
  });
  const [editing, setEditing] = useState<null | { id: string; qty: number; price: number }>(null);
  const tab = search.tab;
  const pageSize = Math.max(5, Math.min(100, search.pageSize));
  const page = Math.max(1, search.page);

  const cancelMut = useMutation({
    mutationFn: (orderId: string) => cancelFn({ data: { orderId } }),
    onSuccess: () => { toast.success(t("orderCancelled")); qc.invalidateQueries({ queryKey: ["portfolio"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });
  const askCancel = async (orderId: string, symbol: string) => {
    const ok = await confirm({
      title: t("cancelOrder"),
      description: `${symbol} — ${t("onlyPendingEditable")}`,
      confirmLabel: t("cancelOrder"),
      cancelLabel: t("cancelled"),
      tone: "danger",
    });
    if (ok) cancelMut.mutate(orderId);
  };
  const modifyMut = useMutation({
    mutationFn: (v: { orderId: string; qty: number; price: number }) => modifyFn({ data: v }),
    onSuccess: () => { toast.success(t("orderModified")); setEditing(null); qc.invalidateQueries({ queryKey: ["portfolio"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });

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

  const sortedPositions = useMemo(() => {
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
  }, [enriched, search.q, search.sortBy, dir]);

  const filteredOrders = useMemo(() => {
    const q = search.q.trim().toUpperCase();
    const list = data.orders.filter((o) => {
      if (search.status !== "all" && o.status !== search.status) return false;
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
  }, [data.orders, search.q, search.status, search.side, search.sortBy, dir]);

  const activeList = tab === "positions" ? sortedPositions : filteredOrders;
  const pageCount = Math.max(1, Math.ceil(activeList.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedPositions = tab === "positions" ? sortedPositions.slice(pageStart, pageStart + pageSize) : [];
  const pagedOrders = tab === "orders" ? filteredOrders.slice(pageStart, pageStart + pageSize) : [];

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
              <option value="filled">{t("filled")}</option>
              <option value="pending">{t("pending")}</option>
              <option value="modified">{t("modified")}</option>
              <option value="cancelled">{t("cancelled")}</option>
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
            <div className="grid min-w-[720px] grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              {positionCols.map((c) => (
                <div key={c.key} className={c.align === "end" ? "text-end" : ""}>
                  <SortHeader k={c.key} label={c.label} align={c.align} />
                </div>
              ))}
              <div className="w-16" />
            </div>
            {pagedPositions.map((p) => (
              <div key={p.id} className="grid min-w-[720px] grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-sm last:border-b-0">
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
              <div className="grid min-w-[820px] grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_1fr_1fr_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                {orderCols.map((c) => (
                  <div key={c.key} className={c.align === "end" ? "text-end" : ""}>
                    <SortHeader k={c.key} label={c.label} align={c.align} />
                  </div>
                ))}
                <div className="w-24" />
              </div>
              {pagedOrders.map((o) => (
                <div key={o.id} className="grid min-w-[820px] grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_1fr_1fr_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0">
                  <div className="font-mono font-semibold text-ink">{o.symbol}</div>
                  <div className={`font-mono ${o.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{o.side.toUpperCase()} · {o.type}</div>
                  <div className="text-end font-mono">{Number(o.qty)}</div>
                  <div className="text-end font-mono text-muted-foreground">{o.filled_price ? Number(o.filled_price).toFixed(2) : o.price ? Number(o.price).toFixed(2) : "—"}</div>
                  <div className="text-end"><StatusBadge status={o.status} /></div>
                  <div className="text-end font-mono text-muted-foreground">{new Date(o.created_at).toLocaleString(lang === "ar" ? "ar" : "en-US", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</div>
                  <div className="flex justify-end gap-1">
                    {o.status === "pending" ? (
                      <>
                        <button disabled={!isTrader} title={!isTrader ? t("traderRequired") : undefined} onClick={() => setEditing({ id: o.id, qty: Number(o.qty), price: Number(o.price ?? 0) })} className="rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)] disabled:opacity-40">{t("modifyOrder")}</button>
                        <button disabled={!isTrader} title={!isTrader ? t("traderRequired") : undefined} onClick={() => askCancel(o.id, o.symbol)} className="rounded border border-[var(--bear)]/40 px-2 py-1 text-[10px] text-[var(--bear)] disabled:opacity-40">{t("cancelOrder")}</button>
                      </>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              ))}
              <Pager page={safePage} pageCount={pageCount} onPage={(p) => updateSearch({ page: p })} t={t} />
            </div>
          )}
        </section>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-xl border border-border bg-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">{t("modifyOrder")}</h3>
            <div className="grid gap-2">
              <label className="text-[10px] uppercase text-muted-foreground">{t("qty")}
                <input type="number" value={editing.qty} onChange={(e) => setEditing({ ...editing, qty: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-[var(--gold-deep)] focus:outline-none" />
              </label>
              <label className="text-[10px] uppercase text-muted-foreground">{t("price")}
                <input type="number" step="0.01" value={editing.price} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-[var(--gold-deep)] focus:outline-none" />
              </label>
              <div className="mt-2 flex justify-end gap-2">
                <button onClick={() => setEditing(null)} className="rounded border border-border px-3 py-1.5 text-xs text-ink-soft">{t("cancelled")}</button>
                <button
                  disabled={modifyMut.isPending || editing.qty <= 0 || editing.price <= 0}
                  onClick={() => modifyMut.mutate({ orderId: editing.id, qty: editing.qty, price: editing.price })}
                  className="rounded-md gold-gradient px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
                >{t("submit")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
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