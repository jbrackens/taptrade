"use client";

/**
 * MarketCard — one binary market in the discovery grid.
 *
 * Anatomy (the Kalshi / Polymarket card): the market's image tile and
 * question on top with the YES chance at the right, the two direction
 * buttons, then one quiet line of volume and close date. Everything is a
 * single typeface; numbers use tabular figures.
 */

import Link from "next/link";
import { BookmarkSimpleIcon as BookmarkSimple } from "@phosphor-icons/react/dist/csr/BookmarkSimple";
import { useTranslation } from "react-i18next";
import { formatCompactPoints } from "../../lib/points";
import { isOpenMarketStatus, marketStatusLabel } from "./market-display";
import { MarketThumb } from "./MarketThumb";

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
  categorySlug?: string;
  imagePath?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
  watched?: boolean;
  onToggleWatchlist?: (marketId: string) => void;
  /**
   * When set, YES/NO open an in-place trade panel instead of navigating to
   * the market page with `?side=` preselected.
   */
  onQuickTrade?: (side: "yes" | "no") => void;
}

function formatCloseAt(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

const SIDE_BUTTON_CLASS =
  "flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--r-rh-md)] border-0 px-3 text-[14px] font-semibold no-underline transition-[background-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] active:scale-[0.98] max-[640px]:h-11";
const SIDE_TONE: Record<"yes" | "no", string> = {
  yes: "bg-[var(--yes-soft)] text-[var(--yes-text)] hover:bg-[var(--yes)] hover:text-[var(--on-ink)]",
  no: "bg-[var(--no-soft)] text-[var(--no-text)] hover:bg-[var(--no)] hover:text-[var(--on-ink)]",
};

export function MarketCard({
  marketId,
  ticker,
  title,
  yesPricePoints,
  noPricePoints,
  volumePoints,
  closeAt,
  status,
  categoryLabel,
  categorySlug,
  imagePath,
  imageUrl,
  image_url,
  watched = false,
  onToggleWatchlist,
  onQuickTrade,
}: MarketCardProps) {
  const { t } = useTranslation("prediction");
  const isOpen = isOpenMarketStatus(status);
  // A closed market has nothing to trade in place; its page explains why.
  const quickTrade = isOpen ? onQuickTrade : undefined;
  const yesPercentage = clampPercentage(yesPricePoints);
  const noPercentage = clampPercentage(noPricePoints);
  const photo = [imagePath, imageUrl, image_url].find(
    (value) => value && value.trim().length > 0,
  );
  const closingLabel = isOpen
    ? `${t("CLOSES", "Closes")} ${formatCloseAt(closeAt)}`
    : marketStatusLabel(status, t);

  return (
    <article
      data-testid="market-card"
      className="group relative flex h-full flex-col rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-4 text-[var(--t1)] shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-150 hover:border-[var(--border-2)] hover:shadow-[var(--shadow-card-hover)] focus-within:border-[var(--t3)]"
    >
      <Link
        href={`/market/${ticker}`}
        className="flex items-start gap-3 text-inherit no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]"
        aria-label={title}
      >
        <MarketThumb categorySlug={categorySlug} imageUrl={photo} size={40} />
        <h3 className="m-0 line-clamp-3 min-h-[38px] min-w-0 flex-1 text-[14.5px] font-semibold leading-[1.32] tracking-[-0.011em] text-[var(--t1)] group-hover:underline group-hover:decoration-[var(--border-2)] group-hover:underline-offset-2">
          {title}
        </h3>
        <span className="flex shrink-0 flex-col items-end pl-1">
          <span className="text-[20px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--t1)]">
            {yesPercentage}%
          </span>
          <span className="mt-1 text-[11px] font-medium text-[var(--t3)]">
            {t("CHANCE", "chance")}
          </span>
        </span>
      </Link>

      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        {(["yes", "no"] as const).map((side) => {
          const percentage = side === "yes" ? yesPercentage : noPercentage;
          const price = side === "yes" ? yesPricePoints : noPricePoints;
          const className = `${SIDE_BUTTON_CLASS} ${SIDE_TONE[side]}`;
          const ariaLabel =
            side === "yes"
              ? `${percentage}% ${t("BUY_YES", "Yes")}`
              : `${percentage}% ${t("BUY_NO", "No")}`;
          const content = (
            <>
              <span>{side === "yes" ? t("YES") : t("NO")}</span>
              <span className="text-[13px] font-medium tabular-nums opacity-80">
                {t("PTS_COUNT", { count: price, defaultValue: `${price} pts` })}
              </span>
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

      <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-[var(--t3)]">
        <span className="truncate tabular-nums">
          {formatCompactPoints(volumePoints)} {t("VOL_SHORT", "vol")}
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-right">
            {categoryLabel ? `${categoryLabel} · ` : ""}
            {closingLabel}
          </span>
          {/* Save to watchlist — shown wherever the host wires watchlist
              state (the catalog view). */}
          {onToggleWatchlist && (
            <button
              type="button"
              aria-pressed={watched}
              aria-label={
                watched
                  ? t("REMOVE_FROM_WATCHLIST", "Remove from watchlist")
                  : t("ADD_TO_WATCHLIST", "Add to watchlist")
              }
              onClick={() => onToggleWatchlist(marketId)}
              className={`-my-1.5 -mr-1.5 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-[var(--r-rh-md)] border-0 bg-transparent transition-colors duration-150 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] max-[640px]:h-11 max-[640px]:w-11 ${
                watched ? "text-[var(--t1)]" : "text-[var(--t3)] hover:text-[var(--t1)]"
              }`}
            >
              <BookmarkSimple
                size={16}
                weight={watched ? "fill" : "regular"}
                aria-hidden="true"
              />
            </button>
          )}
        </span>
      </div>
    </article>
  );
}
