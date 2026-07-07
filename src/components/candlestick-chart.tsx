import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, HistogramSeries, type IChartApi } from "lightweight-charts";
import type { Candle } from "@/lib/mock-data";

export function CandlestickChart({ candles, height = 420 }: { candles: Candle[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
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
      timeScale: { borderColor: "rgba(120, 100, 60, 0.15)", timeVisible: true, secondsVisible: false },
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
    candleSeries.setData(candles.map((c) => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close })));

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeries.setData(
      candles.map((c) => ({
        time: c.time as any,
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
  }, [candles, height]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}