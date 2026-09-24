import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { ChartLine } from "@phosphor-icons/react";
import { EmptyState } from "@/components/empty-state";
import { useI18n } from "@/lib/i18n";

/** One OHLC bucket that has trades (see getCandles); `time` is the bucket start (ISO). */
export type ChartCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * The chart library has no time-zone support and labels timestamps as UTC.
 * Buckets are shifted by the Asia/Riyadh offset (UTC+3, no daylight saving)
 * so the axis reads in the market's trading time.
 */
const RIYADH_OFFSET_SECONDS = 3 * 3600;

/** Bucket start (shifted to Riyadh wall time); buckets are unique and ascending. */
function toPoints(candles: ChartCandle[]) {
  const seen = new Set<number>();
  const out: Array<ChartCandle & { ts: UTCTimestamp }> = [];
  for (const c of candles) {
    const ms = Date.parse(c.time);
    if (!Number.isFinite(ms)) continue;
    const ts = Math.floor(ms / 1000) + RIYADH_OFFSET_SECONDS;
    if (seen.has(ts)) continue;
    seen.add(ts);
    out.push({ ...c, ts: ts as UTCTimestamp });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/**
 * Candlestick + volume chart of executed trades. With no candles it renders
 * an explicit "no trades yet" state instead of an empty grid.
 */
export function CandlestickChart({
  candles,
  height = 420,
  emptyTitle,
  emptyDescription,
  intraday = true,
}: {
  candles: ChartCandle[];
  height?: number;
  /** false for daily candles: the axis shows dates only. */
  intraday?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const isEmpty = candles.length === 0;

  useEffect(() => {
    if (!containerRef.current || isEmpty) return;
    const points = toPoints(candles);
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#5A6478",
        fontFamily: "Inter, IBM Plex Sans Arabic, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(120, 100, 60, 0.06)" },
        horzLines: { color: "rgba(120, 100, 60, 0.06)" },
      },
      rightPriceScale: { borderColor: "rgba(120, 100, 60, 0.15)" },
      timeScale: { borderColor: "rgba(120, 100, 60, 0.15)", timeVisible: intraday, secondsVisible: false },
      crosshair: { mode: 1 },
      autoSize: true,
      height,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#3f9d6c",
      downColor: "#a63b2c",
      borderVisible: false,
      wickUpColor: "#3f9d6c",
      wickDownColor: "#a63b2c",
    });
    candleSeries.setData(points.map((c) => ({ time: c.ts, open: c.open, high: c.high, low: c.low, close: c.close })));

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeries.setData(
      points.map((c) => ({
        time: c.ts,
        value: c.volume,
        color: c.close >= c.open ? "rgba(63, 157, 108, 0.28)" : "rgba(166, 59, 44, 0.28)",
      })),
    );

    chart.timeScale().fitContent();
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, height, isEmpty, intraday]);

  if (isEmpty) {
    return (
      <div style={{ minHeight: Math.min(height, 280) }} className="grid place-items-center">
        <div className="w-full">
          <EmptyState
            icon={<ChartLine size={22} weight="duotone" />}
            title={emptyTitle ?? t("e2_noTradesYet")}
            description={emptyDescription ?? t("e2_chartEmptyDesc")}
          />
        </div>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
