import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { NotFoundBlock } from "@/components/not-found-block";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { formatCurrency, formatInt } from "@/lib/format";
import { Search } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { placeOrder } from "@/lib/trading/place-order.functions";
import { createPriceAlert } from "@/lib/trading/alerts.functions";
import { getMyOpenOrders } from "@/lib/trading/book.functions";
import { cancelOrder } from "@/lib/trading/order-mutations.functions";
import { getMyPortfolio } from "@/lib/trading/portfolio.functions";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useSignedIn } from "@/hooks/use-signed-in";
import { useErrorMessage } from "@/hooks/use-error-message";
import { describeOrderOutcome, validatePrice, validateQty, type OrderOutcome } from "@/components/order-outcome";
import { useConfirm } from "@/components/confirm-dialog";
import { PermissionHint } from "@/components/permission-hint";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { getPublicInstrument, type PublicInstrumentDetail } from "@/lib/market/public-market.functions";
import {
  ChangeText,
  InstrumentLoadError,
  MarketDataError,
  Monogram,
  ShariahPill,
  formatPrice,
  instrumentName,
  markOf,
  useMarketOverview,
} from "@/components/market-data";
import { ChartPanel, OrderBookPanel, RecentTradesPanel, useLiveInstrument } from "@/components/market-panels";
import { toast } from "sonner";

/**
 * Trade desk for one published instrument. Everything shown comes from the
 * database: the instrument (public_instrument), candles and the trade tape
 * from executed trades, and the aggregated book. An unknown or unpublished
 * symbol is a 404; a database failure is an error state.
 */
export const Route = createFileRoute("/trade/$symbol")({
  loader: async ({ params }) => {
    const instrument = await getPublicInstrument({ data: { slug: params.symbol } });
    if (!instrument) throw notFound();
    return { instrument };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.instrument.symbol} · تداول — وحدة القيمة` : "تداول — وحدة القيمة" },
      {
        name: "description",
        content: loaderData
          ? `تداول ${loaderData.instrument.nameAr} على وحدة القيمة. · Trade ${loaderData.instrument.nameEn} on Value Unit.`
          : "التداول على وحدة القيمة. · Trading on Value Unit.",
      },
      {
        property: "og:title",
        content: loaderData ? `Trade ${loaderData.instrument.symbol} — Value Unit` : "Trade — Value Unit",
      },
      { property: "og:description", content: "Order book, executed trades and order entry on Value Unit." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  errorComponent: ({ error, reset }) => (
    <AppShell><div className="py-16"><InstrumentLoadError error={error} reset={reset} /></div></AppShell>
  ),
  notFoundComponent: () => <NotFoundBlock kind="symbol" />,
  component: TradeRoute,
});

function TradeRoute() {
  const { instrument } = Route.useLoaderData();
  // Keyed by symbol so switching instruments resets the order form.
  return <TradePage key={instrument.symbol} initial={instrument} />;
}

function TradePage({ initial }: { initial: PublicInstrumentDetail }) {
  const brand = useLiveInstrument(initial);
  const { t, lang } = useI18n();
  const confirm = useConfirm();
  const mark = markOf(brand);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [price, setPrice] = useState(mark.price.toFixed(2));
  const [qty, setQty] = useState("100");
  const [q, setQ] = useState("");

  const qc = useQueryClient();
  const { isTrader, isLoading: rolesLoading } = useMyRoles();
  const signedIn = useSignedIn();
  const errorMessage = useErrorMessage();
  const [outcome, setOutcome] = useState("");
  const qtyError = validateQty(qty);
  const priceError = orderType === "limit" ? validatePrice(price) : null;
  const orderInvalid = !!qtyError || !!priceError;
  // Today's allowed limit-price range, as the engine enforces it (on the tick).
  const band = { low: brand.bandLow, high: brand.bandHigh };

  // Real buying power: the signed-in investor's cash. A missing portfolio
  // row means the account has not been funded yet, i.e. 0.
  const portfolioFn = useServerFn(getMyPortfolio);
  const portfolioQuery = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => portfolioFn(),
    enabled: signedIn === true,
    staleTime: 15_000,
  });
  const cashBalance = Number(portfolioQuery.data?.portfolio?.cash_balance ?? 0);

  // The trader's own resting orders on this instrument.
  const openOrdersFn = useServerFn(getMyOpenOrders);
  const cancelOrderFn = useServerFn(cancelOrder);
  const openOrdersQuery = useQuery({
    queryKey: ["open-orders"],
    queryFn: () => openOrdersFn({ data: undefined as never }),
    enabled: signedIn === true,
    refetchInterval: 15_000,
  });
  const myOpenOrders = (openOrdersQuery.data ?? []).filter((o) => o.symbol === brand.symbol);
  const refreshMarket = () => {
    qc.invalidateQueries({ queryKey: ["book", brand.symbol] });
    qc.invalidateQueries({ queryKey: ["recent-trades", brand.symbol] });
    qc.invalidateQueries({ queryKey: ["candles", brand.symbol] });
    qc.invalidateQueries({ queryKey: ["public-instrument", brand.symbol] });
  };
  const cancelMutation = useMutation({
    mutationFn: (orderId: string) => cancelOrderFn({ data: { orderId } }),
    onSuccess: () => {
      toast.success(t("orderCancelled"));
      qc.invalidateQueries({ queryKey: ["open-orders"] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      refreshMarket();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, undefined, "orderFailed")),
  });
  const placeOrderFn = useServerFn(placeOrder);
  const createAlertFn = useServerFn(createPriceAlert);
  const orderMutation = useMutation({
    mutationFn: () => placeOrderFn({ data: {
      symbolSlug: brand.slug, side, type: orderType, qty: Number(qty),
      price: orderType === "limit" ? Number(price) : undefined,
    } }),
    onMutate: () => setOutcome(""),
    onSuccess: (res) => {
      const o = describeOrderOutcome(res as unknown as OrderOutcome, Number(qty), t);
      setOutcome(o.message);
      if (o.tone === "error") toast.error(o.message);
      else if (o.tone === "warning") toast.warning(o.message);
      else toast.success(o.message);
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["open-orders"] });
      refreshMarket();
    },
    onError: (e: unknown) => {
      const msg = errorMessage(e, undefined, "orderFailed");
      setOutcome(msg);
      toast.error(msg);
    },
  });
  const alertMutation = useMutation({
    mutationFn: (direction: "above" | "below") => createAlertFn({ data: {
      symbol: brand.symbol, direction, targetPrice: Number(price) || mark.price,
    } }),
    onSuccess: () => toast.success(t("createAlert")),
    onError: (e: unknown) => toast.error(errorMessage(e, undefined, "orderFailed")),
  });

  // Watchlist: the published instruments from the database.
  const market = useMarketOverview();
  const needle = q.trim().toLowerCase();
  const filteredWL = (market.data?.instruments ?? [])
    .filter((b) => !needle || b.symbol.toLowerCase().includes(needle) || b.nameEn.toLowerCase().includes(needle) || b.nameAr.includes(q.trim()))
    .slice(0, 50);
  const name = instrumentName(brand, lang);

  return (
    <AppShell>
      <PageHeader
        eyebrow={brand.symbol}
        title={`${name} · ${t("nav_trade")}`}
        crumbs={[
          { label: t("marketOverview"), to: "/market" },
          { label: name, to: `/market/${brand.slug}` },
          { label: t("nav_trade") },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
        {/* Watchlist */}
        <aside className="rounded-xl border border-border/60 bg-card/60 p-3 lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("e2_listedInstruments")}</h3>
          </div>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground start-2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("e2_searchInstruments")} aria-label={t("e2_searchInstruments")} className="w-full rounded-md border border-border bg-background px-8 py-1.5 text-xs focus:border-primary/50 focus:outline-none" />
          </div>
          <div className="max-h-[calc(100dvh-14rem)] space-y-0.5 overflow-y-auto pe-1">
            {market.isLoading ? (
              <LuxurySkeleton lines={6} className="px-2 py-2" />
            ) : !market.data ? (
              <MarketDataError error={market.error} onRetry={() => market.refetch()} />
            ) : filteredWL.length === 0 ? (
              <p className="px-2 py-3 text-[11px] text-muted-foreground">{t("emptyTitle")}</p>
            ) : (
              filteredWL.map((b) => (
                <Link
                  key={b.symbol}
                  to="/trade/$symbol"
                  params={{ symbol: b.slug }}
                  className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-1.5 text-xs transition ${b.symbol === brand.symbol ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-secondary/40"}`}
                >
                  <div className="min-w-0">
                    <div className="font-mono font-semibold">{b.symbol}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{instrumentName(b, lang)}</div>
                  </div>
                  <ChangeText pct={b.change24hPct} />
                </Link>
              ))
            )}
          </div>
        </aside>

        {/* Chart center */}
        <div className="min-w-0 space-y-4">
          <section className="rounded-xl border border-border/60 bg-card/60 p-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Monogram symbol={brand.symbol} className="h-11 w-11 text-xs" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{name}</span>
                    <ShariahPill status={brand.shariahStatus} compact />
                  </div>
                  <div className="text-[10px] uppercase text-muted-foreground">{brand.symbol}</div>
                </div>
              </div>
              <div className="text-end">
                <div className="font-mono text-xl font-bold text-foreground">{formatPrice(mark.price)}</div>
                <div className="text-[10px] text-muted-foreground">{mark.isReference ? t("e2_referencePriceNoTrades") : t("lastPrice")}</div>
                <ChangeText pct={brand.change24hPct} className="text-xs" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-border/40 pt-3 text-xs">
              <MiniStat label={t("e2_dayOpen")} v={brand.dayOpen != null ? formatPrice(brand.dayOpen) : "—"} />
              <MiniStat label={t("e2_dayHigh")} v={brand.dayHigh != null ? formatPrice(brand.dayHigh) : "—"} />
              <MiniStat label={t("e2_dayLow")} v={brand.dayLow != null ? formatPrice(brand.dayLow) : "—"} />
              <MiniStat label={t("e2_volumeUnits24h")} v={formatInt(brand.volume24hUnits)} />
              <MiniStat label={t("e2_value24h")} v={formatCurrency(brand.volume24hValue, true, lang)} />
              <MiniStat label={t("referencePrice")} v={formatPrice(brand.referencePrice)} />
            </div>
          </section>
          <ChartPanel symbol={brand.symbol} height={460} />
          <RecentTradesPanel symbol={brand.symbol} />
        </div>

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
              <Field label={t("price")} error={priceError ? t(priceError) : undefined} errorId="order-price-error">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  aria-invalid={!!priceError}
                  aria-describedby={priceError ? "order-price-error" : undefined}
                  className="w-full bg-transparent text-end font-mono text-sm outline-none"
                />
              </Field>
            )}
            {orderType === "limit" && band && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                {t("allowedPriceRange").replace("{low}", band.low.toFixed(2)).replace("{high}", band.high.toFixed(2))}
              </p>
            )}
            <Field label={t("qty")} error={qtyError ? t(qtyError) : undefined} errorId="order-qty-error">
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="10000000"
                step="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "." || e.key === "," || e.key === "e" || e.key === "E" || e.key === "-" || e.key === "+") e.preventDefault();
                }}
                aria-invalid={!!qtyError}
                aria-describedby={qtyError ? "order-qty-error" : undefined}
                className="w-full bg-transparent text-end font-mono text-sm outline-none"
              />
            </Field>
            <div className="mt-3 rounded-md border border-border/60 bg-secondary/20 p-3">
              <div className="mb-1.5 text-label text-ink-soft" id="order-preview-heading">{t("orderPreview")}</div>
              <dl
                className="space-y-1 text-caption"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                aria-labelledby="order-preview-heading"
              >
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-ink-soft">{t("orderType")}</dt>
                  <dd className="font-semibold text-ink">
                    {side === "buy" ? t("buy") : t("sell")} · {orderType === "limit" ? t("limit") : t("market")}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-ink-soft">{t("qty")}</dt>
                  <dd className="num font-semibold text-ink">{qty || "0"} {brand.symbol}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-ink-soft">{t("price")}</dt>
                  <dd className="num font-semibold text-ink">
                    {orderType === "limit" ? Number(price || 0).toFixed(2) : t("market")}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-1">
                  <dt className="text-ink-soft">{t("total")}</dt>
                  <dd className="num font-semibold text-ink">
                    {((orderType === "limit" ? Number(price) : mark.price) * Number(qty) || 0).toFixed(2)}
                  </dd>
                </div>
              </dl>
            </div>
            <PermissionHint allowed={rolesLoading || isTrader} reason={signedIn === false ? t("signInToTrade") : t("traderRequired")}>
              <button
                disabled={orderMutation.isPending || rolesLoading || !isTrader || orderInvalid}
                title={!isTrader ? (signedIn === false ? t("signInToTrade") : t("traderRequired")) : undefined}
                onClick={async () => {
                  if (orderInvalid) return;
                  const unit = orderType === "limit" ? Number(price) : mark.price;
                  const ok = await confirm({
                    title: t("confirmOrderTitle"),
                    description: `${side === "buy" ? t("buy") : t("sell")} ${qty} ${brand.symbol} @ ${
                      orderType === "limit" ? Number(price || 0).toFixed(2) : t("market")
                    } · ${t("total")} ${(unit * Number(qty) || 0).toFixed(2)} — ${t("confirmOrderDesc")}`,
                    confirmLabel: side === "buy" ? t("buy") : t("sell"),
                    cancelLabel: t("cancel"),
                    tone: side === "sell" ? "danger" : "default",
                  });
                  if (ok) orderMutation.mutate();
                }}
                className={`mt-3 w-full rounded-md py-2.5 text-sm font-semibold text-ivory transition disabled:opacity-60 ${side === "buy" ? "bg-[var(--bull)]" : "bg-[var(--bear)]"}`}
              >
                {orderMutation.isPending ? "…" : `${side === "buy" ? t("buy") : t("sell")} ${brand.symbol}`}
              </button>
            </PermissionHint>
            <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
              {orderMutation.isPending
                ? t("a11yOrderSubmitting")
                : outcome}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span>{t("balance")}</span>
              {signedIn === false ? (
                <Link to="/auth" search={{ redirect: `/trade/${brand.slug}` }} className="font-semibold text-[var(--gold-deep)] hover:underline">
                  {t("signInToSeeBalance")}
                </Link>
              ) : signedIn === null || portfolioQuery.isLoading ? (
                <span className="h-3 w-20 animate-pulse rounded bg-secondary/60" aria-label={t("loading")} />
              ) : portfolioQuery.isError ? (
                <button onClick={() => portfolioQuery.refetch()} className="text-[var(--bear)] hover:underline">{t("errInternal")}</button>
              ) : (
                <span className="font-mono">{formatCurrency(cashBalance, false, lang)}</span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => alertMutation.mutate("above")} className="rounded border border-border px-2 py-1.5 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]">↑ {t("alertAbove")}</button>
              <button onClick={() => alertMutation.mutate("below")} className="rounded border border-border px-2 py-1.5 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]">↓ {t("alertBelow")}</button>
            </div>
          </div>

          {/* Aggregated book: price levels only */}
          <OrderBookPanel symbol={brand.symbol} levels={6} showTotal={false} />

          {/* Resting orders in the book */}
          <div className="rounded-xl border border-border/60 bg-card/60 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{t("openOrders")}</h3>
            {myOpenOrders.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">{t("noOpenOrders")}</p>
            ) : (
              <ul className="space-y-1">
                {myOpenOrders.map((o) => (
                  <li key={o.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-1 py-1 font-mono text-[11px]">
                    <span className={o.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]"}>
                      {o.side === "buy" ? t("buy") : t("sell")} {Number(o.qty) - Number(o.filled_qty)}/{Number(o.qty)} @ {o.price == null ? t("market") : Number(o.price).toFixed(2)}
                    </span>
                    <button
                      onClick={() => cancelMutation.mutate(o.id)}
                      disabled={cancelMutation.isPending}
                      className="rounded border border-border px-2 py-0.5 text-[10px] text-ink-soft hover:border-[var(--bear)] disabled:opacity-60"
                    >
                      {t("cancel")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function Field({ label, children, error, errorId }: { label: string; children: React.ReactNode; error?: string; errorId?: string }) {
  return (
    <div className="mt-2">
      <label className={`block rounded-md border bg-background/60 px-3 py-2 ${error ? "border-[var(--bear)]/60" : "border-border"}`}>
        <div className="mb-0.5 text-[10px] uppercase text-muted-foreground">{label}</div>
        {children}
      </label>
      {error && <p id={errorId} className="mt-1 text-[10px] text-[var(--bear)]">{error}</p>}
    </div>
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