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
import { Button, Input } from "../ui";
import { FeaturedMarket, pickFeatured } from "./FeaturedMarket";
import { MarketGrid } from "./MarketGrid";
import { localizedMarket } from "./market-content";
import { dedupeMarkets } from "./market-display";
import { QuickTradePanel, type QuickTradeTarget } from "./QuickTradePanel";

const api = createPredictionClient();
// 18 per page: on the default view the featured market and five
// trending rows take six, leaving twelve grid cards (four full rows of
// three at desktop widths).
const PAGE_SIZE = 18;
const TRENDING_LIST_COUNT = 5;
const GRID_SKELETON_IDS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
] as const;

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

// Segmented controls: a recessed track with the selected segment raised
// in white, the iOS pattern.
const FILTER_GROUP_CLASS =
  "inline-flex shrink-0 gap-0.5 rounded-[10px] bg-[var(--surface-2)] p-[3px] max-[640px]:max-w-full max-[640px]:overflow-x-auto max-[640px]:[scrollbar-width:none] max-[640px]:[&::-webkit-scrollbar]:hidden";

function dateWindowToCloseBefore(window: DateWindow): string | undefined {
  if (window === "all") return undefined;
  const hours = window === "24h" ? 24 : window === "7d" ? 24 * 7 : 24 * 30;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function filterPillClass(active: boolean): string {
  return `h-8 cursor-pointer whitespace-nowrap rounded-[8px] border-0 px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] max-[640px]:h-9 ${
    active
      ? "bg-[var(--surface-1)] font-semibold text-[var(--t1)] shadow-[0_1px_2px_rgba(17,17,20,0.08),0_0_0_0.5px_rgba(17,17,20,0.06)]"
      : "bg-transparent text-[var(--t3)] hover:text-[var(--t1)]"
  }`;
}

function GridSkeleton() {
  return (
    <div
      className="grid grid-cols-3 items-stretch gap-4 max-[1020px]:grid-cols-2 max-[640px]:grid-cols-1"
      aria-hidden="true"
    >
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
  const { t: headerT } = useTranslation("header");
  const { t: contentT } = useTranslation("market-content");
  const [quickTrade, setQuickTrade] = useState<QuickTradeTarget | null>(null);
  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<MarketSort>("activity");
  const [dateWindow, setDateWindow] = useState<DateWindow>("all");
  const loadMoreRequestRef = useRef(0);

  const requestParams = useMemo(
    () => ({
      status: "open" as const,
      categoryId,
      closeBefore: dateWindowToCloseBefore(dateWindow),
      q: query.trim() || undefined,
      sort: sortBy,
    }),
    // Recalculate a selected closing window when the user retries, rather
    // than reusing a stale "next 1D / 1W / 1M" cutoff.
    [categoryId, dateWindow, query, sortBy, reloadNonce],
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

  function loadMore() {
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
    Boolean(query.trim()) || dateWindow !== "all" || sortBy !== "activity";

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

      <div className="flex items-center justify-between gap-4">
        <h2
          id="moments-market-heading"
          className="m-0 text-[20px] font-semibold tracking-[-0.02em] text-[var(--t1)]"
        >
          {heading}
        </h2>
        <Link
          href="/discover"
          className="shrink-0 text-[13px] font-medium text-[var(--t2)] no-underline transition-colors hover:text-[var(--t1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
        >
          {t("VIEW_ALL_MOMENTS", "View all moments")} →
        </Link>
      </div>

      <div
        className="mt-4 flex flex-wrap items-center gap-3 max-[640px]:items-stretch"
        data-testid="moment-filter-bar"
      >
        <Input
          type="search"
          className="h-[38px] min-h-0 min-w-[240px] flex-1 basis-[280px] rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-1)] text-[14px] max-[640px]:h-10 max-[640px]:min-w-0 max-[640px]:basis-full"
          placeholder={t(
            "SEARCH_MARKETS_PLACEHOLDER",
            headerT("SEARCH_MARKETS_PLACEHOLDER"),
          )}
          aria-label={headerT("SEARCH_MARKETS")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

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
              {t("RETRY", "Retry")}
            </Button>
          </div>
        ) : loading && markets.length === 0 ? (
          <GridSkeleton />
        ) : gridMarkets.length > 0 ? (
          <MarketGrid
            markets={gridMarkets}
            columns={3}
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
                  setQuery("");
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
          <Button variant="secondary" size="sm" onClick={loadMore}>
            {t("RETRY", "Retry")}
          </Button>
        </div>
      )}

      {hasNext && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="secondary"
            size="md"
            className="px-6"
            onClick={loadMore}
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
