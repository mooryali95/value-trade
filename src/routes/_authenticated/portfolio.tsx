import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
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
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/portfolio")({
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
  const fetchPortfolio = useServerFn(getMyPortfolio);
  const cancelFn = useServerFn(cancelOrder);
  const modifyFn = useServerFn(modifyOrder);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => fetchPortfolio(),
    staleTime: 15_000,
  });
  const [tab, setTab] = useState<"positions" | "orders">("positions");
  const [orderFilter, setOrderFilter] = useState({ search: "", status: "all", side: "all" });
  const [editing, setEditing] = useState<null | { id: string; qty: number; price: number }>(null);

  const cancelMut = useMutation({
    mutationFn: (orderId: string) => cancelFn({ data: { orderId } }),
    onSuccess: () => { toast.success(t("orderCancelled")); qc.invalidateQueries({ queryKey: ["portfolio"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });
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

  const filteredOrders = useMemo(() => {
    const q = orderFilter.search.trim().toUpperCase();
    return data.orders.filter((o) => {
      if (orderFilter.status !== "all" && o.status !== orderFilter.status) return false;
      if (orderFilter.side !== "all" && o.side !== orderFilter.side) return false;
      if (q && !o.symbol.toUpperCase().includes(q)) return false;
      return true;
    });
  }, [data.orders, orderFilter]);

  return (
    <AppShell>
      <header className="mb-6">
        <div className="h-px hairline-gold mb-3" />
        <h1 className="text-2xl font-bold text-ink md:text-3xl">{t("portfolio")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("myPositions")} · {enriched.length}</p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <KPI label={t("totalValue")} value={formatCurrency(totalValue, false, lang)} />
        <KPI label={t("cashAvailable")} value={formatCurrency(cash, false, lang)} />
        <KPI label={t("myPositions")} value={String(enriched.length)} />
        <KPI label={t("pnl")} value={formatCurrency(totalPnl, false, lang)} tone={totalPnl >= 0 ? "bull" : "bear"} />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-border/60">
        {[["positions", t("tabPositions")], ["orders", t("tabOrders")]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key as never)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition ${tab === key ? "border-[var(--gold-deep)] text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
          >{label}</button>
        ))}
      </div>

      {tab === "positions" ? (
        <section className="mb-8">
          {enriched.length === 0 ? (
          <EmptyState
            title={t("emptyPositions")}
            description={t("emptyPositionsDesc")}
            action={<Link to="/market" className="rounded-md gold-gradient px-4 py-2 text-xs font-semibold text-ink">{t("nav_market")}</Link>}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <div className="grid grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div>Symbol</div>
              <div className="text-end">{t("qty")}</div>
              <div className="text-end">{t("avgPrice")}</div>
              <div className="text-end">{t("lastPrice")}</div>
              <div className="text-end">{t("pnl")}</div>
              <div className="text-end">{t("weight")}</div>
              <div className="w-16" />
            </div>
            {enriched.map((p) => (
              <div key={p.id} className="grid grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-sm last:border-b-0">
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
          </div>
        )}
        </section>
      ) : (
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={orderFilter.search}
              onChange={(e) => setOrderFilter({ ...orderFilter, search: e.target.value })}
              placeholder={t("searchOrders")}
              className="min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
            />
            <select value={orderFilter.status} onChange={(e) => setOrderFilter({ ...orderFilter, status: e.target.value })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
              <option value="all">{t("filterAll")}</option>
              <option value="filled">{t("filled")}</option>
              <option value="pending">{t("pending")}</option>
              <option value="modified">{t("modified")}</option>
              <option value="cancelled">{t("cancelled")}</option>
            </select>
            <select value={orderFilter.side} onChange={(e) => setOrderFilter({ ...orderFilter, side: e.target.value })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
              <option value="all">{t("filterAll")}</option>
              <option value="buy">{t("filterBuy")}</option>
              <option value="sell">{t("filterSell")}</option>
            </select>
          </div>
          {filteredOrders.length === 0 ? (
            <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
              <div className="grid grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_1fr_1fr_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                <div>Symbol</div><div>{t("orderType")}</div>
                <div className="text-end">{t("qty")}</div>
                <div className="text-end">{t("price")}</div>
                <div className="text-end">Status</div>
                <div className="text-end">Time</div>
                <div className="w-24" />
              </div>
              {filteredOrders.map((o) => (
                <div key={o.id} className="grid grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_1fr_1fr_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0">
                  <div className="font-mono font-semibold text-ink">{o.symbol}</div>
                  <div className={`font-mono ${o.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{o.side.toUpperCase()} · {o.type}</div>
                  <div className="text-end font-mono">{Number(o.qty)}</div>
                  <div className="text-end font-mono text-muted-foreground">{o.filled_price ? Number(o.filled_price).toFixed(2) : o.price ? Number(o.price).toFixed(2) : "—"}</div>
                  <div className="text-end"><StatusBadge status={o.status} /></div>
                  <div className="text-end font-mono text-muted-foreground">{new Date(o.created_at).toLocaleString(lang === "ar" ? "ar" : "en-US", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</div>
                  <div className="flex justify-end gap-1">
                    {o.status === "pending" ? (
                      <>
                        <button onClick={() => setEditing({ id: o.id, qty: Number(o.qty), price: Number(o.price ?? 0) })} className="rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]">{t("modifyOrder")}</button>
                        <button onClick={() => cancelMut.mutate(o.id)} className="rounded border border-[var(--bear)]/40 px-2 py-1 text-[10px] text-[var(--bear)]">{t("cancelOrder")}</button>
                      </>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              ))}
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
                  onClick={() => modifyMut.mutate(editing)}
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