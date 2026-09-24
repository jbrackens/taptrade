"use client";

/**
 * FeaturedMarket — the top of /predict: one market with its real price
 * chart and both outcomes, beside a ranked "Trending" list.
 *
 * Honest by construction: the featured market is picked by a stated rule
 * (the most-traded contested market on the first page — see
 * pickFeatured), and the list is the activity-sorted order the API
 * returned. Nothing claims "live" without a live signal.
 */

import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { formatCompactPoints } from "../../lib/points";
import MarketChart from "./MarketChart";
import { MarketThumb } from "./MarketThumb";
import { categoryLabel as labelForCategory } from "./market-content";

type Side = "yes" | "no";

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatCloseAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The featured market: the highest-volume market whose price is still
 * contested (10–90), so the hero never leads with a settled-looking 1%.
 * Falls back to the first market.
 */
export function pickFeatured(markets: PredictionMarket[]): PredictionMarket | undefined {
  const contested = markets.filter(
    (market) => market.yesPricePoints >= 10 && market.yesPricePoints <= 90,
  );
  const pool = contested.length > 0 ? contested : markets;
  return pool.reduce<PredictionMarket | undefined>(
    (best, market) =>
      !best || market.volumePoints > best.volumePoints ? market : best,
    undefined,
  );
}

const OUTCOME_BUTTON_CLASS =
  "inline-flex h-10 min-w-[128px] cursor-pointer items-center justify-center gap-1.5 rounded-[var(--r-rh-md)] border-0 px-4 text-[14px] font-semibold text-[var(--on-ink)] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] max-[640px]:min-w-0 max-[640px]:flex-1";

export function FeaturedMarket({
  featured,
  trending,
  onQuickTrade,
}: {
  featured: PredictionMarket;
  trending: PredictionMarket[];
  onQuickTrade: (market: PredictionMarket, side: Side) => void;
}) {
  const { t } = useTranslation("prediction");
  const { t: contentT } = useTranslation("market-content");
  const category = featured.categorySlug
    ? labelForCategory(contentT, featured.categorySlug)
    : featured.categoryName || t("MARKET", "Market");
  const context =
    featured.eventTitle && featured.eventTitle !== featured.title
      ? `${category} · ${featured.eventTitle}`
      : category;
  const yes = clampPercentage(featured.yesPricePoints);
  const no = clampPercentage(featured.noPricePoints);
  const photo = [featured.imagePath, featured.imageUrl, featured.image_url].find(
    (value) => value && value.trim().length > 0,
  );

  return (
    <section
      aria-labelledby="featured-market-question"
      className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 max-[1100px]:grid-cols-1"
    >
      <article className="flex min-w-0 flex-col rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-6 shadow-[var(--shadow-card)] max-[640px]:p-4">
        <div className="flex items-start gap-3.5">
          <MarketThumb categorySlug={featured.categorySlug} imageUrl={photo} size={48} />
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[13px] font-medium text-[var(--t3)]">
              {context}
            </p>
            <h2
              id="featured-market-question"
              className="m-0 mt-0.5 text-[22px] font-semibold leading-[1.25] tracking-[-0.02em] text-[var(--t1)] max-[640px]:text-[19px]"
            >
              <Link
                href={`/market/${featured.ticker}`}
                className="text-inherit no-underline hover:underline hover:decoration-[var(--border-2)] hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                {featured.title}
              </Link>
            </h2>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-[minmax(220px,0.8fr)_minmax(0,1.4fr)] items-start gap-8 max-[860px]:grid-cols-1 max-[860px]:gap-5">
          <div className="flex flex-col">
            <div className="flex items-baseline gap-2">
              <span className="text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--t1)]">
                {yes}%
              </span>
              <span className="text-[14px] font-medium text-[var(--t3)]">
                {t("CHANCE", "chance")}
              </span>
            </div>
            <dl className="m-0 mt-5 grid gap-2.5">
              {(["yes", "no"] as const).map((side) => (
                <div key={side} className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2 text-[14px] font-medium text-[var(--t2)]">
                    <span
                      className={`h-2 w-2 rounded-full ${side === "yes" ? "bg-[var(--yes)]" : "bg-[var(--no)]"}`}
                      aria-hidden="true"
                    />
                    {side === "yes" ? t("YES") : t("NO")}
                  </dt>
                  <dd className="m-0 text-[14px] font-semibold tabular-nums text-[var(--t1)]">
                    {side === "yes" ? yes : no}%
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 flex flex-wrap gap-2">
              {(["yes", "no"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={`${side === "yes" ? yes : no}% ${side === "yes" ? t("BUY_YES", "Yes") : t("BUY_NO", "No")}`}
                  onClick={() => onQuickTrade(featured, side)}
                  className={`${OUTCOME_BUTTON_CLASS} ${side === "yes" ? "bg-[var(--yes)]" : "bg-[var(--no)]"}`}
                >
                  {side === "yes" ? t("BUY_YES", "Buy Yes") : t("BUY_NO", "Buy No")}
                  <span className="font-medium tabular-nums opacity-85">
                    {t("PTS_COUNT", {
                      count: side === "yes" ? featured.yesPricePoints : featured.noPricePoints,
                    })}
                  </span>
                </button>
              ))}
            </div>
            <p className="m-0 mt-4 text-[12.5px] text-[var(--t3)] tabular-nums">
              {formatCompactPoints(featured.volumePoints)} {t("VOL_SHORT", "vol")} ·{" "}
              {t("CLOSES", "Closes")} {formatCloseAt(featured.closeAt)}
            </p>
          </div>

          <div className="min-w-0">
            <MarketChart
              ticker={featured.ticker}
              yesPricePoints={featured.yesPricePoints}
              noPricePoints={featured.noPricePoints}
              height={200}
            />
          </div>
        </div>
      </article>

      <aside
        aria-labelledby="featured-trending-heading"
        className="flex min-w-0 flex-col rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-card)] max-[640px]:p-4"
      >
        <h2
          id="featured-trending-heading"
          className="m-0 text-[15px] font-semibold tracking-[-0.01em] text-[var(--t1)]"
        >
          {t("SORT_ACTIVITY", "Trending")}
        </h2>
        <ol className="m-0 mt-2 list-none p-0">
          {trending.map((market, index) => {
            const pct = clampPercentage(market.yesPricePoints);
            return (
              <li key={market.id} className="border-b border-[var(--border-1)] last:border-b-0">
                <Link
                  href={`/market/${market.ticker}`}
                  className="group flex items-center gap-3 py-3 text-inherit no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
                >
                  <span className="w-4 shrink-0 text-[13px] font-semibold tabular-nums text-[var(--t3)]">
                    {index + 1}
                  </span>
                  <MarketThumb categorySlug={market.categorySlug} size={32} />
                  <span className="line-clamp-2 min-w-0 flex-1 text-[13.5px] font-medium leading-[1.35] text-[var(--t1)] group-hover:underline group-hover:decoration-[var(--border-2)] group-hover:underline-offset-2">
                    {market.title}
                  </span>
                  <span className="shrink-0 text-[14px] font-semibold tabular-nums text-[var(--t1)]">
                    {pct}%
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </aside>
    </section>
  );
}
