"use client";

/**
 * MarketChart — the market page price chart
 * (P9.2, 2026-07-07 — Robinhood-structure pass).
 *
 * Draws BOTH sides of the binary from one history: the selected side's
 * line at full strength, its complement (100 − price) muted underneath —
 * the two lines mirror around 50 and cross exactly like the two-outcome
 * charts on Robinhood/Kalshi event pages. No gradient wash, no gridlines,
 * no in-chart price header (MarketHead owns the numbers now); a quiet
 * mono text-tab range switcher sits under the plot.
 *
 * Pulls volume-weighted YES price buckets from
 * /api/v1/markets/{id}/prices for the selected range, with carry-forward
 * applied to empty buckets server-side. The chart is honest about missing
 * data: loading shows a skeleton, a failed fetch shows an unavailable
 * panel with retry, and a market without price movement draws a flat line
 * at the real current price. Only the demo flag
 * (NEXT_PUBLIC_DEMO_SYNTHETIC_CHARTS) restores the synthetic-walk
 * fallback for seeded demo boxes.
 */

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import type { MarketPriceHistory } from "@taptrade-ui/api-client/src/prediction-types";
import { logger } from "../../lib/logger";
import { DEMO_SYNTHETIC_CHARTS } from "../../lib/features";
import {
  type ChartFetchStatus,
  resolveChartSeries,
} from "./market-chart-state";

type TimeRange = "1H" | "6H" | "1D" | "1W" | "ALL";

const api = createPredictionClient();

// Map the chart's UI range labels to the backend's /prices?range= values.
// 6H is the odd one out — the backend doesn't ship 6h buckets (the demo
// has too little volume to make them meaningful); map to 1d so the chart
// still loads and the granularity is the same hourly bucket size.
const RANGE_TO_API: Record<TimeRange, "1h" | "1d" | "1w" | "1m" | "all"> = {
  "1H": "1h",
  "6H": "1d",
  "1D": "1d",
  "1W": "1w",
  ALL: "all",
};

interface MarketChartProps {
  ticker: string;
  side?: "yes" | "no";
  yesPricePoints: number;
  noPricePoints?: number;
  /** Plot height in px (default 300). */
  height?: number;
}

const RANGES: TimeRange[] = ["1H", "6H", "1D", "1W", "ALL"];

// Range spans for synthesizing bucket timestamps when the series has no
// real buckets (synthetic walks, flat empty-state lines). Real data uses
// the server's bucketStart times.
const RANGE_SPAN_SEC: Record<TimeRange, number> = {
  "1H": 3_600,
  "6H": 21_600,
  "1D": 86_400,
  "1W": 604_800,
  ALL: 90 * 86_400,
};

// The canvas renderer is client-only (lightweight-charts touches window
// at import time) and lazy: the market route pays for it on interaction
// readiness, and the fixed-height fallback reserves the box so the late
// mount can never shift layout (CLS).
const MarketChartCanvas = dynamic(() => import("./MarketChartCanvas"), {
  ssr: false,
  loading: () => (
    <div
      className="h-[300px] w-full animate-pulse rounded-[var(--r-rh-sm)] bg-[var(--surface-2)]"
      aria-hidden="true"
    />
  ),
});

const CHART_CARD_CLASS = "";
// The range switcher is a row of quiet text tabs under the plot; the
// current range sits on a soft raised chip (Robinhood / Kalshi pattern).
const CHART_SWITCHER_CLASS = "mt-3 flex items-center gap-1";
const CHART_BUTTON_BASE_CLASS =
  "cursor-pointer rounded-[6px] border-0 bg-transparent px-2 py-1 text-[12px] font-semibold tabular-nums transition-[background-color,color,box-shadow] duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] disabled:cursor-not-allowed disabled:border-[var(--inert-border)] disabled:text-[var(--inert-label)]";

function rangeButtonClass(active: boolean): string {
  return `${CHART_BUTTON_BASE_CLASS} ${
    active
      ? "bg-[var(--surface-2)] text-[var(--t1)]"
      : "text-[var(--t3)] hover:text-[var(--t1)]"
  }`;
}

export default function MarketChart({
  ticker,
  side = "yes",
  yesPricePoints,
  noPricePoints,
  height = 300,
}: MarketChartProps) {
  const { t } = useTranslation("prediction");
  const [range, setRange] = useState<TimeRange>("1D");
  const [history, setHistory] = useState<MarketPriceHistory | null>(null);
  const [fetchStatus, setFetchStatus] = useState<ChartFetchStatus>("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const activePricePoints =
    side === "no" ? (noPricePoints ?? 100 - yesPricePoints) : yesPricePoints;

  // Fetch real price history from /api/v1/markets/:ticker/prices?range=N
  // whenever the ticker or range changes (or the user hits Retry). The
  // fetch state resets to loading on every change so a failed range
  // doesn't poison the next one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce is the Retry button's refetch signal — an intentional extra dependency
  useEffect(() => {
    let cancelled = false;
    setFetchStatus("loading");
    setHistory(null);
    api
      .getMarketPriceHistory(ticker, RANGE_TO_API[range])
      .then((h) => {
        if (cancelled) return;
        setHistory(h);
        setFetchStatus("success");
      })
      .catch((err: unknown) => {
        logger.warn("MarketChart", "price history fetch failed", err);
        if (cancelled) return;
        setHistory(null);
        setFetchStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, range, retryNonce]);

  const {
    state: chartState,
    values,
    synthetic,
  } = useMemo(() => {
    const realValues = history
      ? history.points.map((p) =>
          side === "no" ? 100 - p.yesPricePoints : p.yesPricePoints,
        )
      : null;
    return resolveChartSeries({
      fetchStatus,
      realValues,
      currentPricePoints: activePricePoints,
      syntheticSeed: `${ticker}-${side}`,
      range,
      syntheticFallbackEnabled: DEMO_SYNTHETIC_CHARTS,
    });
  }, [fetchStatus, history, ticker, side, range, activePricePoints]);
  // Bucket timestamps for the canvas: real series use the server's
  // bucketStart; synthetic/flat series get a synthesized span ending now
  // (deterministic under the visual suite's frozen clock).
  const times = useMemo(() => {
    if (
      history &&
      history.points.length === values.length &&
      values.length > 0
    ) {
      return history.points.map((point) =>
        Math.floor(Date.parse(point.bucketStart) / 1000),
      );
    }
    const count = values.length;
    if (count === 0) return [];
    const end = Math.floor(Date.now() / 1000);
    const span = RANGE_SPAN_SEC[range];
    const step = count > 1 ? span / (count - 1) : span;
    return Array.from({ length: count }, (_, i) =>
      Math.floor(end - span + i * step),
    );
  }, [history, values, range]);

  return (
    <section className={`${CHART_CARD_CLASS} relative`}>
      {synthetic && (
        <span className="absolute right-2 top-2 z-10 rounded-[var(--r-pill)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--t3)]">
          {t("SIMULATED_DATA", "Simulated data")}
        </span>
      )}
      {chartState === "loading" && (
        <div
          className="w-full animate-pulse rounded-[var(--r-rh-sm)] bg-[var(--surface-2)]"
          style={{ height }}
          role="status"
          aria-label={t("CHART_LOADING")}
        />
      )}

      {chartState === "error" && (
        <div
          className="flex w-full flex-col items-center justify-center gap-3 rounded-[var(--r-rh-sm)] border border-[var(--border-1)] bg-[var(--surface-2)]"
          style={{ height }}
        >
          <div className="text-sm font-medium text-[var(--t3)]">
            {t("PRICE_HISTORY_UNAVAILABLE")}
          </div>
          <button
            type="button"
            className="cursor-pointer rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-1)] px-4 py-1.5 text-xs font-semibold text-[var(--t1)] transition-[background-color,border-color,color] duration-[120ms] hover:border-[var(--t3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)] active:translate-y-px"
            onClick={() => setRetryNonce((n) => n + 1)}
          >
            {t("RETRY")}
          </button>
        </div>
      )}

      {(chartState === "ready" || chartState === "empty") && (
        <div className="relative">
          <MarketChartCanvas
            values={values}
            times={times}
            height={height}
            tone={side}
            ariaLabel={t(
              side === "no" ? "NO_PRICE_CHART" : "YES_PRICE_CHART",
              { ticker },
            )}
          />
          {chartState === "empty" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-7">
              <span className="text-sm text-[var(--t3)]">
                {t("NO_TRADES_IN_RANGE")}
              </span>
            </div>
          )}
        </div>
      )}

      <div
        className={CHART_SWITCHER_CLASS}
        role="tablist"
        aria-label={t("TIME_RANGE")}
      >
        {RANGES.map((r) => (
          <button
            type="button"
            key={r}
            role="tab"
            aria-selected={r === range}
            className={rangeButtonClass(r === range)}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>
    </section>
  );
}
