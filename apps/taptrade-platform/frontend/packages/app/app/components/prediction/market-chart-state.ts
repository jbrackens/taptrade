/**
 * Chart state resolution for MarketChart, kept as pure functions so the
 * honest-state rules are testable under node:test without a DOM.
 *
 * The synthetic walk (samplePath) is demo-box-only: callers must pass
 * syntheticFallbackEnabled (wired to the NEXT_PUBLIC_DEMO_SYNTHETIC_CHARTS
 * flag). With the flag off, the resolver never fabricates price movement —
 * loading and error draw nothing, and a market with no trades draws a flat
 * line at the real current price.
 */

export type ChartFetchStatus = "loading" | "success" | "error";

export type ChartState = "loading" | "ready" | "empty" | "error";

export interface ChartSeriesResolution {
  state: ChartState;
  /** Points to draw; empty when nothing should be drawn (loading/error). */
  values: number[];
  /**
   * True when  is the demo-flag synthetic walk rather than real
   * price history. Callers MUST render the "Simulated data" chip when
   * this is set (2026-07-12 integrity fix: the demo deploy previously
   * drew synthetic series with no on-screen marker).
   */
  synthetic: boolean;
}

export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export function hashTicker(ticker: string): number {
  let h = 0;
  for (const c of ticker) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return h || 42;
}

export function samplePath(
  ticker: string,
  range: string,
  targetPoints: number,
): number[] {
  const rand = seededRandom(hashTicker(ticker) ^ range.charCodeAt(0));
  const n = 41;
  const points: number[] = [];
  let v = targetPoints + (rand() - 0.5) * 14;
  for (let i = 0; i < n - 1; i++) {
    v += (rand() - 0.5) * 6;
    v = Math.max(8, Math.min(92, v));
    points.push(v);
  }
  points.push(targetPoints);
  return points;
}

export function hasMovement(values: number[]): boolean {
  if (values.length < 2) return false;
  return values.some((v) => v !== values[0]);
}

export function resolveChartSeries(args: {
  fetchStatus: ChartFetchStatus;
  /** Side-adjusted series from the API; null until the fetch succeeds. */
  realValues: number[] | null;
  currentPricePoints: number;
  /** Seed inputs for the synthetic walk (demo flag only). */
  syntheticSeed: string;
  range: string;
  syntheticFallbackEnabled: boolean;
}): ChartSeriesResolution {
  const {
    fetchStatus,
    realValues,
    currentPricePoints,
    syntheticSeed,
    range,
    syntheticFallbackEnabled,
  } = args;

  const realIsDrawable =
    fetchStatus === "success" &&
    realValues !== null &&
    realValues.length > 0 &&
    hasMovement(realValues);

  if (syntheticFallbackEnabled) {
    // Demo behavior: synthetic walk while loading, on error, and for
    // markets without price movement — always flagged so the UI labels it.
    if (realIsDrawable && realValues !== null) {
      return { state: "ready", values: realValues, synthetic: false };
    }
    return {
      state: "ready",
      values: samplePath(syntheticSeed, range, currentPricePoints),
      synthetic: true,
    };
  }

  if (fetchStatus === "loading") {
    return { state: "loading", values: [], synthetic: false };
  }
  if (fetchStatus === "error") {
    return { state: "error", values: [], synthetic: false };
  }
  if (realIsDrawable && realValues !== null) {
    return { state: "ready", values: realValues, synthetic: false };
  }
  // No points, or no price movement: a flat line at the true current price
  // is honest; a random walk is not.
  return {
    state: "empty",
    values: [currentPricePoints, currentPricePoints],
    synthetic: false,
  };
}

/**
 * 24h range stat for the chart footer. Returns null when either bound is
 * missing — the footer renders a dash instead of inventing numbers.
 */
export function format24hRange(
  lowPoints?: number,
  highPoints?: number,
): string | null {
  if (typeof lowPoints !== "number" || typeof highPoints !== "number") {
    return null;
  }
  return `${lowPoints} – ${highPoints} pts`;
}
