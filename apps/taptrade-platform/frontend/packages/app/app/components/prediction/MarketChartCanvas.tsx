"use client";

/**
 * MarketChartCanvas — the lightweight-charts v5 renderer behind
 * MarketChart (P4). Owns ONLY drawing: MarketChart keeps the fetch
 * machine, integrity rules, and honest states, and hands this component
 * resolved values. Client-only (next/dynamic ssr:false) with a fixed
 * 300px box reserved by the parent — the chart must never move layout.
 *
 * Design carried over from the P9.2 SVG: the selected side at full
 * strength with an accent gradient wash, its complement (100 − v) muted
 * underneath so the binary reads as one market with two mirrored
 * outcomes; dashed guides at 25/50/75; a FIXED 0–100 domain so the two
 * lines mirror around 50 and cross exactly. New affordances (plan P4):
 * a quiet mono time scale and a crosshair readout.
 */

import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

export interface MarketChartCanvasProps {
  values: number[];
  /** Epoch seconds, same length as values. */
  times: number[];
  ariaLabel: string;
}

function cssVar(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** rgba() from a hex token + alpha (tokens are #rrggbb in DESIGN.md). */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = Number.parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function MarketChartCanvas({
  values,
  times,
  ariaLabel,
}: MarketChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [readout, setReadout] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || values.length < 2 || times.length !== values.length) {
      return;
    }

    const accent = cssVar(container, "--accent") || "#111114";
    const accentLo = cssVar(container, "--accent-lo") || "#111114";
    const muted = cssVar(container, "--t4") || "#576066";
    const guide = cssVar(container, "--border-1") || "#dde2e5";
    const surface = cssVar(container, "--surface-1") || "#ffffff";
    const axisText = cssVar(container, "--t3") || "#576066";

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: axisText,
        fontSize: 10,
        // Canvas text cannot resolve CSS var() itself, so the numeric
        // mono stack (--font-mono → Martian Mono via next/font's hashed
        // family) is read off the computed style like the color tokens.
        fontFamily:
          cssVar(container, "--font-mono") ||
          "ui-monospace, SFMono-Regular, Menlo, monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        // Intraday ranges label ticks with the hour; day boundaries still
        // print the date, so 1W/ALL read as dates.
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
      },
      // Display chart, not a workstation: no pan/zoom (also keeps INP
      // clean — no per-frame kinetic handlers on a page-level scroller).
      handleScroll: false,
      handleScale: false,
      crosshair: {
        horzLine: { visible: false, labelVisible: false },
        vertLine: {
          labelVisible: false,
          color: withAlpha(guide, 0.9) === guide ? guide : withAlpha(guide, 0.9),
          style: LineStyle.Dashed,
        },
      },
      localization: {
        priceFormatter: (p: number) => `${Math.round(p)}`,
      },
    });
    chartRef.current = chart;

    // Both series pin a 0–100 domain with the SVG's 6% padding so the
    // mirrored pair crosses exactly at 50 regardless of data range.
    const fixedDomain = () => ({
      priceRange: { minValue: 0, maxValue: 100 },
      margins: { above: 18, below: 18 },
    });

    const complement = chart.addSeries(LineSeries, {
      color: withAlpha(muted, 0.45),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      autoscaleInfoProvider: fixedDomain,
    });
    const main = chart.addSeries(AreaSeries, {
      lineColor: accentLo,
      lineWidth: 2,
      topColor: withAlpha(accent, 0.24),
      bottomColor: withAlpha(accent, 0),
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerBackgroundColor: accentLo,
      crosshairMarkerBorderColor: surface,
      autoscaleInfoProvider: fixedDomain,
    });

    const mainData = values.map((v, i) => ({
      time: times[i] as UTCTimestamp,
      value: v,
    }));
    main.setData(mainData);
    complement.setData(
      values.map((v, i) => ({
        time: times[i] as UTCTimestamp,
        value: 100 - v,
      })),
    );

    // Dashed guides at 25/50/75 — the SVG's quiet gridlines.
    for (const price of [25, 50, 75]) {
      main.createPriceLine({
        price,
        color: guide,
        lineWidth: 1,
        lineStyle: LineStyle.SparseDotted,
        axisLabelVisible: false,
      });
    }

    // Endpoint dot signature from the SVG (the "current" marker).
    const last = mainData[mainData.length - 1];
    createSeriesMarkers(main, [
      {
        time: last.time,
        position: "inBar",
        color: accentLo,
        shape: "circle",
        size: 0.5,
      },
    ]);

    chart.subscribeCrosshairMove((param) => {
      const point = param.seriesData.get(main) as
        | { value?: number; time?: UTCTimestamp }
        | undefined;
      if (!param.time || point?.value == null) {
        setReadout(null);
        return;
      }
      const when = new Date((param.time as number) * 1000);
      setReadout(
        `${Math.round(point.value)} pts · ${when.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "UTC",
        })} UTC`,
      );
    });

    chart.timeScale().fitContent();

    // React 19 strict mode double-mounts effects in dev: remove() or the
    // second mount stacks a duplicate canvas / throws on disposed objects.
    return () => {
      chartRef.current = null;
      chart.remove();
    };
  }, [values, times]);

  return (
    <div className="relative h-[300px] w-full" aria-label={ariaLabel} role="img">
      <div ref={containerRef} className="absolute inset-0" />
      {readout && (
        <div className="pointer-events-none absolute left-0 top-0 z-10 rounded-[var(--r-rh-sm)] border border-[var(--border-1)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[11px] font-semibold text-[var(--t1)] tabular-nums">
          {readout}
        </div>
      )}
    </div>
  );
}
