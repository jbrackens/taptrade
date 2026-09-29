"use client";

/**
 * MomentMarketsSection — the /predict board.
 *
 * Default view (Trending, no search, no closing window): a FeaturedMarket
 * (the most-traded contested market, with its chart) beside a ranked
 * trending list, then the market grid. Any filter drops the hero and
 * shows the filtered grid only. The controls keep the practical directory
 * model: search, activity/closing/newest sorting, and a closing window.
 * One QuickTradePanel serves the hero and the grid.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { Button } from "../ui";
import { FeaturedMarket, pickFeatured } from "./FeaturedMarket";
import { MARKET_GRID_CLASS, MarketGrid } from "./MarketGrid";
import { eventCardCount } from "./event-groups";
import { ROW_UNIT, useWholeRows } from "./whole-rows";
import { localizedMarket } from "./market-content";
import { dedupeMarkets } from "./market-display";
import { ActivityRail } from "./ActivityRail";
import { QuickTradePanel, type QuickTradeTarget } from "./QuickTradePanel";

const api = createPredictionClient();
// 18 per page: on the default view the featured market and five
// trending rows take six, leaving twelve grid cards (four full rows of
// three at desktop widths).
// Markets per request: the hero takes six and event cards fold several
// markets, so a page is larger than the 12-card block the grid shows.
const PAGE_SIZE = 24;
const TRENDING_LIST_COUNT = 5;
const GRID_SKELETON_IDS = Array.from({ length: ROW_UNIT }, (_, i) => `skeleton-${i}`);

type DateWindow = "all" | "24h" | "7d" | "30d";
type MarketSort = "activity" | "closing_soon" | "newest";

const SORT_PILLS: readonly {
  value: MarketSort;
  labelKey: string;
  fallback: string;
}[] = [
  { value: "activity", labelKey: "SORT_ACTIVITY", fallback: "Trending" },
  {
    value: "closing_soon",
    labelKey: "SORT_CLOSING_SOON",
    fallback: "Closing soon",
  },
  { value: "newest", labelKey: "SORT_NEWEST", fallback: "Newest" },
];

const TIME_PILLS: readonly {
  value: DateWindow;
  labelKey?: string;
  label?: string;
}[] = [
  { value: "all", labelKey: "ALL" },
  { value: "24h", label: "1D" },
  { value: "7d", label: "1W" },
  { value: "30d", label: "1M" },
];

// Segmented controls: a recessed track with the selected segment in ink
// (2026-09-29 redesign, matching the chart's range picker).
const FILTER_GROUP_CLASS =
  "inline-flex shrink-0 gap-0.5 rounded-[var(--r-pill)] bg-[var(--surface-2)] p-[3px] max-[640px]:max-w-full max-[640px]:overflow-x-auto max-[640px]:[scrollbar-width:none] max-[640px]:[&::-webkit-scrollbar]:hidden";

function dateWindowToCloseBefore(window: DateWindow): string | undefined {
  if (window === "all") return undefined;
  const hours = window === "24h" ? 24 : window === "7d" ? 24 * 7 : 24 * 30;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function filterPillClass(active: boolean): string {
  return `h-8 pointer-coarse:h-11 pointer-coarse:min-w-11 cursor-pointer whitespace-nowrap rounded-[var(--r-pill)] border-0 px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] max-[640px]:h-9 ${
    active
      ? "bg-[var(--accent)] font-semibold text-[var(--on-ink)]"
      : "bg-transparent text-[var(--t3)] hover:text-[var(--t1)]"
  }`;
}

function GridSkeleton() {
  return (
    <div className={MARKET_GRID_CLASS} aria-hidden="true">
      {GRID_SKELETON_IDS.map((skeletonId) => (
        <div
          key={skeletonId}
          className="h-[168px] animate-pulse rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-4"
        >
          <div className="flex items-start gap-3">
            <span className="h-10 w-10 shrink-0 rounded-[8px] bg-[var(--surface-2)]" />
            <div className="flex-1">
              <span className="block h-3.5 w-11/12 rounded-full bg-[var(--surface-2)]" />
              <span className="mt-2 block h-3.5 w-2/3 rounded-full bg-[var(--surface-2)]" />
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <span className="h-10 rounded-[var(--r-rh-md)] bg-[var(--surface-2)]" />
            <span className="h-10 rounded-[var(--r-rh-md)] bg-[var(--surface-2)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MomentMarketsSection({ categoryId }: { categoryId?: string }) {
  const { t } = useTranslation("prediction");
  const { t: contentT } = useTranslation("market-content");
  const [quickTrade, setQuickTrade] = useState<QuickTradeTarget | null>(null);
  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [sortBy, setSortBy] = useState<MarketSort>("activity");
  const [dateWindow, setDateWindow] = useState<DateWindow>("all");
  const loadMoreRequestRef = useRef(0);

  const requestParams = useMemo(
    () => ({
      status: "open" as const,
      categoryId,
      closeBefore: dateWindowToCloseBefore(dateWindow),
      sort: sortBy,
    }),
    // Recalculate a selected closing window when the user retries, rather
    // than reusing a stale "next 1D / 1W / 1M" cutoff.
    [categoryId, dateWindow, sortBy, reloadNonce],
  );

  // A filter change starts a fresh 3×3 result set and invalidates an older
  // Load More response, so an old query cannot append into new results.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadNonce deliberately repeats the same request after a load error
  useEffect(() => {
    let cancelled = false;
    loadMoreRequestRef.current += 1;
    setLoading(true);
    setLoadingMore(false);
    setMarkets([]);
    setPage(1);
    setHasNext(false);
    setError(null);

    api
      .getMarkets({ ...requestParams, page: 1, pageSize: PAGE_SIZE })
      .then((response) => {
        if (cancelled) return;
        setMarkets(response.data || []);
        setPage(response.meta.page);
        setHasNext(response.meta.hasNext);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadNonce, requestParams]);

  function fetchNextPage() {
    if (loadingMore || !hasNext) return;
    const requestId = loadMoreRequestRef.current + 1;
    loadMoreRequestRef.current = requestId;
    setLoadingMore(true);
    setError(null);

    api
      .getMarkets({ ...requestParams, page: page + 1, pageSize: PAGE_SIZE })
      .then((response) => {
        if (loadMoreRequestRef.current !== requestId) return;
        setMarkets((current) =>
          dedupeMarkets([...current, ...(response.data || [])]),
        );
        setPage(response.meta.page);
        setHasNext(response.meta.hasNext);
      })
      .catch((cause: unknown) => {
        if (loadMoreRequestRef.current === requestId) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (loadMoreRequestRef.current === requestId) {
          setLoadingMore(false);
        }
      });
  }

  const activeSort = SORT_PILLS.find((pill) => pill.value === sortBy);
  const heading =
    sortBy === "activity"
      ? t("TRENDING_MARKETS", "Trending markets")
      : t(
          activeSort?.labelKey ?? "TRENDING_MARKETS",
          activeSort?.fallback ?? "Trending markets",
        );
  const hasFilters =
    dateWindow !== "all" || sortBy !== "activity";

  // The hero needs the featured market plus a full trending list.
  const showHero = !hasFilters && markets.length > TRENDING_LIST_COUNT;
  const featured = showHero ? pickFeatured(markets.slice(0, PAGE_SIZE)) : undefined;
  const trendingList = featured
    ? markets
        .slice(0, PAGE_SIZE)
        .filter((market) => market.id !== featured.id)
        .slice(0, TRENDING_LIST_COUNT)
    : [];
  const heroIds = new Set(
    featured ? [featured.id, ...trendingList.map((market) => market.id)] : [],
  );
  const gridMarkets = featured
    ? markets.filter((market) => !heroIds.has(market.id))
    : markets;
  // Whole rows: 12-card blocks, the next page fetched quietly to fill one.
  const rows = useWholeRows({
    cardCount: eventCardCount(gridMarkets),
    hasNext,
    busy: loading || loadingMore || Boolean(error),
    fetchNext: fetchNextPage,
    resetKey: requestParams,
  });

  return (
    <section id="trending-markets" aria-labelledby="moments-market-heading">
      {featured && (
        <div className="mb-10 max-[640px]:mb-8">
          <FeaturedMarket
            featured={localizedMarket(contentT, featured)}
            trending={trendingList.map((market) => localizedMarket(contentT, market))}
            onQuickTrade={(market, side) => setQuickTrade({ market, side })}
          />
        </div>
      )}
      {/* Proof of life: real fills and movers, only when there are any. */}
      {!hasFilters && <ActivityRail />}

      {/* 2026-09-29 redesign: one search box (the header's). Desktop:
          "All markets" with the sort and closing-window controls; phones:
          the sorted list's name and "See all" (the filters live on
          /discover there). */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2
          id="moments-market-heading"
          className="m-0 text-[20px] font-semibold tracking-[-0.02em] text-[var(--t1)] max-[640px]:text-[17px]"
        >
          <span className="max-[640px]:hidden">
            {t("ALL_MARKETS", "All markets")}
          </span>
          <span className="min-[641px]:hidden">{heading}</span>
        </h2>
        <Link
          href="/discover"
          className="shrink-0 text-[15px] font-medium text-[var(--t1)] no-underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center transition-colors hover:text-[var(--t2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] min-[641px]:hidden"
        >
          {t("SEE_ALL", "See all")}
        </Link>

        <div
          className="flex flex-wrap items-center gap-3 max-[640px]:hidden"
          data-testid="moment-filter-bar"
        >
          <fieldset className={`${FILTER_GROUP_CLASS} m-0 min-w-0`}>
            <legend className="sr-only">{t("SORT_MARKETS", "Sort markets")}</legend>
            {SORT_PILLS.map((pill) => {
              const active = sortBy === pill.value;
              return (
                <button
                  key={pill.value}
                  type="button"
                  aria-pressed={active}
                  data-testid={`market-sort-${pill.value}`}
                  className={filterPillClass(active)}
                  onClick={() => setSortBy(pill.value)}
                >
                  {t(pill.labelKey, pill.fallback)}
                </button>
              );
            })}
          </fieldset>

          <fieldset className={`${FILTER_GROUP_CLASS} m-0 min-w-0`}>
            <legend className="sr-only">
              {t("FILTER_BY_CLOSING_WINDOW", "Filter by closing window")}
            </legend>
            {TIME_PILLS.map((pill) => {
              const active = dateWindow === pill.value;
              return (
                <button
                  key={pill.value}
                  type="button"
                  aria-pressed={active}
                  data-testid={`market-window-${pill.value}`}
                  className={filterPillClass(active)}
                  onClick={() => setDateWindow(pill.value)}
                >
                  {pill.labelKey ? t(pill.labelKey) : pill.label}
                </button>
              );
            })}
          </fieldset>
        </div>
      </div>

      <div className="mt-5">
        {error && markets.length === 0 ? (
          <div
            role="alert"
            className="rounded-[var(--r-rh-lg)] border border-[var(--border-1)] border-l-[3px] border-l-[var(--danger)] bg-[var(--surface-1)] px-5 py-4"
          >
            <p className="m-0 text-sm font-semibold text-[var(--t1)]">
              {t("COULD_NOT_LOAD_MARKETS", "Markets could not be loaded")}
            </p>
            <p className="mb-0 mt-1 text-[13px] text-[var(--t2)]">{error}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => setReloadNonce((nonce) => nonce + 1)}
            >
              {t("RETRY", "Try again")}
            </Button>
          </div>
        ) : loading && markets.length === 0 ? (
          <GridSkeleton />
        ) : gridMarkets.length > 0 ? (
          <MarketGrid
            markets={gridMarkets}
            columns={4}
            groupEvents
            cardLimit={rows.cardLimit}
            onQuickTrade={setQuickTrade}
          />
        ) : markets.length > 0 ? null : (
          <div className="rounded-[var(--r-rh-lg)] border border-dashed border-[var(--border-2)] bg-[var(--surface-1)] px-5 py-10 text-center">
            <p className="m-0 text-sm font-semibold text-[var(--t1)]">
              {t("NO_FILTER_MATCH", "No markets match those filters")}
            </p>
            {hasFilters && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setSortBy("activity");
                  setDateWindow("all");
                }}
              >
                {t("CLEAR_FILTERS", "Clear filters")}
              </Button>
            )}
          </div>
        )}
      </div>

      {error && markets.length > 0 && (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] border-l-[3px] border-l-[var(--danger)] bg-[var(--surface-1)] px-4 py-3"
        >
          <p className="m-0 text-[13px] text-[var(--t2)]">
            {t(
              "COULD_NOT_LOAD_MORE_MARKETS",
              "The next batch could not be loaded. Try again.",
            )}
          </p>
          <Button variant="secondary" size="sm" onClick={fetchNextPage}>
            {t("RETRY", "Try again")}
          </Button>
        </div>
      )}

      {rows.canShowMore && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="secondary"
            size="md"
            className="px-6"
            onClick={rows.showMore}
            disabled={loadingMore}
          >
            {loadingMore
              ? t("LOADING", "Loading…")
              : t("LOAD_MORE_MARKETS", "Load More Markets")}
          </Button>
        </div>
      )}

      <QuickTradePanel target={quickTrade} onClose={() => setQuickTrade(null)} />
    </section>
  );
}
