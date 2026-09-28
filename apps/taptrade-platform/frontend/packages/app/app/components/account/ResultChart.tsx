"use client";

/**
 * ResultChart — the profile's settled-result line: a running total of what
 * settled markets returned, drawn as a soft area. The line carries the
 * direction colour because a settled result is an outcome (DESIGN.md);
 * the dashed hairline marks where the period began.
 */

import { useId } from "react";
import type { ResultPoint } from "./profile-data";

const WIDTH = 1000;
const HEIGHT = 120;
const PAD_Y = 10;

export function ResultChart({
  points,
  up,
  label,
}: {
  points: ResultPoint[];
  up: boolean;
  label: string;
}) {
  // useId's colons would break the url(#…) reference.
  const gradientId = `result-${useId().replace(/[^\w-]/g, "")}`;
  if (points.length < 2) return null;

  const t0 = points[0].at;
  const t1 = points[points.length - 1].at;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const x = (at: number) => (t1 === t0 ? 0 : ((at - t0) / (t1 - t0)) * WIDTH);
  const y = (value: number) =>
    span === 0
      ? HEIGHT / 2
      : PAD_Y + (1 - (value - lo) / span) * (HEIGHT - PAD_Y * 2);

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`;
  const baseY = y(points[0].value).toFixed(1);
  const stroke = up ? "var(--dir-yes)" : "var(--dir-no)";

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="block h-[120px] w-full overflow-visible"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line
        x1="0"
        x2={WIDTH}
        y1={baseY}
        y2={baseY}
        stroke="var(--border-2)"
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
      />
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
