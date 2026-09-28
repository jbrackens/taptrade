"use client";

/**
 * PointsFlow — animated Points values on @number-flow/react (P3).
 *
 * One deliberately SUBDUED timing config for every money-adjacent number
 * in the app: short duration, ease-out, no celebratory spin. This is a
 * points-bought-with-USD product — count-up stimulation on balances,
 * costs, or payouts is the dark pattern the no-dark-patterns rule
 * exists for, so the timing lives here and call sites cannot escalate
 * it. prefers-reduced-motion is respected by the library (renders as a
 * plain text swap).
 *
 * Formatting parity: whole Points, en-US grouping — the same output as
 * lib/points formatPointsAmount for the integer values this renders
 * (the integer-Points contract is enforced upstream by
 * assertIntegerPoints; this component rounds identically).
 */

import NumberFlow from "@number-flow/react";
import { cx } from "./variants";

const SUBDUED = { duration: 300, easing: "ease-out" } as const;
const FADE = { duration: 200, easing: "ease-out" } as const;

export interface PointsFlowProps {
  value: number;
  /** Rendered inside the flow so it never wraps away from the number. */
  suffix?: string;
  className?: string;
  /** "1.5M" instead of "1,500,742" — for tight chrome like the header chip. */
  compact?: boolean;
}

export function PointsFlow({ value, suffix, className, compact = false }: PointsFlowProps) {
  return (
    <NumberFlow
      value={Math.round(value)}
      locales="en-US"
      format={
        compact
          ? { notation: "compact", maximumFractionDigits: 1 }
          : { useGrouping: true, maximumFractionDigits: 0 }
      }
      suffix={suffix}
      transformTiming={SUBDUED}
      spinTiming={SUBDUED}
      opacityTiming={FADE}
      // number-flow pads the inline box for its edge-fade mask (0.5em per
      // side by default) — that widened the TopBar balance chip ~31px and
      // pushed mobile scrollWidth. Digits this small don't need the fade;
      // zero it so the animated number occupies exactly the text's box.
      className={cx(
        "[--number-flow-mask-width:0em] [--number-flow-mask-height:0em]",
        className,
      )}
    />
  );
}
