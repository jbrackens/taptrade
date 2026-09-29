"use client";

/**
 * MarketChartCanvas — the lightweight-charts v5 renderer behind
 * MarketChart (P4). Owns ONLY drawing: MarketChart keeps the fetch
 * machine, integrity rules, and honest states, and hands this component
 * resolved values. Client-only (next/dynamic ssr:false) with a fixed
 * 300px box reserved by the parent — the chart must never move layout.
 *
 * The selected side at full strength with a faint gradient wash, on a
 * vertical range fitted to the data (chartDomain: 5-point steps, at least
 * 10 points tall) with dotted guides and % labels in a right-hand gutter.
 * The labels are HTML placed with priceToCoordinate: the library's own
 * scale only ticks on its "nice" 2.5-point steps (a minMove of 5 throws),
 * which printed 48% / 53% / 58%. The
 * 2026-09-29 redesign dropped the fixed 0–100 range and the muted
 * complement line: together they drew most markets as a flat line in an
 * empty box. Also: a quiet time scale and a crosshair readout.
 */

import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { chartAxisTicks, chartDomain } from "./market-chart-state";

export interface MarketChartCanvasProps {
  values: number[];
  /** Epoch seconds, same length as values. */
  times: number[];
  ariaLabel: string;
  /** Plot height in px (default 300). */
  height?: number;
  /** Line colour: the side's direction colour, or ink (default). */
  tone?: "yes" | "no" | "ink";
  /** % labels and dotted guides (default true); off for a sparkline. */
  axis?: boolean;
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
  height = 300,
  tone = "ink",
  axis = true,
}: MarketChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [readout, setReadout] = useState<string | null>(null);
  const [axisTicks, setAxisTicks] = useState<{ price: number; y: number }[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: height is a re-layout signal — the % labels are placed from the plot's height
  useEffect(() => {
    const container = containerRef.current;
    if (!container || values.length < 2 || times.length !== values.length) {
      return;
    }

    const toneVar =
      tone === "yes" ? "--dir-yes" : tone === "no" ? "--dir-no" : "--accent";
    const accent = cssVar(container, toneVar) || "#111114";
    const accentLo =
      tone === "ink"
        ? cssVar(container, "--accent-lo") || "#111114"
        : accent;
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
        // numeric stack (--font-mono → Inter via next/font's hashed
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
      // Hidden: the % labels are HTML in the gutter (see the header).
      // Zero scale margins so the fitted range is the drawn range; the
      // autoscale margins below keep the line off the edges.
      rightPriceScale: {
        visible: false,
        scaleMargins: { top: 0, bottom: 0 },
      },
      leftPriceScale: { visible: false },
      timeScale: {
        // A sparkline has no axes at all.
        visible: axis,
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
        priceFormatter: (p: number) => `${Math.round(p)}%`,
      },
    });
    chartRef.current = chart;

    const domain = chartDomain(values);
    const fittedDomain = () => ({
      priceRange: { minValue: domain.min, maxValue: domain.max },
      margins: { above: 10, below: 10 },
    });

    const main = chart.addSeries(AreaSeries, {
      lineColor: accentLo,
      lineWidth: 2,
      topColor: withAlpha(accent, tone === "ink" ? 0.24 : 0.16),
      bottomColor: withAlpha(accent, 0),
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerBackgroundColor: accentLo,
      crosshairMarkerBorderColor: surface,
      autoscaleInfoProvider: fittedDomain,
    });

    const mainData = values.map((v, i) => ({
      time: times[i] as UTCTimestamp,
      value: v,
    }));
    main.setData(mainData);

    // Dotted guides on the axis ticks; their labels are placed once the
    // chart has laid out (priceToCoordinate is null before the first paint).
    const ticks = axis ? chartAxisTicks(domain) : [];
    for (const price of ticks) {
      main.createPriceLine({
        price,
        color: guide,
        lineWidth: 1,
        lineStyle: LineStyle.SparseDotted,
        axisLabelVisible: false,
      });
    }
    const placeAxis = requestAnimationFrame(() => {
      setAxisTicks(
        ticks.flatMap((price) => {
          const y = main.priceToCoordinate(price);
          return y == null ? [] : [{ price, y }];
        }),
      );
    });

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
        `${Math.round(point.value)} Clout · ${when.toLocaleString("en-US", {
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
      cancelAnimationFrame(placeAxis);
      chartRef.current = null;
      chart.remove();
    };
  }, [values, times, tone, height, axis]);

  return (
    <div className="relative w-full" style={{ height }} aria-label={ariaLabel} role="img">
      <div
        ref={containerRef}
        className={axis ? "absolute inset-y-0 left-0 right-10" : "absolute inset-0"}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10">
        {axisTicks.map((tick) => (
          <span
            key={tick.price}
            className="absolute right-0 -translate-y-1/2 text-[11px] font-medium text-[var(--t3)] tabular-nums"
            style={{ top: tick.y }}
          >
            {tick.price}%
          </span>
        ))}
      </div>
      {readout && (
        <div className="pointer-events-none absolute left-0 top-0 z-10 rounded-[var(--r-rh-sm)] border border-[var(--border-1)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[11px] font-semibold text-[var(--t1)] tabular-nums">
          {readout}
        </div>
      )}
    </div>
  );
}
