/**
 * Shared price-history helpers for the discovery components
 * (DiscoveryHero, TrendingSidebar/TopMovers).
 *
 * 2026-07-12 integrity fix: movement claims (delta pills, mover
 * percentages, sparklines) are REAL-DATA ONLY, computed from the
 * backend /prices series via movementFromSeries / sparklineFromValues.
 * The old deterministicDelta/walk helpers — which invented "Today"
 * movement from a hash of the ticker string — are gone.
 *
 * The one remaining synthetic generator, syntheticHeroValues, exists
 * solely for the demo-box chart FILL while history is loading or
 * absent. It renders only when NEXT_PUBLIC_DEMO_SYNTHETIC_CHARTS is on
 * and the caller MUST display the "Simulated data" chip alongside it.
 * It draws a chart shape; it never feeds a movement claim.
 */

export interface SeriesMovement {
  /** Absolute change over the fetched range, in whole points. */
  deltaPoints: number;
  /** Percent change relative to the range's opening price. */
  pct: number;
  up: boolean;
}

/**
 * Movement from a real price series (range open → last). Returns null
 * when the series can't support an honest movement claim (fewer than
 * two samples, or a flat line). Callers hide their movement UI on null
 * instead of inventing a number.
 */
export function movementFromSeries(
  values: number[] | null | undefined,
): SeriesMovement | null {
  if (!values || values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  if (!values.some((v) => v !== first)) return null;
  if (first <= 0) return null;
  const deltaPoints = last - first;
  return {
    deltaPoints,
    pct: (deltaPoints / first) * 100,
    up: deltaPoints >= 0,
  };
}

/**
 * YES-series → NO-series (prices are complements on a binary market).
 * Used so a NO-leading mover row shows the movement of the side it
 * actually displays.
 */
export function complementSeries(values: number[]): number[] {
  return values.map((v) => 100 - v);
}

/**
 * Catmull-Rom → cubic-bézier smoothing. Polyline charts read as
 * synthetic; a smoothed monotone-ish curve through the same points is
 * the single biggest perceived-quality lever on the hero chart.
 */
function smoothPath(coords: Array<[number, number]>): string {
  if (coords.length < 3) {
    return coords
      .map(
        ([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`,
      )
      .join(" ");
  }
  const d = [`M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`];
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(
      `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`,
    );
  }
  return d.join(" ");
}

/**
 * Hero chart: builds the SVG line + fill paths plus the endpoint
 * coordinate (for the live dot) from a REAL price series (or, on the
 * demo box only, the labeled synthetic fill).
 *
 * P9: the y-domain auto-scales to the series range (with a 6-point minimum
 * span so quiet markets still show topology) instead of the absolute
 * 0–100 band. `baselineY` is the session open (first sample) for the
 * dashed reference line.
 */
export function heroChartPath(
  values: number[],
  width = 800,
  height = 220,
): {
  line: string;
  fill: string;
  end: { x: number; y: number };
  baselineY: number;
} {
  const N = values.length;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const MIN_SPAN = 6;
  if (hi - lo < MIN_SPAN) {
    const mid = (hi + lo) / 2;
    lo = Math.max(0, mid - MIN_SPAN / 2);
    hi = Math.min(100, mid + MIN_SPAN / 2);
  }
  const margin = (hi - lo) * 0.18;
  lo = Math.max(0, lo - margin);
  hi = Math.min(100, hi + margin);
  const pad = height * 0.06;
  const yFor = (v: number) =>
    pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2);
  const coords: Array<[number, number]> = values.map((v, idx) => [
    (idx / (N - 1)) * width,
    yFor(v),
  ]);
  const line = smoothPath(coords);
  const fill = `${line} L${width},${height} L0,${height} Z`;
  const [ex, ey] = coords[N - 1];
  return { line, fill, end: { x: ex, y: ey }, baselineY: yFor(values[0]) };
}

/**
 * Compact sparkline path from a REAL series (Top Movers rows). The
 * series is downsampled to at most `samples` evenly-spaced points and
 * scaled to its own min/max band so small moves stay visible.
 */
export function sparklineFromValues(
  values: number[],
  width = 60,
  height = 28,
  samples = 12,
): string {
  if (values.length < 2) return "";
  const step = Math.max(1, Math.floor(values.length / samples));
  const sampled: number[] = [];
  for (let i = 0; i < values.length; i += step) sampled.push(values[i]);
  if (sampled[sampled.length - 1] !== values[values.length - 1]) {
    sampled.push(values[values.length - 1]);
  }
  let lo = Math.min(...sampled);
  let hi = Math.max(...sampled);
  if (hi - lo < 1) {
    lo -= 0.5;
    hi += 0.5;
  }
  const pad = height * 0.1;
  const N = sampled.length;
  return smoothPath(
    sampled.map((v, i) => [
      (i / (N - 1)) * width,
      pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2),
    ]),
  );
}

/**
 * DEMO-ONLY chart fill (see file header): a deterministic walk ending
 * at the current price, rendered exclusively behind
 * NEXT_PUBLIC_DEMO_SYNTHETIC_CHARTS together with the "Simulated data"
 * chip. Never used for movement claims.
 */
export function syntheticHeroValues(
  ticker: string,
  currentPoints: number,
  N = 24,
): number[] {
  let s = 0;
  for (let i = 0; i < ticker.length; i++) {
    s = ((s << 5) - s + ticker.charCodeAt(i)) | 0;
  }
  s = Math.abs(s) || 1;
  const values: number[] = [];
  let val = 50;
  for (let i = 0; i < N; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((s % 1000) - 500) / 70;
    val = Math.max(8, Math.min(92, val + noise));
    values.push(val);
  }
  values[N - 1] = currentPoints;
  return values;
}
