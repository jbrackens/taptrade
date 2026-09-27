/**
 * TapTrade brand mark — "First Word" (2026-09-26): a speech tile with a T
 * knocked out, its bottom-left corner running out to a point. Making your
 * call is the brand gesture; the T keeps it ours rather than a chat icon.
 *
 * One colour on purpose: the pink lives on the wordmark's period, never on
 * the T (a magenta T is T-Mobile's territory).
 *
 * The artwork lives in public/brand/ as source SVGs (ink, light);
 * app/icon.svg is the favicon and public/brand/taptrade-app-icon.svg the
 * home-screen tile. Geometry: 84 × 86 box, 74-unit tile, 14-unit T strokes.
 */

import Image from "next/image";

type BrandMarkTone = "ink" | "light";

type BrandMarkProps = {
  className?: string;
  /** Height in pixels; the width follows the mark's 84 × 86 box. */
  size?: number;
  tone?: BrandMarkTone;
};

// Bump whenever the artwork changes. /brand/* is served with a 4-hour
// browser cache under a stable filename, so without a new URL returning
// visitors keep painting the previous mark (the staircase lingered after
// the "Call it" deploy for exactly this reason).
const MARK_VERSION = "first-word-1";

const MARK_SOURCE: Record<BrandMarkTone, string> = {
  ink: `/brand/taptrade-mark-ink.svg?v=${MARK_VERSION}`,
  light: `/brand/taptrade-mark-light.svg?v=${MARK_VERSION}`,
};

export default function BrandMark({
  className = "",
  size = 24,
  tone = "ink",
}: BrandMarkProps) {
  const width = (size * 84) / 86;

  return (
    <Image
      aria-hidden="true"
      alt=""
      className={`block shrink-0 object-contain ${className}`}
      height={size}
      src={MARK_SOURCE[tone]}
      // Preflight sets img { height: auto }, which would drop the height
      // attribute and paint the SVG at its intrinsic 84 × 86.
      style={{ height: size, width: "auto" }}
      unoptimized
      width={width}
    />
  );
}
