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
  return `${lowPoints} – ${highPoints} Clout`;
}

/** Smallest vertical window the chart shows, in Clout (= percentage points). */
export const CHART_MIN_SPAN = 10;
const CHART_STEP = 5;

/**
 * The chart's vertical range: fitted to the data (2026-09-29 redesign — a
 * fixed 0–100 range drew a 55→58 market as a flat line in an empty box),
 * snapped outward to 5-point steps so the axis reads 50% / 55% / 60%, and
 * never narrower than CHART_MIN_SPAN so a one-point wobble doesn't read as
 * a crash. Clamped to 0–100, keeping the window's width at the edges.
 */
export function chartDomain(values: number[]): { min: number; max: number } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: 0, max: 100 };
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const span = Math.max(hi - lo, CHART_MIN_SPAN);
  const mid = (lo + hi) / 2;
  let min = Math.floor((mid - span / 2) / CHART_STEP) * CHART_STEP;
  let max = Math.ceil((mid + span / 2) / CHART_STEP) * CHART_STEP;
  const width = max - min;
  if (min < 0) {
    min = 0;
    max = Math.min(100, width);
  }
  if (max > 100) {
    max = 100;
    min = Math.max(0, 100 - width);
  }
  return { min, max };
}

/**
 * Where the chart's % labels and dotted guides sit: every 5 points on a
 * narrow range, 10 on a mid one, 20 on a wide one (so a 10–90 market does
 * not print seventeen labels).
 */
export function chartAxisTicks(domain: { min: number; max: number }): number[] {
  const span = domain.max - domain.min;
  const step = span <= 20 ? 5 : span <= 50 ? 10 : 20;
  const ticks: number[] = [];
  for (let p = Math.ceil(domain.min / step) * step; p <= domain.max; p += step) {
    ticks.push(p);
  }
  return ticks;
}
