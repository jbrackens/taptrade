"use client";

/**
 * MarketCard — one binary market in the discovery grid.
 *
 * Anatomy (2026-09-29 redesign, the Kalshi / Polymarket card): the market's
 * image tile, a sentence-case eyebrow naming its event (or its category when
 * it has no event of its own), the question, and the chance in the top-right
 * corner; then Yes / No priced in Clout ("Yes 57 Clout"), and a hairline
 * caption: volume and time left (pink in the last 24 hours), or what the
 * player holds. Everything is a single typeface; numbers use tabular
 * figures.
 */

import Link from "next/link";
import { BookmarkSimpleIcon as BookmarkSimple } from "@phosphor-icons/react/dist/csr/BookmarkSimple";
import { useTranslation } from "react-i18next";
import { formatCompactPoints } from "../../lib/points";
import type { HeldPosition } from "../../lib/query/position-hooks";
import { isOpenMarketStatus, marketStatusLabel, timeLeft } from "./market-display";
import { repeatsTitle } from "./event-groups";
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
  /** The parent event's title, when it is a real event rather than a catch-all. */
  eventTitle?: string;
  eventSynthetic?: boolean;
  imagePath?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
  watched?: boolean;
  /** The signed-in player's holding in this market, if any. */
  held?: HeldPosition;
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

const HELD_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

const SIDE_BUTTON_CLASS =
  "flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--r-rh-md)] border-0 px-3 text-[14px] font-semibold no-underline transition-[background-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] active:scale-[0.98] max-[640px]:h-11";
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
  eventTitle,
  eventSynthetic = false,
  imagePath,
  imageUrl,
  image_url,
  watched = false,
  held,
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
  const left = isOpen ? timeLeft(closeAt) : null;
  const heldSide = held
    ? held.side === "yes"
      ? t("YES", "Yes")
      : t("NO", "No")
    : "";
  const leftTone = left?.urgent ? "text-[var(--live-text)]" : "";
  const heldText = held
    ? t("YOU_HOLD_COUNT", {
        quantity: HELD_FORMAT.format(held.quantity),
        side: heldSide,
        defaultValue: `You hold ${HELD_FORMAT.format(held.quantity)} ${heldSide}`,
      })
    : "";
  const heldTone = held
    ? held.side === "yes"
      ? "font-semibold text-[var(--yes-text)]"
      : "font-semibold text-[var(--no-text)]"
    : "";
  // The eyebrow names the event this market belongs to ("Chiefs vs.
  // Dolphins" over "Spread: Chiefs (-10.5)"); a market with no event of its
  // own shows its category there instead.
  const eventEyebrow = eventTitle && !eventSynthetic ? eventTitle.trim() : "";
  // A market that is its whole event would only repeat its own title up
  // there ("New York Mets vs. Washington Nationals" twice); it shows its
  // category instead.
  const eyebrow = eventEyebrow && !repeatsTitle(eventEyebrow, title) ? eventEyebrow : categoryLabel ?? "";
  // The caption's right side: what the player holds, else the status of a
  // closed market (open markets show time left beside the volume).
  const footerMeta = held ? heldText : !left ? closingLabel : "";

  return (
    <article
      data-testid="market-card"
      className="group relative flex h-full flex-col rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-3.5 text-[var(--t1)] shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-150 hover:border-[var(--border-2)] hover:shadow-[var(--shadow-card-hover)] focus-within:border-[var(--t3)]"
    >
      <Link
        href={`/market/${ticker}`}
        className="flex items-start gap-2.5 text-inherit no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]"
        aria-label={`${title} · ${yesPercentage}% ${t("CHANCE", "chance")}`}
      >
        <MarketThumb categorySlug={categorySlug} imageUrl={photo} size={40} />
        <span className="flex min-w-0 flex-1 flex-col">
          {eyebrow && (
            <span className="mb-0.5 truncate text-[12px] font-medium leading-[1.3] text-[var(--t3)]">
              {eyebrow}
            </span>
          )}
          <h3 className="m-0 line-clamp-3 min-w-0 text-[15px] font-semibold leading-[1.3] tracking-[-0.011em] text-[var(--t1)] group-hover:underline group-hover:decoration-[var(--border-2)] group-hover:underline-offset-2">
            {title}
          </h3>
        </span>
        <span className="flex shrink-0 flex-col items-end pl-1">
          <span className="text-[17px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--t1)]">
            {yesPercentage}%
          </span>
          <span className="mt-1 whitespace-nowrap text-[11px] font-medium text-[var(--t3)]">
            {t("CHANCE", "chance")}
          </span>
        </span>
      </Link>

      <div className="mt-auto grid grid-cols-2 gap-2 pt-3.5">
        {(["yes", "no"] as const).map((side) => {
          const price = side === "yes" ? yesPercentage : noPercentage;
          const className = `${SIDE_BUTTON_CLASS} ${SIDE_TONE[side]}`;
          const ariaLabel = `${side === "yes" ? t("BUY_YES", "Buy Yes") : t("BUY_NO", "Buy No")} · ${t("PTS_COUNT", { count: price })}`;
          const content = (
            <>
              <span>{side === "yes" ? t("YES") : t("NO")}</span>
              <span className="tabular-nums">
                {t("PTS_COUNT", { count: price })}
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

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border-1)] pt-2.5 text-[12px] text-[var(--t3)]">
        <span className="truncate tabular-nums">
          {formatCompactPoints(volumePoints)} {t("VOL_SHORT", "vol")}
          {left && !held && (
            <span className={leftTone} title={closingLabel}>
              {" · "}
              {left.value} {t("TIME_LEFT", "left")}
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1">
          {footerMeta && (
            <span className={`truncate text-right ${heldTone}`}>{footerMeta}</span>
          )}
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
              className={`-my-1.5 -mr-1.5 pointer-coarse:-my-2.5 pointer-coarse:-mr-2.5 grid h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11 shrink-0 cursor-pointer place-items-center rounded-[var(--r-rh-md)] border-0 bg-transparent transition-colors duration-150 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] max-[640px]:h-11 max-[640px]:w-11 ${
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
