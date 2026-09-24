"use client";

/**
 * MarketFeed — the single-column markets feed (Predict Light Social 3a),
 * unblocked by §3-09 commentCount. The first market renders as the hero
 * card; the rest are compact rows. The meta row is the activity signal —
 * comment count and volume — because a card that can't show a market is
 * being argued about is just a list row.
 *
 * Honesty rules carried over verbatim:
 *  - NO sparkline: the price-history endpoint doesn't exist for cards,
 *    so nothing is drawn (README Interactions — "draw nothing").
 *  - The hero's delta comes from ONE real /prices series fetch; flat or
 *    missing history renders no delta at all.
 *  - Rows show the live consensus lean (current price), never a
 *    fabricated change figure.
 *  - commentCount is only trusted when the API sent it — absent means
 *    "unknown", and the chip is simply omitted.
 *
 * Deviations from the reference, both deliberate:
 *  - The "Trending on X" chatter chip is omitted — no data source
 *    exists for it.
 *  - Rows keep a watchlist star (the reference has none): the list star
 *    is the app's only save affordance, and the Saved filter would
 *    otherwise strand markets you can't unsave.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatCircleIcon as ChatCircle } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { ShareNetworkIcon as ShareNetwork } from "@phosphor-icons/react/dist/csr/ShareNetwork";
import { StarIcon as Star } from "@phosphor-icons/react/dist/csr/Star";
import { TrendUpIcon as TrendUp } from "@phosphor-icons/react/dist/csr/TrendUp";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { useToast } from "../ToastProvider";
import { logger } from "../../lib/logger";
import { formatCompactPoints } from "../../lib/points";
import { categoryLabel, localizedMarket } from "./market-content";
import { calculateMarketSentiment } from "./marketSentiment";
import { getMarketImageProps } from "./utils/marketImage";
import {
  movementFromHistory,
  type MarketMovement,
} from "./market-movement";

const api = createPredictionClient();

interface MarketFeedProps {
  markets: PredictionMarket[];
  watchedMarketIds?: Set<string>;
  onToggleWatchlist?: (marketId: string) => void;
}

// The feed is a single column by design; on wide viewports it holds a
// readable measure instead of stretching cards across the workspace.
const FEED_CLASS = "mx-auto flex w-full max-w-[680px] flex-col gap-3";

const CARD_CLASS =
  "relative rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] transition-[border-color] duration-150 hover:border-[var(--border-2)] focus-within:border-[var(--t3)]";
const EYEBROW_CLASS =
  "font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--t3)]";
const META_DOT_CLASS =
  "h-[3px] w-[3px] flex-none rounded-full bg-[var(--border-2)]";
const STAR_BUTTON_CLASS =
  "grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent transition-colors duration-150";

function starToneClass(watched: boolean): string {
  return watched
    ? "text-[var(--accent-text)]"
    : "text-[var(--t4)] hover:text-[var(--t2)]";
}

function sentimentToneClass(state: "neutral" | "yes" | "no"): string {
  return state === "neutral"
    ? "text-[var(--t3)]"
    : state === "yes"
      ? "text-[var(--yes-text)]"
      : "text-[var(--no-text)]";
}

function sentimentBarClass(state: "neutral" | "yes" | "no"): string {
  return state === "neutral"
    ? "bg-[var(--border-2)]"
    : state === "yes"
      ? "bg-[var(--yes-bar)]"
      : "bg-[var(--no-bar)]";
}

/** Native share on touch devices, clipboard copy elsewhere. */
async function shareMarket(
  market: PredictionMarket,
  onDone: (ok: boolean) => void,
) {
  const url = `${window.location.origin}/market/${market.ticker}`;
  const prefersNativeShare =
    typeof navigator !== "undefined" &&
    !!navigator.share &&
    (navigator.maxTouchPoints > 0 ||
      window.matchMedia("(pointer: coarse)").matches);
  try {
    if (prefersNativeShare) {
      await navigator.share({ title: market.title, url });
    } else {
      await navigator.clipboard.writeText(url);
    }
    onDone(true);
  } catch (err: unknown) {
    logger.warn("MarketFeed", "share failed", err);
    onDone(false);
  }
}

function FeedHeroCard({
  market,
  displayCategory,
  watched,
  onToggleWatchlist,
}: {
  market: PredictionMarket;
  displayCategory?: string;
  watched: boolean;
  onToggleWatchlist?: (marketId: string) => void;
}) {
  const { t } = useTranslation("prediction");
  const toast = useToast();
  const [movement, setMovement] = useState<MarketMovement | null>(null);

  // One real history fetch for the hero only; flat/missing draws nothing.
  useEffect(() => {
    let cancelled = false;
    api
      .getMarketPriceHistory(market.id, "1d")
      .then((history) => {
        if (!cancelled) setMovement(movementFromHistory(history));
      })
      .catch(() => {
        if (!cancelled) setMovement(null);
      });
    return () => {
      cancelled = true;
    };
  }, [market.id]);

  const showDelta = movement !== null && movement.direction !== "flat";

  return (
    <article className={`${CARD_CLASS} p-[18px]`}>
      <div className="flex items-center gap-2 pr-10">
        {displayCategory && (
          <span className={EYEBROW_CLASS}>{displayCategory}</span>
        )}
      </div>
      {onToggleWatchlist && (
        <button
          type="button"
          className={`absolute right-1.5 top-1.5 z-10 ${STAR_BUTTON_CLASS} ${starToneClass(watched)}`}
          aria-pressed={watched}
          aria-label={
            watched
              ? t("REMOVE_FROM_WATCHLIST", "Remove from watchlist")
              : t("ADD_TO_WATCHLIST", "Add to watchlist")
          }
          onClick={() => onToggleWatchlist(market.id)}
        >
          <Star size={18} weight={watched ? "fill" : "regular"} aria-hidden />
        </button>
      )}

      <Link
        href={`/market/${market.ticker}`}
        className="block text-inherit no-underline"
        aria-label={market.title}
      >
        <h3 className="m-0 mt-2.5 text-[21px] font-medium leading-[1.18] tracking-[-0.01em] text-[var(--t1)] [text-wrap:pretty]">
          {market.title}
        </h3>

        <div className="mt-4">
          <div className="text-[11px] font-medium tracking-[0.01em] text-[var(--t3)]">
            {t("LATEST_PROBABILITY", "Latest probability")}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="mono mono-wide text-[40px] font-semibold leading-none tracking-[-0.05em] text-[var(--t1)] tabular-nums">
              {market.yesPricePoints}%
            </span>
            {showDelta && (
              <span
                className={`font-mono text-[12px] font-medium tabular-nums ${
                  movement.direction === "up"
                    ? "text-[var(--yes-text)]"
                    : "text-[var(--no-text)]"
                }`}
              >
                {movement.direction === "up" ? "↑" : "↓"}{" "}
                {Math.abs(movement.deltaPoints)} pts
              </span>
            )}
          </div>
        </div>
      </Link>

      <div className="mt-3.5 grid grid-cols-2 gap-2.5">
        <Link
          href={`/market/${market.ticker}?side=yes`}
          className="flex min-h-12 items-center justify-between gap-2 rounded-[var(--r-rh-md)] border-0 bg-[var(--yes-soft)] px-3.5 text-[var(--yes-text)] no-underline transition-colors duration-150 hover:bg-[var(--yes)] hover:text-[var(--on-ink)] [&:hover_*]:!text-[var(--on-ink)]"
          aria-label={t("BUY_YES")}
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--yes-text)]">
            {t("YES")}
          </span>
          <span className="font-mono text-[16px] font-medium text-[var(--yes-text)] tabular-nums">
            {market.yesPricePoints} pts
          </span>
        </Link>
        <Link
          href={`/market/${market.ticker}?side=no`}
          className="flex min-h-12 items-center justify-between gap-2 rounded-[var(--r-rh-md)] border-0 bg-[var(--no-soft)] px-3.5 text-[var(--no-text)] no-underline transition-colors duration-150 hover:bg-[var(--no)] hover:text-[var(--on-ink)] [&:hover_*]:!text-[var(--on-ink)]"
          aria-label={t("BUY_NO")}
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--no-text)]">
            {t("NO")}
          </span>
          <span className="font-mono text-[16px] font-medium text-[var(--no-text)] tabular-nums">
            {market.noPricePoints} pts
          </span>
        </Link>
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-[var(--border-1)] pt-3">
        <span className="flex items-center gap-3.5 text-[12px] text-[var(--t3)]">
          {typeof market.commentCount === "number" && (
            <span className="inline-flex items-center gap-1.5">
              <ChatCircle size={15} aria-hidden />
              {/* Screen readers get the full phrase; sighted users get
               * the reference's bare mono figure beside the glyph. */}
              <span className="sr-only">
                {t("DISCUSSION_COUNT", { count: market.commentCount })}
              </span>
              <span
                className="font-mono font-medium tabular-nums"
                aria-hidden="true"
              >
                {market.commentCount.toLocaleString()}
              </span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <TrendUp size={15} aria-hidden />
            <span className="sr-only">{t("VOLUME")}</span>
            <span className="font-mono font-medium tabular-nums">
              {formatCompactPoints(market.volumePoints)}
            </span>
          </span>
        </span>
        <button
          type="button"
          className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--border-1)] bg-[var(--surface-1)] px-3.5 text-[13px] font-medium text-[var(--t2)] transition-colors duration-150 hover:border-[var(--border-2)]"
          onClick={() =>
            shareMarket(market, (ok) =>
              ok
                ? toast.success(t("SHARE_COPIED", "Market link copied."))
                : toast.error(t("SHARE_FAILED", "Share could not be opened.")),
            )
          }
        >
          <ShareNetwork size={15} aria-hidden />
          {t("SHARE_MARKET", "Share")}
        </button>
      </div>
    </article>
  );
}

function FeedRow({
  market,
  displayCategory,
  watched,
  onToggleWatchlist,
}: {
  market: PredictionMarket;
  displayCategory?: string;
  watched: boolean;
  onToggleWatchlist?: (marketId: string) => void;
}) {
  const { t } = useTranslation("prediction");
  const image = getMarketImageProps({
    ticker: market.ticker,
    imagePath: market.imagePath,
    imageUrl: market.imageUrl,
    image_url: market.image_url,
    categoryLabel: displayCategory,
  });
  // A photo that fails to load falls back to the monogram, never a
  // broken-image glyph.
  const [imageFailed, setImageFailed] = useState(false);
  const fallback =
    image.kind === "monogram"
      ? image
      : getMarketImageProps({
          ticker: market.ticker,
          categoryLabel: displayCategory,
        });
  const monogram = fallback.kind === "monogram" ? fallback.monogram : "";
  const sentiment = calculateMarketSentiment(market.yesPricePoints);
  const leadPct =
    sentiment.sentimentState === "no"
      ? market.noPricePoints
      : market.yesPricePoints;

  return (
    <article className={`${CARD_CLASS} p-4`}>
      <Link
        href={`/market/${market.ticker}`}
        className="flex items-start gap-3 text-inherit no-underline"
        aria-label={market.title}
      >
        {image.kind === "image" && !imageFailed ? (
          <img
            className="h-10 w-10 flex-none rounded-[var(--r-rh-md)] border border-[var(--border-1)] object-cover"
            src={image.src}
            alt=""
            aria-hidden="true"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span
            className="grid h-10 w-10 flex-none place-items-center rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] font-mono text-[12px] font-medium text-[var(--t3)]"
            aria-hidden="true"
          >
            {monogram}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            {displayCategory && (
              <span className={`${EYEBROW_CLASS} tracking-[0.1em]`}>
                {displayCategory}
              </span>
            )}
            {typeof market.commentCount === "number" &&
              market.commentCount > 0 && (
                <>
                  <span className={META_DOT_CLASS} aria-hidden="true" />
                  <span className="text-[11px] text-[var(--t3)]">
                    {t("DISCUSSION_COUNT", { count: market.commentCount })}
                  </span>
                </>
              )}
          </span>
          <span className="mt-1 block text-[15px] font-medium leading-[1.35] tracking-[-0.005em] text-[var(--t1)] [text-wrap:pretty]">
            {market.title}
          </span>
        </span>
        <span className="flex-none text-right">
          <span className="block font-mono text-[20px] font-medium leading-[1.1] text-[var(--t1)] tabular-nums">
            {market.yesPricePoints} pts
          </span>
        </span>
      </Link>

      <div className="mt-3 flex items-center gap-2">
        <span className="block h-1.5 flex-1 overflow-hidden rounded-[var(--r-pill)] bg-[var(--surface-2)]">
          <span
            className={`block h-full rounded-[var(--r-pill)] ${sentimentBarClass(sentiment.sentimentState)}`}
            style={{ width: `${Math.max(0, Math.min(100, leadPct))}%` }}
          />
        </span>
        <span
          className={`flex-none whitespace-nowrap text-[11px] font-medium ${sentimentToneClass(sentiment.sentimentState)}`}
        >
          {t(sentiment.displayStringKey, {
            percentage: sentiment.percentage,
          })}
        </span>
        {onToggleWatchlist && (
          <button
            type="button"
            className={`-my-2 -mr-2 ${STAR_BUTTON_CLASS} ${starToneClass(watched)}`}
            aria-pressed={watched}
            aria-label={
              watched
                ? t("REMOVE_FROM_WATCHLIST", "Remove from watchlist")
                : t("ADD_TO_WATCHLIST", "Add to watchlist")
            }
            onClick={() => onToggleWatchlist(market.id)}
          >
            <Star
              size={16}
              weight={watched ? "fill" : "regular"}
              aria-hidden
            />
          </button>
        )}
      </div>
    </article>
  );
}

export function MarketFeed({
  markets,
  watchedMarketIds,
  onToggleWatchlist,
}: MarketFeedProps) {
  const { t: tContent } = useTranslation("market-content");
  if (!markets || markets.length === 0) return null;
  const [head, ...rest] = markets;
  const display = (market: PredictionMarket) => {
    const m = localizedMarket(tContent, market);
    return {
      market: m,
      category: m.categorySlug
        ? categoryLabel(tContent, m.categorySlug)
        : m.categoryName || undefined,
    };
  };
  const hero = display(head);
  return (
    <div className={FEED_CLASS}>
      <div className="card-in">
        <FeedHeroCard
          market={hero.market}
          displayCategory={hero.category}
          watched={watchedMarketIds?.has(head.id) ?? false}
          onToggleWatchlist={onToggleWatchlist}
        />
      </div>
      {rest.map((market, index) => {
        const row = display(market);
        return (
          <div
            key={market.id}
            className="card-in"
            style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}
          >
            <FeedRow
              market={row.market}
              displayCategory={row.category}
              watched={watchedMarketIds?.has(market.id) ?? false}
              onToggleWatchlist={onToggleWatchlist}
            />
          </div>
        );
      })}
    </div>
  );
}

// Same shimmer recipe as AllMarketsSection's grid skeletons (globals
// @keyframes shimmer) so both loading states read as one system.
const SHIMMER_CLASS =
  "block animate-[shimmer_1.5s_infinite] rounded-full bg-[linear-gradient(90deg,var(--surface-2)_25%,var(--border-1)_50%,var(--surface-2)_75%)] bg-[length:200%_100%]";

/** 18a: skeletons match the REAL feed geometry so the load doesn't reflow. */
export function FeedHeroSkeleton() {
  return (
    <div className={`${CARD_CLASS} p-[18px]`} aria-hidden="true">
      <span className={`h-2.5 w-16 ${SHIMMER_CLASS}`} />
      <span className={`mt-3 block h-5 w-full ${SHIMMER_CLASS}`} />
      <span className={`mt-2 block h-5 w-2/3 ${SHIMMER_CLASS}`} />
      <span className={`mt-4 block h-10 w-32 ${SHIMMER_CLASS}`} />
      <div className="mt-3.5 grid grid-cols-2 gap-2.5">
        <span className={`h-12 !rounded-[var(--r-rh-md)] ${SHIMMER_CLASS}`} />
        <span className={`h-12 !rounded-[var(--r-rh-md)] ${SHIMMER_CLASS}`} />
      </div>
      <span className={`mt-3.5 block h-2.5 w-1/2 ${SHIMMER_CLASS}`} />
    </div>
  );
}

export function FeedRowSkeleton() {
  return (
    <div className={`${CARD_CLASS} p-4`} aria-hidden="true">
      <div className="flex items-start gap-3">
        <span className={`h-10 w-10 !rounded-[var(--r-rh-md)] ${SHIMMER_CLASS}`} />
        <span className="min-w-0 flex-1">
          <span className={`h-2.5 w-24 ${SHIMMER_CLASS}`} />
          <span className={`mt-2 block h-3.5 w-full ${SHIMMER_CLASS}`} />
          <span className={`mt-1.5 block h-3.5 w-2/3 ${SHIMMER_CLASS}`} />
        </span>
        <span className={`h-6 w-12 ${SHIMMER_CLASS}`} />
      </div>
      <span className={`mt-3 block h-1.5 w-full !rounded-[var(--r-pill)] ${SHIMMER_CLASS}`} />
    </div>
  );
}
