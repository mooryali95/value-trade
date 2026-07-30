import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { NotFoundBlock } from "@/components/not-found-block";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { CandlestickChart } from "@/components/candlestick-chart";
import { useI18n } from "@/lib/i18n";
import { BRANDS, getBrand, generateCandles, generateOrderBook } from "@/lib/mock-data";
import { formatCurrency, formatPct, formatInt } from "@/lib/format";
import { ShieldCheck, Search } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { placeOrder } from "@/lib/trading/place-order.functions";
import { createPriceAlert } from "@/lib/trading/alerts.functions";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/trade/$symbol")({
  loader: ({ params }) => {
    const brand = getBrand(params.symbol);
    if (!brand) throw notFound();
    return { brand };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.brand.symbol} · تداول — وحدة القيمة` : "تداول — وحدة القيمة" },
      {
        name: "description",
        content: loaderData
          ? `منصة تداول ${loaderData.brand.nameAr} مع دفتر أوامر لحظي وحوكمة شرعية. · Professional trading desk for ${loaderData.brand.nameEn}.`
          : "منصة تداول احترافية بحوكمة شرعية. · Professional Shariah-governed trading desk.",
      },
      {
        property: "og:title",
        content: loaderData ? `Trade ${loaderData.brand.symbol} — Value Unit` : "Trade — Value Unit",
      },
      {
        property: "og:description",
        content: "Professional trading desk with live order book and Shariah governance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  errorComponent: ({ error, reset }) => (
    <AppShell><div className="py-16"><ErrorState reset={reset} description={String(error?.message ?? "")} /></div></AppShell>
  ),
  notFoundComponent: () => <NotFoundBlock kind="symbol" />,
  component: TradePage,
});

function TradePage() {
  const { brand } = Route.useLoaderData();
  const { t, lang } = useI18n();
  const confirm = useConfirm();
  const candles = generateCandles(brand.slug, 200, brand.price);
  const { bids, asks } = generateOrderBook(brand.price, brand.slug);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [price, setPrice] = useState(brand.price.toFixed(2));
  const [qty, setQty] = useState("100");
  const [q, setQ] = useState("");
  const up = brand.change24h >= 0;

  const qc = useQueryClient();
  const { isTrader, isLoading: rolesLoading } = useMyRoles();
  const placeOrderFn = useServerFn(placeOrder);
  const createAlertFn = useServerFn(createPriceAlert);
  const orderMutation = useMutation({
    mutationFn: () => placeOrderFn({ data: {
      symbolSlug: brand.slug, side, type: orderType, qty: Number(qty),
      price: orderType === "limit" ? Number(price) : undefined,
    } }),
    onSuccess: () => {
      toast.success(t("orderPlaced"));
      qc.invalidateQueries({ queryKey: ["portfolio"] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "INSUFFICIENT_CASH") toast.error(t("insufficientCash"));
      else if (msg === "INSUFFICIENT_QTY") toast.error(t("insufficientQty"));
      else if (msg === "FORBIDDEN_TRADER_REQUIRED") toast.error(t("traderRequired"));
      else toast.error(t("orderFailed"));
    },
  });
  const alertMutation = useMutation({
    mutationFn: (direction: "above" | "below") => createAlertFn({ data: {
      symbol: brand.symbol, direction, targetPrice: Number(price) || brand.price,
    } }),
    onSuccess: () => toast.success(t("createAlert")),
    onError: () => toast.error(t("orderFailed")),
  });

  const filteredWL = BRANDS.filter((b) => !q || b.symbol.toLowerCase().includes(q.toLowerCase())).slice(0, 20);

  return (
    <AppShell>
      <PageHeader
        eyebrow={brand.symbol}
        title={`${lang === "ar" ? brand.nameAr : brand.nameEn} · Trade`}
        crumbs={[
          { label: t("marketOverview"), to: "/market" },
          { label: lang === "ar" ? brand.nameAr : brand.nameEn },
          { label: "Trade" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
        {/* Watchlist */}
        <aside className="rounded-xl border border-border/60 bg-card/60 p-3 lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("watchlist")}</h3>
          </div>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground start-2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="w-full rounded-md border border-border bg-background px-8 py-1.5 text-xs focus:border-primary/50 focus:outline-none" />
          </div>
          <div className="max-h-[calc(100vh-14rem)] space-y-0.5 overflow-y-auto pr-1">
            {filteredWL.map((b) => (
              <Link
                key={b.id}
                to="/trade/$symbol"
                params={{ symbol: b.slug }}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-1.5 text-xs transition ${b.id === brand.id ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-secondary/40"}`}
              >
                <div className="min-w-0">
                  <div className="font-mono font-semibold">{b.symbol}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{lang === "ar" ? b.nameAr : b.nameEn}</div>
                </div>
                <div className={`font-mono ${b.change24h >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{formatPct(b.change24h)}</div>
              </Link>
            ))}
          </div>
        </aside>

        {/* Chart center */}
        <section className="rounded-xl border border-border/60 bg-card/60 p-4">
          <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-xs font-bold text-ivory" style={{ background: brand.color }}>{brand.symbol.slice(0,3)}</div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-foreground">{lang === "ar" ? brand.nameAr : brand.nameEn}</span>
                  {brand.shariah === "halal" && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[var(--bull)]" />}
                </div>
                <div className="text-[10px] uppercase text-muted-foreground">{brand.symbol}</div>
              </div>
            </div>
            <div className="text-end">
              <div className="font-mono text-xl font-bold text-foreground">{brand.price.toFixed(2)}</div>
              <div className={`font-mono text-xs ${up ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{formatPct(brand.change24h)}</div>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap gap-3 border-b border-border/40 pb-3 text-xs">
            {brand.assetClass === "sukuk" ? (
              <>
                <MiniStat label={t("coupon")} v={`${brand.couponPct?.toFixed(2)}%`} />
                <MiniStat label={t("ytm")} v={`${brand.ytmPct?.toFixed(2)}%`} />
                <MiniStat label={t("maturity")} v={brand.maturity ?? "—"} />
                <MiniStat label={t("tenor")} v={`${brand.tenorYears} ${t("years")}`} />
                <MiniStat label={t("issuer")} v={brand.issuer ?? "—"} />
              </>
            ) : (
              <>
                <MiniStat label={t("open")} v={(brand.price * 0.995).toFixed(2)} />
                <MiniStat label={t("high")} v={(brand.price * 1.03).toFixed(2)} />
                <MiniStat label={t("low")} v={(brand.price * 0.96).toFixed(2)} />
                <MiniStat label={t("volume24h")} v={formatInt(brand.volume24h, true)} />
                <MiniStat label={t("marketCap")} v={formatCurrency(brand.marketCap, true, lang)} />
                {brand.assetClass === "stock" && (
                  <>
                    <MiniStat label={t("pe")} v={brand.pe?.toFixed(1) ?? "—"} />
                    <MiniStat label={t("divYield")} v={brand.divYield ? `${brand.divYield}%` : "—"} />
                    <MiniStat label={t("exchange")} v={brand.exchange ?? "—"} />
                  </>
                )}
              </>
            )}
          </div>
          <CandlestickChart candles={candles} height={460} />

          {/* Recent trades */}
          <div className="mt-4 rounded-lg border border-border/40">
            <div className="border-b border-border/40 px-3 py-2 text-xs font-semibold text-foreground">{t("recentTrades")}</div>
            <div className="grid grid-cols-3 gap-2 px-3 py-1.5 text-[10px] uppercase text-muted-foreground">
              <div>{t("price")}</div><div className="text-end">{t("qty")}</div><div className="text-end">Time</div>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {candles.slice(-14).reverse().map((c, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 px-3 py-1 font-mono text-xs">
                  <div className={c.close >= c.open ? "text-[var(--bull)]" : "text-[var(--bear)]"}>{c.close.toFixed(2)}</div>
                  <div className="text-end text-foreground/80">{formatInt(c.volume)}</div>
                  <div className="text-end text-muted-foreground">{new Date(c.time * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Order panel */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-card/60 p-4">
            <div className="mb-3 grid grid-cols-2 rounded-md bg-secondary/40 p-1 text-sm font-semibold">
              <button onClick={() => setSide("buy")} className={`rounded-md py-2 transition ${side === "buy" ? "bg-[var(--bull)] text-ivory" : "text-muted-foreground"}`}>{t("buy")}</button>
              <button onClick={() => setSide("sell")} className={`rounded-md py-2 transition ${side === "sell" ? "bg-[var(--bear)] text-ivory" : "text-muted-foreground"}`}>{t("sell")}</button>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
              <button onClick={() => setOrderType("limit")} className={`rounded border px-2 py-1.5 ${orderType === "limit" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{t("limit")}</button>
              <button onClick={() => setOrderType("market")} className={`rounded border px-2 py-1.5 ${orderType === "market" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{t("market")}</button>
            </div>
            {orderType === "limit" && (
              <Field label={t("price")}>
                <input value={price} onChange={(e) => setPrice(e.target.value)} className="w-full bg-transparent text-end font-mono text-sm outline-none" />
              </Field>
            )}
            <Field label={t("qty")}>
              <input value={qty} onChange={(e) => setQty(e.target.value)} className="w-full bg-transparent text-end font-mono text-sm outline-none" />
            </Field>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("total")}</span>
              <span className="font-mono text-foreground">{(Number(price) * Number(qty) || 0).toFixed(2)}</span>
            </div>
            <button
              disabled={orderMutation.isPending || rolesLoading || !isTrader}
              title={!isTrader ? t("traderRequired") : undefined}
              onClick={async () => {
                const ok = await confirm({
                  title: t("confirmOrderTitle"),
                  description: `${t("confirmOrderDesc")} · ${side === "buy" ? t("buy") : t("sell")} ${qty} ${brand.symbol}`,
                  confirmLabel: side === "buy" ? t("buy") : t("sell"),
                  cancelLabel: t("cancel"),
                  tone: side === "sell" ? "danger" : "default",
                });
                if (ok) orderMutation.mutate();
              }}
              className={`mt-4 w-full rounded-md py-2.5 text-sm font-semibold text-ivory transition disabled:opacity-60 ${side === "buy" ? "bg-[var(--bull)]" : "bg-[var(--bear)]"}`}
            >
              {orderMutation.isPending ? "…" : `${side === "buy" ? t("buy") : t("sell")} ${brand.symbol}`}
            </button>
            {!rolesLoading && !isTrader && (
              <div className="mt-2 text-[10px] text-[var(--bear)]">{t("traderRequired")}</div>
            )}
            <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{t("balance")}</span>
              <span className="font-mono">125,430.00</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => alertMutation.mutate("above")} className="rounded border border-border px-2 py-1.5 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]">↑ {t("alertAbove")}</button>
              <button onClick={() => alertMutation.mutate("below")} className="rounded border border-border px-2 py-1.5 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]">↓ {t("alertBelow")}</button>
            </div>
          </div>

          {/* Compact order book */}
          {brand.assetClass === "sukuk" ? (
            <div className="rounded-xl border border-border/60 bg-card/60 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                {t("bid")} / {t("ask")} · {t("ytm")}
              </h3>
              <div className="grid grid-cols-3 gap-2 border-b border-border/40 pb-1.5 text-[10px] uppercase text-muted-foreground">
                <div>{t("bid")}</div>
                <div className="text-center">{t("ask")}</div>
                <div className="text-end">{t("ytm")}</div>
              </div>
              <div className="mt-1 space-y-0.5 font-mono text-[11px]">
                {Array.from({ length: 6 }).map((_, i) => {
                  const b = brand.price - (i + 1) * 0.05;
                  const a = brand.price + (i + 1) * 0.05;
                  const y = (brand.ytmPct ?? 5) + i * 0.02;
                  return (
                    <div key={i} className="grid grid-cols-3 gap-2 rounded px-1 py-0.5">
                      <div className="text-[var(--bull)]">{b.toFixed(2)}</div>
                      <div className="text-center text-[var(--bear)]">{a.toFixed(2)}</div>
                      <div className="text-end text-foreground/80">{y.toFixed(2)}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
          <div className="rounded-xl border border-border/60 bg-card/60 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{t("orderBook")}</h3>
            <div className="space-y-0.5 font-mono text-[11px]">
              {asks.slice(0, 6).reverse().map((r, i) => (
                <div key={"a" + i} className="relative grid grid-cols-2 gap-2 rounded px-1 py-0.5">
                  <div className="absolute inset-y-0 end-0 bg-[var(--bear)]/10" style={{ width: `${Math.min(100, r.qty / 10)}%` }} />
                  <div className="relative text-[var(--bear)]">{r.price.toFixed(2)}</div>
                  <div className="relative text-end text-foreground/80">{r.qty}</div>
                </div>
              ))}
              <div className="my-1 rounded bg-secondary/40 px-1 py-1 text-center text-sm font-bold text-primary">{brand.price.toFixed(2)}</div>
              {bids.slice(0, 6).map((r, i) => (
                <div key={"b" + i} className="relative grid grid-cols-2 gap-2 rounded px-1 py-0.5">
                  <div className="absolute inset-y-0 end-0 bg-[var(--bull)]/10" style={{ width: `${Math.min(100, r.qty / 10)}%` }} />
                  <div className="relative text-[var(--bull)]">{r.price.toFixed(2)}</div>
                  <div className="relative text-end text-foreground/80">{r.qty}</div>
                </div>
              ))}
            </div>
          </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-2 block rounded-md border border-border bg-background/60 px-3 py-2">
      <div className="mb-0.5 text-[10px] uppercase text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}
function MiniStat({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono text-foreground">{v}</div>
    </div>
  );
}