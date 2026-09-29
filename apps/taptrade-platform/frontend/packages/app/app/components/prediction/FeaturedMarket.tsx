"use client";

/**
 * FeaturedMarket — the top of /predict: one market with its real price
 * chart and both outcomes, beside a ranked "Most active" list.
 *
 * 2026-09-29 redesign: phones show the chance, a sparkline, then Yes / No
 * priced in Clout; desktop keeps the Yes/No rows and "Buy Yes 41 Clout"
 * beside the full chart.
 *
 * Honest by construction: the featured market is picked by a stated rule
 * (the most-traded contested market on the first page — see
 * pickFeatured), and the list is the activity-sorted order the API
 * returned. Nothing claims "live" without a live signal.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { formatCompactPoints } from "../../lib/points";
import MarketChart from "./MarketChart";
import { MarketThumb } from "./MarketThumb";
import { categoryLabel as labelForCategory } from "./market-content";

type Side = "yes" | "no";

/** Phones get the sparkline (no axis, no range picker). */
function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isPhone;
}

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
  "inline-flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--r-rh-md)] border-0 px-3 text-[14px] font-semibold text-[var(--on-ink)] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]";

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
  const isPhone = useIsPhone();
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
      className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-[1100px]:grid-cols-1"
    >
      <article className="flex min-w-0 flex-col rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-6 shadow-[var(--shadow-card)] max-[640px]:p-4">
        <div className="flex items-start gap-3.5">
          <MarketThumb
            categorySlug={featured.categorySlug}
            imageUrl={photo}
            size={isPhone ? 48 : 56}
          />
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[13px] font-medium text-[var(--t3)] max-[640px]:text-[12px]">
              {context}
            </p>
            <h2
              id="featured-market-question"
              className="m-0 mt-0.5 text-[22px] font-semibold leading-[1.25] tracking-[-0.02em] text-[var(--t1)] max-[640px]:text-[17px]"
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

        {/* Narrow: chance, chart, buttons, caption in one column. Wide: the
            figures on the left, the chart spanning them on the right. */}
        <div className="mt-5 flex flex-col gap-4 min-[861px]:grid min-[861px]:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.4fr)] min-[861px]:items-start min-[861px]:gap-x-8 min-[861px]:gap-y-5">
          <div className="flex items-baseline gap-2 min-[861px]:col-start-1">
            <span className="text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--t1)]">
              {yes}%
            </span>
            <span className="text-[14px] font-medium text-[var(--t3)]">
              {t("CHANCE", "chance")}
            </span>
          </div>

          <div className="min-w-0 min-[861px]:col-start-2 min-[861px]:row-span-4 min-[861px]:row-start-1">
            <MarketChart
              ticker={featured.ticker}
              yesPricePoints={featured.yesPricePoints}
              noPricePoints={featured.noPricePoints}
              height={isPhone ? 72 : 200}
              showRanges={!isPhone}
              axis={!isPhone}
            />
          </div>

          <dl className="m-0 grid gap-2.5 max-[860px]:hidden min-[861px]:col-start-1">
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

          <div className="flex gap-2 min-[861px]:col-start-1">
            {(["yes", "no"] as const).map((side) => {
              const price = side === "yes" ? yes : no;
              const buyLabel =
                side === "yes" ? t("BUY_YES", "Buy Yes") : t("BUY_NO", "Buy No");
              return (
                <button
                  key={side}
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={`${buyLabel} · ${t("PTS_COUNT", { count: price })}`}
                  onClick={() => onQuickTrade(featured, side)}
                  className={`${OUTCOME_BUTTON_CLASS} ${side === "yes" ? "bg-[var(--yes)]" : "bg-[var(--no)]"}`}
                >
                  <span className="max-[640px]:hidden">{buyLabel}</span>
                  <span className="min-[641px]:hidden">
                    {side === "yes" ? t("YES") : t("NO")}
                  </span>
                  <span className="tabular-nums">
                    {t("PTS_COUNT", { count: price })}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="m-0 text-[12.5px] text-[var(--t3)] tabular-nums min-[861px]:col-start-1">
            {formatCompactPoints(featured.volumePoints)} {t("VOL_SHORT", "vol")} ·{" "}
            {t("CLOSES", "Closes")} {formatCloseAt(featured.closeAt)}
          </p>
        </div>
      </article>

      <aside
        aria-labelledby="featured-trending-heading"
        className="flex min-w-0 flex-col rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-card)] max-[640px]:p-4 max-[640px]:hidden"
      >
        <h2
          id="featured-trending-heading"
          className="m-0 text-[18px] font-semibold tracking-[-0.015em] text-[var(--t1)]"
        >
          {t("MOST_ACTIVE", "Most active")}
        </h2>
        <ol className="m-0 mt-2 list-none p-0">
          {trending.map((market, index) => {
            const pct = clampPercentage(market.yesPricePoints);
            // The market's own cover, like the featured card and the board's
            // cards; the category tile only when it has none.
            const rowPhoto = [market.imagePath, market.imageUrl, market.image_url].find(
              (value) => value && value.trim().length > 0,
            );
            return (
              <li key={market.id} className="border-b border-[var(--border-1)] last:border-b-0">
                <Link
                  href={`/market/${market.ticker}`}
                  className="group flex items-center gap-3 py-3 text-inherit no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
                >
                  <span className="w-4 shrink-0 text-[13px] font-semibold tabular-nums text-[var(--t3)]">
                    {index + 1}
                  </span>
                  <MarketThumb categorySlug={market.categorySlug} imageUrl={rowPhoto} size={40} />
                  <span className="line-clamp-2 min-w-0 flex-1 text-[14.5px] font-medium leading-[1.35] text-[var(--t1)] group-hover:underline group-hover:decoration-[var(--border-2)] group-hover:underline-offset-2">
                    {market.title}
                  </span>
                  <span className="shrink-0 text-[15px] font-semibold tabular-nums text-[var(--t1)]">
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
