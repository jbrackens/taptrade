"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { formatCompactPoints } from "../../lib/points";
import { isOpenMarketStatus, marketStatusLabel } from "./market-display";
import { calculateMarketSentiment } from "./marketSentiment";

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
   * When set, YES/NO open an in-place trade panel instead of navigating to
   * the market page with `?side=` preselected.
   */
  onQuickTrade?: (side: "yes" | "no") => void;
}

const SIDE_BUTTON_CLASS =
  "flex min-h-[34px] cursor-pointer items-center justify-center rounded-[7px] border-0 px-3 py-2 text-center font-sans text-[12px] font-semibold text-white no-underline transition-[filter,transform] duration-150 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] active:translate-y-px max-[640px]:min-h-11";

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

/**
 * The Figma-approved discovery treatment turns the derived sentiment into a
 * compact, directional label. The underlying side prices remain visible in
 * the two action buttons so the card stays honest about the live market data.
 */
function leanLabel(
  sentiment: ReturnType<typeof calculateMarketSentiment>,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (sentiment.sentimentState === "neutral") {
    return t("MARKET_CARD_EVENLY_SPLIT", "Evenly split");
  }

  const isStrong = (sentiment.percentage ?? 0) >= 75;
  if (sentiment.sentimentState === "yes") {
    return t(
      isStrong ? "MARKET_CARD_STRONG_YES_LEAN" : "MARKET_CARD_YES_LEAN",
      isStrong ? "Strong Yes lean" : "Yes lean",
    );
  }

  return t(
    isStrong ? "MARKET_CARD_STRONG_NO_LEAN" : "MARKET_CARD_NO_LEAN",
    isStrong ? "Strong No lean" : "No lean",
  );
}

export function MarketCard({
  ticker,
  title,
  yesPricePoints,
  noPricePoints,
  volumePoints,
  closeAt,
  status,
  categoryLabel,
  rank = 1,
  onQuickTrade,
}: MarketCardProps) {
  const { t } = useTranslation("prediction");
  const isOpen = isOpenMarketStatus(status);
  // A closed market has nothing to trade in place; its page explains why.
  const quickTrade = isOpen ? onQuickTrade : undefined;
  const yesPercentage = clampPercentage(yesPricePoints);
  const noPercentage = clampPercentage(noPricePoints);
  const sentiment = calculateMarketSentiment(yesPercentage);
  const rankLabel = String(Math.max(1, Math.round(rank))).padStart(2, "0");
  const directionTextClass =
    sentiment.sentimentState === "yes"
      ? "text-[var(--yes-text)]"
      : sentiment.sentimentState === "no"
        ? "text-[var(--no-text)]"
        : "text-[var(--t3)]";
  const closingLabel = isOpen
    ? `${t("CLOSES", "Closes")} ${formatCloseAt(closeAt)}`
    : `${t("STATUS", "Status")} ${marketStatusLabel(status, t)}`;

  return (
    <article
      data-testid="market-card"
      className="relative flex h-full min-h-[222px] flex-col rounded-[12px] border border-[var(--border-1)] bg-[var(--surface-1)] p-4 font-sans text-[var(--t1)] shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-[140ms] hover:border-[var(--border-2)] hover:shadow-[var(--shadow-card-hover)] focus-within:border-[var(--accent)] max-[640px]:min-h-[232px]"
    >
      <Link
        href={`/market/${ticker}`}
        className="flex min-h-0 flex-1 flex-col rounded-[6px] text-inherit no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]"
        aria-label={title}
      >
        <div className="flex h-6 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-6 min-w-6 place-items-center rounded-[7px] bg-[var(--brand-lavender)] px-1 text-[11px] font-bold leading-none tabular-nums text-[var(--accent-text)]">
              {rankLabel}
            </span>
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--accent-text)]">
              {categoryLabel ?? t("MARKET", "Market")}
            </span>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--brand-dark)]">
            <span
              className="h-1.5 w-1.5 rounded-full bg-[var(--live)]"
              aria-hidden="true"
            />
            {t("TRENDING", "Trending")}
          </span>
        </div>

        <h3
          className="m-0 mt-2 min-h-[42px] overflow-hidden text-[16px] font-semibold leading-[1.3] tracking-[-0.01em] text-[var(--t1)]"
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
          }}
        >
          {title}
        </h3>

        <div className="mt-auto pt-3">
          <div className="flex items-center justify-between gap-3 text-[9px] font-semibold uppercase tracking-[0.11em]">
            <span className="text-[var(--t3)]">
              {t("PARTICIPANT_VIEW", "Participant view")}
            </span>
            <span className={`truncate ${directionTextClass}`}>
              {leanLabel(sentiment, t)}
            </span>
          </div>
          <span className="mt-1.5 block h-2 overflow-hidden rounded-[var(--r-pill)] bg-[var(--no)]">
            <span
              className="block h-full rounded-l-[var(--r-pill)] bg-[var(--yes)]"
              style={{ width: `${yesPercentage}%` }}
            />
          </span>
          <p className="m-0 mt-2 truncate text-[10px] font-medium uppercase tracking-[0.04em] text-[var(--t3)]">
            {closingLabel} · {formatCompactPoints(volumePoints)} {t("ACTIVITY", "activity")}
          </p>
        </div>
      </Link>

      <div className="mt-2 grid grid-cols-2 gap-3">
        {(["yes", "no"] as const).map((side) => {
          const percentage = side === "yes" ? yesPercentage : noPercentage;
          const className = `${SIDE_BUTTON_CLASS} ${side === "yes" ? "bg-[var(--yes)]" : "bg-[var(--no)]"}`;
          const ariaLabel =
            side === "yes"
              ? `${percentage}% ${t("BUY_YES", "Yes")}`
              : `${percentage}% ${t("BUY_NO", "No")}`;
          const text = `${percentage}% ${side === "yes" ? t("YES") : t("NO")}`;
          return quickTrade ? (
            <button
              key={side}
              type="button"
              onClick={() => quickTrade(side)}
              className={className}
              aria-label={ariaLabel}
              aria-haspopup="dialog"
            >
              {text}
            </button>
          ) : (
            <Link
              key={side}
              href={`/market/${ticker}?side=${side}`}
              className={className}
              aria-label={ariaLabel}
            >
              {text}
            </Link>
          );
        })}
      </div>
    </article>
  );
}
