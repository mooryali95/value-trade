import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useI18n } from "@/lib/i18n";
import { formatInt } from "@/lib/format";
import { CandlestickChart } from "@/components/candlestick-chart";
import { LuxurySkeleton, LuxurySkeletonBlock } from "@/components/luxury-skeleton";
import { MarketDataError, formatDateTime, formatPrice, formatTime } from "@/components/market-data";
import {
  getCandles,
  getPublicInstrument,
  getRecentTrades,
  type CandleInterval,
  type PublicInstrumentDetail,
} from "@/lib/market/public-market.functions";
import { getBook } from "@/lib/trading/book.functions";

/**
 * Market data panels shared by the instrument page and the trade desk. Each
 * panel reads the database through the public market API and shows an
 * explicit loading, empty or error state; none of them substitutes data.
 */

/** The instrument, kept fresh after the route loader's first read. */
export function useLiveInstrument(initial: PublicInstrumentDetail) {
  const fn = useServerFn(getPublicInstrument);
  const q = useQuery({
    queryKey: ["public-instrument", initial.symbol],
    queryFn: () => fn({ data: { slug: initial.symbol } }),
    initialData: initial,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  // A refetch that finds the instrument gone (delisted) keeps showing the
  // last read; the order form refuses unpublished instruments server-side.
  return q.data ?? initial;
}

export function Panel({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border/60 bg-card/60 p-4 ${className ?? ""}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function IntervalToggle({ value, onChange }: { value: CandleInterval; onChange: (v: CandleInterval) => void }) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t("e2_chartInterval")} className="inline-flex rounded-md border border-border bg-background p-0.5 text-[11px]">
      {(["1h", "1d"] as const).map((iv) => (
        <button
          key={iv}
          type="button"
          aria-pressed={value === iv}
          onClick={() => onChange(iv)}
          className={`rounded px-2.5 py-1 font-semibold transition ${value === iv ? "bg-[var(--gold-soft)] text-[var(--gold-deep)]" : "text-ink-soft hover:text-ink"}`}
        >
          {iv === "1h" ? t("e2_interval1h") : t("e2_interval1d")}
        </button>
      ))}
    </div>
  );
}

/** OHLC chart of executed trades (1h clock hours or Asia/Riyadh days). */
export function ChartPanel({ symbol, height = 440, actions }: { symbol: string; height?: number; actions?: ReactNode }) {
  const { t } = useI18n();
  const [interval, setChartInterval] = useState<CandleInterval>("1d");
  const fn = useServerFn(getCandles);
  const q = useQuery({
    queryKey: ["candles", symbol, interval],
    queryFn: () => fn({ data: { symbol, interval, limit: 200 } }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return (
    <Panel
      title={t("chart")}
      actions={
        <div className="flex items-center gap-2">
          <IntervalToggle value={interval} onChange={setChartInterval} />
          {actions}
        </div>
      }
    >
      {q.isLoading ? (
        <LuxurySkeletonBlock className="h-72 w-full" />
      ) : q.isError ? (
        <MarketDataError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <CandlestickChart candles={q.data ?? []} height={height} intraday={interval === "1h"} />
      )}
    </Panel>
  );
}

/** The public trade tape, newest first. */
export function RecentTradesPanel({ symbol, limit = 20, className }: { symbol: string; limit?: number; className?: string }) {
  const { t, lang } = useI18n();
  const fn = useServerFn(getRecentTrades);
  const q = useQuery({
    queryKey: ["recent-trades", symbol, limit],
    queryFn: () => fn({ data: { symbol, limit } }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const rows = q.data ?? [];
  return (
    <Panel title={t("recentTrades")} className={className}>
      {q.isLoading ? (
        <LuxurySkeleton lines={5} />
      ) : q.isError ? (
        <MarketDataError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{t("e2_noTradesYet")}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <div>{t("price")}</div>
            <div className="text-end">{t("qty")}</div>
            <div className="text-end">{t("e2_colTime")}</div>
          </div>
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {rows.map((r, i) => {
              const prev = rows[i + 1];
              const tone = !prev || r.price === prev.price ? "text-foreground" : r.price > prev.price ? "text-[var(--bull)]" : "text-[var(--bear)]";
              return (
                <li key={`${r.tradedAt}-${i}`} className="grid grid-cols-3 gap-2 py-0.5 font-mono text-xs">
                  <span className={tone}>{formatPrice(r.price)}</span>
                  <span className="text-end text-foreground/80">{formatInt(r.qty)}</span>
                  <span className="text-end text-muted-foreground" title={formatDateTime(r.tradedAt, lang)}>{formatTime(r.tradedAt, lang)}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] text-muted-foreground">{t("e2_riyadhTime")}</p>
        </>
      )}
    </Panel>
  );
}

/** Aggregated resting orders (price levels only, no identities). */
export function OrderBookPanel({
  symbol,
  levels = 12,
  showTotal = true,
  className,
}: {
  symbol: string;
  levels?: number;
  showTotal?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const fn = useServerFn(getBook);
  const q = useQuery({
    queryKey: ["book", symbol],
    queryFn: () => fn({ data: { symbol } }),
    refetchInterval: 10_000,
  });
  const bids = (q.data?.bids ?? []).slice(0, levels);
  const asks = (q.data?.asks ?? []).slice(0, levels);
  const maxQty = Math.max(1, ...bids.map((r) => r.qty), ...asks.map((r) => r.qty));
  const cols = showTotal ? "grid-cols-3" : "grid-cols-2";
  const Row = ({ price, qty, side }: { price: number; qty: number; side: "bid" | "ask" }) => (
    <div className={`relative grid ${cols} gap-2 rounded px-1 py-0.5`}>
      <div
        className={`absolute inset-y-0 end-0 ${side === "ask" ? "bg-[var(--bear)]/10" : "bg-[var(--bull)]/10"}`}
        style={{ width: `${Math.round((qty / maxQty) * 100)}%` }}
      />
      <div className={`relative ${side === "ask" ? "text-[var(--bear)]" : "text-[var(--bull)]"}`}>{formatPrice(price)}</div>
      <div className="relative text-end text-foreground/80">{formatInt(qty)}</div>
      {showTotal && <div className="relative text-end text-muted-foreground">{formatInt(Math.round(price * qty), true)}</div>}
    </div>
  );
  return (
    <Panel title={t("orderBook")} className={className}>
      {q.isLoading ? (
        <LuxurySkeleton lines={8} />
      ) : q.isError ? (
        <MarketDataError error={q.error} onRetry={() => q.refetch()} />
      ) : bids.length === 0 && asks.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{t("e2_bookEmpty")}</p>
      ) : (
        <>
          <div className={`grid ${cols} gap-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground`}>
            <div>{t("price")}</div>
            <div className="text-end">{t("qty")}</div>
            {showTotal && <div className="text-end">{t("total")}</div>}
          </div>
          <div className="space-y-0.5 font-mono text-xs">
            {asks.slice().reverse().map((r) => <Row key={`a${r.price}`} price={r.price} qty={r.qty} side="ask" />)}
            <div className="my-2 rounded bg-secondary/40 px-1 py-1 text-center text-[11px] font-semibold text-ink-soft">
              {q.data?.lastPrice != null
                ? `${t("lastPrice")} ${formatPrice(q.data.lastPrice)}`
                : t("e2_noTradesYet")}
            </div>
            {bids.map((r) => <Row key={`b${r.price}`} price={r.price} qty={r.qty} side="bid" />)}
          </div>
          {(asks.length === 0 || bids.length === 0) && (
            <p className="mt-2 text-[10px] text-muted-foreground">{asks.length === 0 ? t("e2_noAsks") : t("e2_noBids")}</p>
          )}
        </>
      )}
    </Panel>
  );
}
