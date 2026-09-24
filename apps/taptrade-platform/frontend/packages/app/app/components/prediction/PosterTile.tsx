"use client";

/**
 * PosterTile — the typographic stand-in for moment photography (Kilig).
 * Ink-deep ground, the poster word in warm white with its accent in
 * Kilig pink, cropped off the bottom-left edge. Decorative only: the
 * market title carries the meaning, so the art is aria-hidden.
 */

import { type ReactNode, useState } from "react";
import { posterParts } from "./market-poster";

const SIZE_CLASS = {
  wide: "h-[132px] text-[104px] min-[641px]:min-h-[236px] min-[641px]:text-[120px]",
  lead: "text-[clamp(180px,24vw,300px)]",
  thumb: "h-[72px] w-[72px] text-[64px]",
} as const;

export function PosterTile({
  title,
  categoryLabel,
  size,
  imageUrl,
  children,
  className = "",
}: {
  title: string;
  categoryLabel?: string;
  size: keyof typeof SIZE_CLASS;
  /** A market photo, when one exists; replaces the typographic art. */
  imageUrl?: string | null;
  /** Overlay content (chips, headline) rendered above the art. */
  children?: ReactNode;
  className?: string;
}) {
  const { main, accent } = posterParts(title, categoryLabel);
  // A photo that fails to load falls back to the typographic art.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(imageUrl) && !imageFailed;
  return (
    <div
      className={`relative isolate overflow-hidden bg-[var(--poster)] ${SIZE_CLASS[size]} ${className}`}
    >
      {showImage ? (
        // biome-ignore lint/performance/noImgElement: market images are remote, variable-size uploads; next/image would need per-host config
        <img
          src={imageUrl ?? undefined}
          alt=""
          onError={() => setImageFailed(true)}
          aria-hidden="true"
          className="absolute inset-0 -z-10 h-full w-full object-cover opacity-80"
        />
      ) : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-[0.14em] left-[0.1em] -z-10 flex select-none flex-col whitespace-nowrap font-poster font-black uppercase leading-[0.82] tracking-[-0.01em]"
        >
          {/* The category word sits small above the big pink accent, so a
              long word never crops the accent off the tile. */}
          {size !== "thumb" && (
            <span className="text-[0.4em] leading-[0.9] text-[var(--poster-ink)]">
              {main}
            </span>
          )}
          <span className="text-[var(--kilig-bright)]">{accent}</span>
        </span>
      )}
      {children}
    </div>
  );
}
