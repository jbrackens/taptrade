/**
 * points.ts — the single source of truth for Points display.
 *
 * Whole-Points unit model (migration 050, 2026-07-07): API integers ARE
 * whole Points — 1 Point = 1 cent of play value, wire unit "PTS". Nothing
 * in this module (or anywhere downstream of it) divides or multiplies a
 * Points value by 100. Every surface that renders a Points string imports
 * a formatter from here; local per-page formatters are the bug class this
 * module retires (they survived the migration still doing ÷100 and showed
 * the same wire values 100× apart between surfaces).
 */

import { logger } from "./logger";

const POINTS_LOCALE = "en-US";

/**
 * Nil-safe wire guard: numbers round to whole Points, anything else is 0.
 * Use at API-client seams where a field may be absent on legacy payloads.
 */
export function toWholePoints(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : 0;
}

/**
 * Contract guard for the integer-Points model. Wire integers are whole
 * Points; a fractional or non-finite value here means an upstream unit bug
 * (usually a stray ÷100 or ×100). Logs in dev and returns a safe integer so
 * the UI stays honest instead of rendering "6.5 pts".
 */
export function assertIntegerPoints(value: number, context = "points"): number {
  if (!Number.isFinite(value)) {
    logger.warn("Points", `Non-finite ${context} value replaced with 0`, value);
    return 0;
  }
  if (!Number.isInteger(value)) {
    logger.warn("Points", `Non-integer ${context} value rounded`, value);
    return Math.round(value);
  }
  return value;
}

/**
 * The play currency's name. Points are TapTrade's non-redeemable play
 * value; players see them as Clout (2026-09-28: "pts" read as unfinished).
 * Share prices keep the 0–100 scale — a share costs 1–99 Clout and settles
 * at 100, like a 1¢–99¢ contract paying $1. Loyalty progress is XP, a
 * separate thing, and never uses this name.
 */
export const CURRENCY_NAME = "Clout";

/**
 * "42,350" — grouped whole Points WITHOUT the unit suffix, for surfaces
 * that render their own unit label (rewards balance headline, bonus
 * "pts remaining" rows, order-book size columns).
 *
 * Integers never grow decimals ("98", not "98.00"). Non-integral input is
 * out of contract but rendered honestly at 2dp rather than silently lying.
 */
export function formatPointsAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return value.toLocaleString(POINTS_LOCALE);
  return value.toLocaleString(POINTS_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** "42,350 Clout" — the default Points string. Sign-preserving ("-664 Clout"). */
export function formatPoints(value: number): string {
  return `${formatPointsAmount(value)} ${CURRENCY_NAME}`;
}

/**
 * "1.2K Clout" / "3.4M Clout" / "980 Clout" — compact form for dense discovery
 * surfaces (market cards, hero stats, volume pulse). Negative inputs clamp
 * to 0: compact stats are aggregate gauges, never deltas.
 */
export function formatCompactPoints(points: number): string {
  const value = Math.max(0, points);

  if (value >= 1_000_000) {
    return trimTrailingZero(`${(value / 1_000_000).toFixed(1)}M ${CURRENCY_NAME}`);
  }

  if (value >= 1_000) {
    return trimTrailingZero(`${(value / 1_000).toFixed(1)}K ${CURRENCY_NAME}`);
  }

  return `${Math.round(value).toLocaleString(POINTS_LOCALE)} ${CURRENCY_NAME}`;
}

/**
 * Nominal play-value string for a Points amount (1 Point = 1 cent of play
 * value). ONLY for surfaces that explicitly label an approximate nominal
 * value — currently none do; do NOT use this as a general formatter, and
 * never mix its output into Clout copy.
 */
export function pointsToUsdDisplay(points: number): string {
  return (points / 100).toLocaleString(POINTS_LOCALE, {
    style: "currency",
    currency: "USD",
  });
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0([MK])/, "$1");
}
