"use client";

/**
 * MarketThumb — the square image every market carries in lists, cards and
 * headers. A market photo when one exists (falling back if it fails to
 * load); otherwise the category's icon on a soft tile of the category
 * tint. Decorative: the market title beside it carries the meaning.
 */

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { BankIcon as Bank } from "@phosphor-icons/react/dist/csr/Bank";
import { ChartLineUpIcon as ChartLineUp } from "@phosphor-icons/react/dist/csr/ChartLineUp";
import { CpuIcon as Cpu } from "@phosphor-icons/react/dist/csr/Cpu";
import { FilmSlateIcon as FilmSlate } from "@phosphor-icons/react/dist/csr/FilmSlate";
import { GameControllerIcon as GameController } from "@phosphor-icons/react/dist/csr/GameController";
import { SparkleIcon as Sparkle } from "@phosphor-icons/react/dist/csr/Sparkle";
import { TrophyIcon as Trophy } from "@phosphor-icons/react/dist/csr/Trophy";
import { useState } from "react";

interface CategoryVisual {
  icon: PhosphorIcon;
  tint: string;
}

const CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  politics: { icon: Bank, tint: "var(--cat-politics)" },
  sports: { icon: Trophy, tint: "var(--cat-sports)" },
  esports: { icon: GameController, tint: "var(--cat-esports)" },
  entertainment: { icon: FilmSlate, tint: "var(--cat-entertainment)" },
  culture: { icon: FilmSlate, tint: "var(--cat-entertainment)" },
  tech: { icon: Cpu, tint: "var(--cat-tech)" },
  technology: { icon: Cpu, tint: "var(--cat-tech)" },
  economics: { icon: ChartLineUp, tint: "var(--cat-economics)" },
};

const FALLBACK_VISUAL: CategoryVisual = {
  icon: Sparkle,
  tint: "var(--cat-general)",
};

export function categoryVisual(slug: string | undefined | null): CategoryVisual {
  return CATEGORY_VISUALS[(slug ?? "").toLowerCase()] ?? FALLBACK_VISUAL;
}

export function MarketThumb({
  categorySlug,
  imageUrl,
  size = 40,
  className = "",
}: {
  categorySlug?: string | null;
  imageUrl?: string | null;
  size?: 32 | 40 | 48 | 56;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const photo = imageUrl && imageUrl.trim().length > 0 ? imageUrl : null;
  const { icon: Icon, tint } = categoryVisual(categorySlug);
  const radius = size >= 48 ? "rounded-[10px]" : "rounded-[8px]";
  const box = { width: size, height: size };

  if (photo && !imageFailed) {
    return (
      // biome-ignore lint/performance/noImgElement: market images are remote, variable-size uploads; next/image would need per-host config
      <img
        src={photo}
        alt=""
        aria-hidden="true"
        onError={() => setImageFailed(true)}
        style={box}
        className={`shrink-0 object-cover ${radius} ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        ...box,
        color: tint,
        backgroundColor: `color-mix(in srgb, ${tint} 11%, var(--surface-1))`,
      }}
      className={`grid shrink-0 place-items-center ${radius} ${className}`}
    >
      <Icon size={Math.round(size * 0.5)} weight="duotone" />
    </span>
  );
}
