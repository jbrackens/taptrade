"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { formatCompactPoints } from "../../lib/points";
import { isOpenMarketStatus, marketStatusLabel } from "./market-display";
import { PosterTile } from "./PosterTile";

export type MarketCardSize = "standard" | "wide";

interface MarketCardProps {
  marketId: string;
  ticker: string;
  title: string;
  yesPricePoints: number;
  noPricePoints: number;
  volumePoints: number;
  closeAt: string;
  status: string;
  categoryLabel?: string;
  imagePath?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
  watched?: boolean;
  onToggleWatchlist?: (marketId: string) => void;
  /** Position in the current discovery result set (one-based). */
  rank?: number;
  /**
   * Kilig mixed grid: "wide" spans two columns and leads with a poster
   * tile; "standard" is the typographic card.
   */
  size?: MarketCardSize;
  /**
   * When set, YES/NO open an in-place trade panel instead of navigating to
   * the market page with `?side=` preselected.
   */
  onQuickTrade?: (side: "yes" | "no") => void;
}

function formatCloseAt(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Soft direction chips: tinted at rest, filled on hover/press. The side
// colour is the only colour on the card besides the pink trending dot.
const SIDE_BUTTON_CLASS =
  "flex min-h-10 cursor-pointer items-center justify-between rounded-[var(--r-rh-md)] border-0 px-3 font-sans text-[13px] font-bold tracking-[0.01em] no-underline transition-[background-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] active:scale-[0.98] max-[640px]:min-h-11";
const SIDE_TONE: Record<"yes" | "no", string> = {
  yes: "bg-[var(--yes-soft)] text-[var(--yes-text)] hover:bg-[var(--yes)] hover:text-[var(--on-ink)]",
  no: "bg-[var(--no-soft)] text-[var(--no-text)] hover:bg-[var(--no)] hover:text-[var(--on-ink)]",
};

export function MarketCard({
  ticker,
  title,
  yesPricePoints,
  noPricePoints,
  volumePoints,
  closeAt,
  status,
  categoryLabel,
  imagePath,
  imageUrl,
  image_url,
  rank = 1,
  size = "standard",
  onQuickTrade,
}: MarketCardProps) {
  const { t } = useTranslation("prediction");
  const isOpen = isOpenMarketStatus(status);
  // A closed market has nothing to trade in place; its page explains why.
  const quickTrade = isOpen ? onQuickTrade : undefined;
  const yesPercentage = clampPercentage(yesPricePoints);
  const noPercentage = clampPercentage(noPricePoints);
  const rankLabel = String(Math.max(1, Math.round(rank))).padStart(2, "0");
  const wide = size === "wide";
  const photo = [imagePath, imageUrl, image_url].find(
    (value) => value && value.trim().length > 0,
  );
  const closingLabel = isOpen
    ? `${t("CLOSES", "Closes")} ${formatCloseAt(closeAt)}`
    : `${t("STATUS", "Status")} ${marketStatusLabel(status, t)}`;

  return (
    <article
      data-testid="market-card"
      data-size={size}
      className={`relative flex h-full flex-col min-[641px]:min-h-[236px] overflow-hidden rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] font-sans text-[var(--t1)] transition-[border-color] duration-150 hover:border-[var(--border-2)] focus-within:border-[var(--t3)] ${
        // Wide: poster beside the content (same row height as its
        // neighbours); stacked on phones.
        wide ? "min-[641px]:grid min-[641px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]" : ""
      }`}
    >
      {wide && (
        <PosterTile
          title={title}
          categoryLabel={categoryLabel}
          size="wide"
          imageUrl={photo}
          className="min-[641px]:h-full"
        >
          {/* The 132px phone tile has no headroom above the poster word,
              and the card body already names the category. */}
          <span className="absolute left-3 top-3 inline-flex h-6 items-center rounded-full max-[640px]:hidden border border-[rgb(255_255_255/0.16)] bg-[rgb(255_255_255/0.1)] px-2.5 text-[11.5px] font-semibold text-[var(--poster-ink)]">
            {categoryLabel ?? t("MARKET", "Market")}
          </span>
        </PosterTile>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Link
        href={`/market/${ticker}`}
        className="flex min-h-0 flex-1 flex-col px-4 pt-4 text-inherit no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
        aria-label={title}
      >
        <div className="flex h-5 items-center justify-between gap-3 text-[12px] font-semibold text-[var(--t3)]">
          <span className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-[11px] text-[var(--t3)]">{rankLabel}</span>
            <span className="truncate">{categoryLabel ?? t("MARKET", "Market")}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[var(--live-text)]">
            <span
              className="h-1.5 w-1.5 rounded-full bg-[var(--live)]"
              aria-hidden="true"
            />
            {t("TRENDING", "Trending")}
          </span>
        </div>

        <h3
          className={`m-0 mt-2 overflow-hidden font-semibold leading-[1.28] tracking-[-0.012em] text-[var(--t1)] ${
            wide ? "text-[19px]" : "min-h-[42px] text-[16px]"
          }`}
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
          }}
        >
          {title}
        </h3>

        <div className="mt-auto pt-4">
          <div className="flex items-baseline gap-2">
            <span className="mono mono-wide text-[26px] font-semibold leading-none tracking-[-0.04em] text-[var(--t1)]">
              {yesPercentage}%
            </span>
            <span className="text-[12px] text-[var(--t3)]">
              {t("CHANCE", "chance")}
            </span>
          </div>
          <span
            className="mt-2.5 flex h-1.5 gap-[2px]"
            role="img"
            aria-label={`${yesPercentage}% ${t("YES")}`}
          >
            <span
              className="h-full rounded-[var(--r-pill)] bg-[var(--yes)]"
              style={{ width: `${yesPercentage}%` }}
            />
            <span className="h-full min-w-0 flex-1 rounded-[var(--r-pill)] bg-[var(--no-bar)]" />
          </span>
          <p className="m-0 mt-2.5 truncate font-mono text-[11px] text-[var(--t3)]">
            {closingLabel} · {formatCompactPoints(volumePoints)} {t("ACTIVITY", "activity")}
          </p>
        </div>
      </Link>

      <div className="grid grid-cols-2 gap-2 px-4 pb-4 pt-3">
        {(["yes", "no"] as const).map((side) => {
          const percentage = side === "yes" ? yesPercentage : noPercentage;
          const className = `${SIDE_BUTTON_CLASS} ${SIDE_TONE[side]}`;
          const ariaLabel =
            side === "yes"
              ? `${percentage}% ${t("BUY_YES", "Yes")}`
              : `${percentage}% ${t("BUY_NO", "No")}`;
          const content = (
            <>
              <span>{side === "yes" ? t("YES") : t("NO")}</span>
              <span className="font-mono text-[12.5px] font-semibold">{percentage}</span>
            </>
          );
          return quickTrade ? (
            <button
              key={side}
              type="button"
              onClick={() => quickTrade(side)}
              className={className}
              aria-label={ariaLabel}
              aria-haspopup="dialog"
            >
              {content}
            </button>
          ) : (
            <Link
              key={side}
              href={`/market/${ticker}?side=${side}`}
              className={className}
              aria-label={ariaLabel}
            >
              {content}
            </Link>
          );
        })}
      </div>
      </div>
    </article>
  );
}
