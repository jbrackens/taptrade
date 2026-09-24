/**
 * Tap Trade brand mark — "Call it" (2026-09-24): a check (you called it)
 * whose long stroke launches into the pink tap dot.
 *
 * The artwork lives in public/brand/ as source SVGs (ink, light, brand);
 * app/icon.svg is the tile version for favicons and home-screen icons.
 * Geometry: 14-unit round stroke, 8.5-unit dot, tight 80.36 × 72.10 box.
 */

import Image from "next/image";

type BrandMarkTone = "brand" | "ink" | "light";

type BrandMarkProps = {
  className?: string;
  /** Width in pixels; the height follows the mark's 80.36 × 72.10 box. */
  size?: number;
  tone?: BrandMarkTone;
};

// Bump whenever the artwork changes. /brand/* is served with a 4-hour
// browser cache under a stable filename, so without a new URL returning
// visitors keep painting the previous mark (the staircase lingered after
// the "Call it" deploy for exactly this reason).
const MARK_VERSION = "call-it-1";

const MARK_SOURCE: Record<BrandMarkTone, string> = {
  brand: `/brand/taptrade-mark-brand.svg?v=${MARK_VERSION}`,
  ink: `/brand/taptrade-mark-ink.svg?v=${MARK_VERSION}`,
  light: `/brand/taptrade-mark-light.svg?v=${MARK_VERSION}`,
};

export default function BrandMark({
  className = "",
  size = 30,
  tone = "ink",
}: BrandMarkProps) {
  const height = (size * 72.1) / 80.36;

  return (
    <Image
      aria-hidden="true"
      alt=""
      className={`block shrink-0 object-contain ${className}`}
      height={height}
      src={MARK_SOURCE[tone]}
      style={{ height: "auto" }}
      unoptimized
      width={size}
    />
  );
}
