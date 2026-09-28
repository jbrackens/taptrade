/**
 * Pure helpers behind the profile page: the settled-result series its chart
 * draws, and what an open position is worth at the market's current price.
 * No React, so the arithmetic is unit-tested on its own.
 */

import type {
  Position,
  PredictionMarket,
  SettledPositionResult,
} from "@taptrade-ui/api-client/src/prediction-types";

export type ResultPeriod = "1w" | "1m" | "all";

export interface ResultPoint {
  /** Epoch milliseconds. */
  at: number;
  /** Running settled result, in Points, up to and including this moment. */
  value: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_MS: Record<Exclude<ResultPeriod, "all">, number> = {
  "1w": 7 * DAY_MS,
  "1m": 30 * DAY_MS,
};

/** Running total of settled results, oldest first. */
export function settledResultSeries(
  history: SettledPositionResult[],
): ResultPoint[] {
  const rows = history
    .map((h) => ({ at: Date.parse(h.paidAt), delta: h.realizedPoints }))
    .filter((r) => Number.isFinite(r.at) && Number.isFinite(r.delta))
    .sort((a, b) => a.at - b.at);
  let total = 0;
  return rows.map((r) => {
    total += r.delta;
    return { at: r.at, value: total };
  });
}

/**
 * The series seen through one period: the running total entering the
 * window, each settlement inside it, then flat to now. `change` is what
 * the period added. An empty history yields no points.
 */
export function seriesForPeriod(
  series: ResultPoint[],
  period: ResultPeriod,
  now: number,
): { points: ResultPoint[]; change: number } {
  if (series.length === 0) return { points: [], change: 0 };

  let start: number;
  let base: number;
  if (period === "all") {
    // Begin at zero a little before the first settlement so the first
    // result reads as a move, not a vertical wall at the left edge.
    const span = Math.max(now - series[0].at, DAY_MS);
    start = series[0].at - span * 0.04;
    base = 0;
  } else {
    start = now - PERIOD_MS[period];
    let entering = 0;
    for (const p of series) {
      if (p.at >= start) break;
      entering = p.value;
    }
    base = entering;
  }

  const inside = series.filter((p) => p.at >= start && p.at <= now);
  const last = inside.length > 0 ? inside[inside.length - 1].value : base;
  const points = [{ at: start, value: base }, ...inside, { at: now, value: last }];
  return { points, change: last - base };
}

export interface PositionMark {
  /** The side's current price, 1–99 Points; undefined when the market is unknown. */
  price?: number;
  /** What the holding is worth now (a voided market refunds at cost). */
  value?: number;
  /** value − cost. */
  gain?: number;
}

export function positionMark(
  position: Position,
  market: PredictionMarket | undefined,
): PositionMark {
  if (!market) return {};
  if (market.status === "voided") {
    return { value: position.totalCostPoints, gain: 0 };
  }
  const price =
    position.side === "yes" ? market.yesPricePoints : market.noPricePoints;
  const value = position.quantity * price;
  return { price, value, gain: value - position.totalCostPoints };
}

/** Up to two initials for an avatar: "Maria Santos" → "MS", "demo@x" → "D". */
export function profileInitials(name: string): string {
  const cleaned = name.split("@")[0].replace(/[^\p{L}\p{N}\s._-]/gu, " ");
  const words = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0].charAt(0);
  const second = words.length > 1 ? words[words.length - 1].charAt(0) : "";
  return (first + second).toUpperCase();
}
