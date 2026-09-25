import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { NotFoundBlock } from "@/components/not-found-block";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { formatCurrency, isolateLtr } from "@/lib/format";
import { Search } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { placeOrder } from "@/lib/trading/place-order.functions";
import { createPriceAlert } from "@/lib/trading/alerts.functions";
import { getBook, getMyOpenOrders } from "@/lib/trading/book.functions";
import { cancelOrder } from "@/lib/trading/order-mutations.functions";
import { getMyPortfolio } from "@/lib/trading/portfolio.functions";
import { estimateMarketFill, MAX_ORDER_QTY, orderCashCommitment, positionValue } from "@/lib/trading/calc";
import { Num, formatNum } from "@/components/num";
import { useIsMobile } from "@/hooks/use-mobile";
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
  instrumentName,
  markOf,
  useMarketOverview,
} from "@/components/market-data";
import { ChartPanel, OrderBookPanel, RecentTradesPanel, useLiveInstrument } from "@/components/market-panels";
import { toast } from "sonner";

/** The engine's maximum value of one order (match_order c_max_notional). */
const MAX_ORDER_VALUE = 5_000_000;

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
  const isMobile = useIsMobile();
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
  // Today's allowed limit-price range, as the engine enforces it (on the tick).
  const band = { low: brand.bandLow, high: brand.bandHigh };

  // The investor's cash, what their resting buys reserve and their buying
  // power (cash - reserve), all from the database; the holding of this
  // instrument and the units already promised to resting sells.
  const portfolioFn = useServerFn(getMyPortfolio);
  const portfolioQuery = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => portfolioFn(),
    enabled: signedIn === true,
    staleTime: 15_000,
  });
  const summary = portfolioQuery.data?.summary ?? null;
  const holding = portfolioQuery.data?.positions.find((p) => p.symbol.toUpperCase() === brand.symbol) ?? null;
  const heldQty = holding?.qty ?? 0;
  const availableQty = Math.max(0, heldQty - (holding?.reserved_qty ?? 0));

  // The same aggregated book the book panel shows (shared query).
  const bookFn = useServerFn(getBook);
  const bookQuery = useQuery({
    queryKey: ["book", brand.symbol],
    queryFn: () => bookFn({ data: { symbol: brand.symbol } }),
    refetchInterval: 10_000,
  });

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

  // ---- order checks, the engine's rules (the engine re-checks everything) ----
  const qtyError = validateQty(qty);
  const priceFormatError = orderType === "limit" ? validatePrice(price) : null;
  const qtyNum = qtyError ? 0 : Number(qty);
  const limitPrice = orderType === "limit" && !priceFormatError ? Number(price) : null;
  const outOfBand = limitPrice != null && (limitPrice < band.low || limitPrice > band.high);
  const priceError = priceFormatError ?? (outOfBand ? ("priceOutOfBand" as const) : null);
  // Worst price the order can execute at: its limit, or the band edge for a market order.
  const worstPrice = orderType === "limit" ? limitPrice : side === "buy" ? band.high : band.low;
  const orderValue = qtyNum > 0 && worstPrice != null ? positionValue(qtyNum, worstPrice) : 0;
  // Size limit, measured like the engine: limit x qty, market at the top of the band.
  const sizeValue = qtyNum > 0 ? positionValue(qtyNum, orderType === "limit" ? (limitPrice ?? 0) : band.high) : 0;
  const tooLarge = sizeValue > MAX_ORDER_VALUE;
  const cashNeeded = side === "buy" ? orderCashCommitment(qtyNum, orderType, limitPrice, band.high) : 0;
  const haveAccount = signedIn === true && !!summary;
  const shortCash = haveAccount && side === "buy" && cashNeeded > (summary?.buyingPower ?? 0);
  const shortUnits = haveAccount && side === "sell" && qtyNum > availableQty;
  const crossesOwn = myOpenOrders.some((o) => {
    if (o.side === side || o.price == null) return false;
    if (Number(o.qty) - Number(o.filled_qty ?? 0) <= 0) return false;
    const p = Number(o.price);
    return side === "buy" ? p <= (limitPrice ?? band.high) : p >= (limitPrice ?? band.low);
  });
  const book = bookQuery.data ?? null;
  const marketEstimate =
    orderType === "market" && qtyNum > 0 && book ? estimateMarketFill(side, qtyNum, book, band) : null;
  const orderInvalid = !!qtyError || !!priceError || tooLarge || shortCash || shortUnits || crossesOwn;

  // Largest whole quantity the account can place now.
  const maxQty = (() => {
    if (side === "sell") return availableQty;
    const unit = orderType === "limit" ? limitPrice : band.high;
    if (!summary || unit == null || !(unit > 0)) return 0;
    const byCash = Math.floor((Math.round(summary.buyingPower * 100)) / Math.round(unit * 100));
    const bySize = Math.floor(Math.round(MAX_ORDER_VALUE * 100) / Math.round(unit * 100));
    return Math.max(0, Math.min(byCash, bySize, MAX_ORDER_QTY));
  })();

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
      qc.invalidateQueries({ queryKey: ["portfolio"] });
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
  const sideLabel = side === "buy" ? t("buy") : t("sell");
  const typeLabel = orderType === "limit" ? t("limit") : t("market");

  const submit = async () => {
    if (orderInvalid) return;
    const money = (n: number) => isolateLtr(formatNum(n, "currency"));
    const lines = [
      `${sideLabel} · ${typeLabel} · ${isolateLtr(formatNum(qtyNum, "qty"))} ${brand.symbol}`,
      orderType === "limit"
        ? `${t("price")}: ${isolateLtr(formatNum(limitPrice, "number"))}`
        : `${t("m_marketRange")}: ${isolateLtr(formatNum(band.low, "number"))} – ${isolateLtr(formatNum(band.high, "number"))}`,
      side === "buy"
        ? `${orderType === "limit" ? t("m_estCost") : t("m_maxCost")}: ${money(cashNeeded)}`
        : `${orderType === "limit" ? t("m_estProceeds") : t("m_minPriceProceeds")}: ${money(orderValue)}`,
      `${t("m_fees")}: ${t("m_feesNone")}`,
    ];
    const ok = await confirm({
      title: t("confirmOrderTitle"),
      description: `${lines.join(" · ")} — ${t("confirmOrderDesc")}`,
      confirmLabel: sideLabel,
      cancelLabel: t("cancel"),
      tone: side === "sell" ? "danger" : "default",
    });
    if (ok) orderMutation.mutate();
  };

  const warning =
    tooLarge ? t("orderTooLarge")
    : crossesOwn ? t("errSelfTrade")
    : shortCash ? t("m_shortCash")
    : shortUnits ? (heldQty > 0 ? t("m_shortUnits") : t("m_noUnits"))
    : null;

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
      {/* Mobile first: instrument, order ticket, chart and tape, then the list.
          From lg: list | instrument + chart + tape | ticket + book + orders. */}
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr]">
        {/* Watchlist */}
        <aside className="order-5 rounded-xl border border-border/60 bg-card/60 p-3 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)] lg:self-start">
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

        {/* Instrument and chart */}
        <div className="order-1 min-w-0 space-y-4 lg:order-none lg:col-start-2 lg:row-start-1">
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
                <Num value={mark.price} className="block font-mono text-xl font-bold text-foreground" />
                <div className="text-[10px] text-muted-foreground">{mark.isReference ? t("e2_referencePriceNoTrades") : t("lastPrice")}</div>
                <ChangeText pct={brand.change24hPct} className="text-xs" />
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-border/40 pt-3 text-xs sm:grid-cols-3 xl:grid-cols-6">
              <MiniStat label={t("e2_dayOpen")} v={<Num value={brand.dayOpen} />} />
              <MiniStat label={t("e2_dayHigh")} v={<Num value={brand.dayHigh} />} />
              <MiniStat label={t("e2_dayLow")} v={<Num value={brand.dayLow} />} />
              <MiniStat label={t("e2_volumeUnits24h")} v={<Num value={brand.volume24hUnits} kind="qty" />} />
              <MiniStat label={t("e2_value24h")} v={<span dir="ltr" className="tabular-nums" style={{ unicodeBidi: "isolate" }}>{formatCurrency(brand.volume24hValue, true, lang)}</span>} />
              <MiniStat label={t("m_todaysRange")} v={<PriceRange low={band.low} high={band.high} />} />
            </dl>
          </section>
          <ChartPanel symbol={brand.symbol} height={isMobile ? 300 : 460} />
        </div>

        {/* Order ticket, book, own orders */}
        <aside className="order-2 space-y-4 lg:order-none lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:self-start">
          <div className="rounded-xl border border-border/60 bg-card/60 p-4">
            <div className="mb-3 grid grid-cols-2 rounded-md bg-secondary/40 p-1 text-sm font-semibold" role="group" aria-label={t("m_orderSide")}>
              <button type="button" aria-pressed={side === "buy"} onClick={() => setSide("buy")} className={`min-h-10 rounded-md py-2 transition ${side === "buy" ? "bg-[var(--bull)] text-ivory" : "text-muted-foreground"}`}>{t("buy")}</button>
              <button type="button" aria-pressed={side === "sell"} onClick={() => setSide("sell")} className={`min-h-10 rounded-md py-2 transition ${side === "sell" ? "bg-[var(--bear)] text-ivory" : "text-muted-foreground"}`}>{t("sell")}</button>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs" role="group" aria-label={t("orderType")}>
              <button type="button" aria-pressed={orderType === "limit"} onClick={() => setOrderType("limit")} className={`min-h-9 rounded border px-2 py-1.5 ${orderType === "limit" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{t("limit")}</button>
              <button type="button" aria-pressed={orderType === "market"} onClick={() => setOrderType("market")} className={`min-h-9 rounded border px-2 py-1.5 ${orderType === "market" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{t("market")}</button>
            </div>
            <p className="mb-1 text-[11px] leading-relaxed text-muted-foreground">
              {orderType === "limit" ? t("m_limitHelp") : side === "buy" ? t("m_marketBuyHelp") : t("m_marketSellHelp")}
            </p>
            {orderType === "limit" && (
              <Field label={t("price")} error={priceError ? t(priceError) : undefined} errorId="order-price-error" hintId="order-price-hint">
                <input
                  type="number"
                  inputMode="decimal"
                  min={band.low}
                  max={band.high}
                  step="0.01"
                  dir="ltr"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  aria-invalid={!!priceError}
                  aria-describedby={priceError ? "order-price-hint order-price-error" : "order-price-hint"}
                  className="w-full bg-transparent text-end font-mono text-sm outline-none"
                />
              </Field>
            )}
            <p id="order-price-hint" className="mt-1 text-[10px] text-muted-foreground">
              {t("m_allowedToday")}{" "}
              <PriceRange low={band.low} high={band.high} className="font-semibold text-ink-soft" />
            </p>
            <Field
              label={t("qty")}
              error={qtyError ? t(qtyError) : undefined}
              errorId="order-qty-error"
              action={
                signedIn === true && summary ? (
                  <button
                    type="button"
                    onClick={() => maxQty > 0 && setQty(String(maxQty))}
                    disabled={maxQty <= 0}
                    className="rounded border border-border px-1.5 text-[10px] font-semibold text-ink-soft hover:border-[var(--gold-deep)] disabled:opacity-40"
                  >
                    {t("m_max")}
                  </button>
                ) : null
              }
            >
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max={MAX_ORDER_QTY}
                step="1"
                dir="ltr"
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
                <Row label={t("orderType")} value={<span className="font-semibold text-ink">{sideLabel} · {typeLabel}</span>} />
                <Row label={t("qty")} value={<span className="font-semibold text-ink"><Num value={qtyNum} kind="qty" /> {brand.symbol}</span>} />
                <Row
                  label={t("price")}
                  value={orderType === "limit"
                    ? <Num value={limitPrice} className="font-semibold text-ink" />
                    : <span className="font-semibold text-ink">{t("m_bestInRange")}</span>}
                />
                {orderType === "market" && (
                  <Row
                    label={t("m_estFromBook")}
                    value={
                      bookQuery.isLoading ? <span className="text-ink-soft">…</span>
                      : marketEstimate && marketEstimate.filledQty > 0 ? <Num value={marketEstimate.amount} kind="currency" className="font-semibold text-ink" />
                      : <span className="text-ink-soft">{t("m_noLiquidity")}</span>
                    }
                  />
                )}
                <Row
                  strong
                  label={side === "buy"
                    ? (orderType === "limit" ? t("m_estCost") : t("m_maxCost"))
                    : (orderType === "limit" ? t("m_estProceeds") : t("m_minPriceProceeds"))}
                  value={<Num value={side === "buy" ? cashNeeded : orderValue} kind="currency" className="font-semibold text-ink" />}
                />
                <Row label={t("m_fees")} value={<span className="font-semibold text-ink">{t("m_feesNone")}</span>} />
                {signedIn === true && summary && (
                  side === "buy" ? (
                    <Row label={t("m_buyingPowerAfter")} value={<Num value={summary.buyingPower - cashNeeded} kind="currency" className={`font-semibold ${summary.buyingPower - cashNeeded < 0 ? "text-[var(--bear)]" : "text-ink"}`} />} />
                  ) : (
                    <Row label={t("m_availableUnits")} value={<Num value={availableQty} kind="qty" className="font-semibold text-ink" />} />
                  )
                )}
              </dl>
              {orderType === "market" && marketEstimate && marketEstimate.filledQty > 0 && marketEstimate.filledQty < qtyNum && (
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                  {t("m_partialLiquidity").replace("{n}", formatNum(marketEstimate.filledQty, "qty"))}
                </p>
              )}
              {side === "buy" && (
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                  {orderType === "limit" ? t("m_reserveNoteLimit") : t("m_reserveNoteMarket")}
                </p>
              )}
            </div>
            {warning && (
              <p role="alert" className="mt-2 rounded-md border border-[var(--bear)]/30 bg-[var(--bear)]/5 px-2 py-1.5 text-[11px] text-[var(--bear)]">
                {warning}
              </p>
            )}
            <PermissionHint allowed={rolesLoading || isTrader} reason={signedIn === false ? t("signInToTrade") : t("traderRequired")}>
              <button
                type="button"
                disabled={orderMutation.isPending || rolesLoading || !isTrader || orderInvalid}
                title={!isTrader ? (signedIn === false ? t("signInToTrade") : t("traderRequired")) : undefined}
                onClick={() => void submit()}
                className={`mt-3 min-h-11 w-full rounded-md py-2.5 text-sm font-semibold text-ivory transition disabled:opacity-60 ${side === "buy" ? "bg-[var(--bull)]" : "bg-[var(--bear)]"}`}
              >
                {orderMutation.isPending ? "…" : `${sideLabel} ${brand.symbol}`}
              </button>
            </PermissionHint>
            <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
              {orderMutation.isPending
                ? t("a11yOrderSubmitting")
                : outcome}
            </div>

            {/* Account: cash, reserved by resting buys, buying power */}
            <div className="mt-3 border-t border-border/40 pt-3 text-[11px]">
              {signedIn === false ? (
                <Link to="/auth" search={{ redirect: `/trade/${brand.slug}` }} className="font-semibold text-[var(--gold-deep)] hover:underline">
                  {t("signInToSeeBalance")}
                </Link>
              ) : signedIn === null || portfolioQuery.isLoading ? (
                <span className="block h-3 w-24 animate-pulse rounded bg-secondary/60" aria-label={t("loading")} />
              ) : portfolioQuery.isError || !summary ? (
                <button type="button" onClick={() => portfolioQuery.refetch()} className="text-[var(--bear)] hover:underline">{t("errInternal")}</button>
              ) : (
                <dl className="space-y-1">
                  <Row label={t("m_buyingPower")} value={<Num value={summary.buyingPower} kind="currency" className="font-semibold text-ink" />} />
                  <Row label={t("m_cashBalance")} value={<Num value={summary.cash} kind="currency" className="text-ink-soft" />} />
                  <Row label={t("m_reservedByOrders")} value={<Num value={summary.reserved} kind="currency" className="text-ink-soft" />} />
                  <Row label={t("m_heldUnits")} value={<span className="text-ink-soft"><Num value={heldQty} kind="qty" /> {brand.symbol}</span>} />
                </dl>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => alertMutation.mutate("above")} className="min-h-9 rounded border border-border px-2 py-1.5 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]">↑ {t("alertAbove")}</button>
              <button type="button" onClick={() => alertMutation.mutate("below")} className="min-h-9 rounded border border-border px-2 py-1.5 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]">↓ {t("alertBelow")}</button>
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
                  <li key={o.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-1 py-1 text-[11px]">
                    <span className={o.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]"}>
                      {o.side === "buy" ? t("buy") : t("sell")}{" "}
                      <Num value={Number(o.qty) - Number(o.filled_qty)} kind="qty" />/<Num value={Number(o.qty)} kind="qty" />{" @ "}
                      {o.price == null ? t("market") : <Num value={Number(o.price)} />}
                    </span>
                    <button
                      type="button"
                      onClick={() => cancelMutation.mutate(o.id)}
                      disabled={cancelMutation.isPending}
                      className="min-h-8 rounded border border-border px-2 py-0.5 text-[10px] text-ink-soft hover:border-[var(--bear)] disabled:opacity-60"
                    >
                      {t("cancel")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Executed trades */}
        <div className="order-3 min-w-0 lg:order-none lg:col-start-2 lg:row-start-2 lg:self-start">
          <RecentTradesPanel symbol={brand.symbol} />
        </div>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  children,
  error,
  errorId,
  hintId,
  action,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  errorId?: string;
  hintId?: string;
  action?: React.ReactNode;
}) {
  void hintId;
  return (
    <div className="mt-2">
      <div className={`rounded-md border bg-background/60 px-3 py-2 ${error ? "border-[var(--bear)]/60" : "border-border"}`}>
        <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] uppercase text-muted-foreground">
          <span>{label}</span>
          {action}
        </div>
        <label className="block">
          <span className="sr-only">{label}</span>
          {children}
        </label>
      </div>
      {error && <p id={errorId} className="mt-1 text-[10px] text-[var(--bear)]">{error}</p>}
    </div>
  );
}
function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${strong ? "border-t border-border/40 pt-1" : ""}`}>
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-end">{value}</dd>
    </div>
  );
}
/** A low – high price range, always read left to right (also inside Arabic text). */
function PriceRange({ low, high, className }: { low: number; high: number; className?: string }) {
  return (
    <span dir="ltr" className={`tabular-nums ${className ?? ""}`} style={{ unicodeBidi: "isolate" }}>
      {formatNum(low, "number")} – {formatNum(high, "number")}
    </span>
  );
}
function MiniStat({ label, v }: { label: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase text-muted-foreground">{label}</dt>
      <dd className="font-mono text-foreground">{v}</dd>
    </div>
  );
}
