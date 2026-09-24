"use client";

/**
 * MomentMarketsSection — the Kilig /predict board.
 *
 * Default view (Trending, no search, no closing window): the #1 market
 * becomes the LeadMoment poster, the next two sit beside it under
 * "Happening now", and the rest fill a mixed-size grid (MarketGrid
 * pattern="mixed") — never a uniform wall. Any filter drops the lead and
 * shows the filtered grid only. The controls keep the practical directory
 * model: search, activity/closing/newest sorting, and a closing window.
 * One QuickTradePanel serves the lead, the stack and the grid.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { Button, Input } from "../ui";
import { LeadMoment } from "./LeadMoment";
import { MarketGrid } from "./MarketGrid";
import { localizedMarket } from "./market-content";
import { dedupeMarkets } from "./market-display";
import { QuickTradePanel, type QuickTradeTarget } from "./QuickTradePanel";

const api = createPredictionClient();
// 12 per page: on the default view the lead and two "Happening now"
// markets take three, leaving nine grid cards (full mixed rows).
const PAGE_SIZE = 12;
const LEAD_COUNT = 3;
const GRID_SKELETON_IDS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
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

const FILTER_GROUP_CLASS =
  "inline-flex shrink-0 gap-1 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] p-[3px] max-[640px]:max-w-full max-[640px]:overflow-x-auto max-[640px]:[scrollbar-width:none] max-[640px]:[&::-webkit-scrollbar]:hidden";

function dateWindowToCloseBefore(window: DateWindow): string | undefined {
  if (window === "all") return undefined;
  const hours = window === "24h" ? 24 : window === "7d" ? 24 * 7 : 24 * 30;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function filterPillClass(active: boolean): string {
  return `min-h-9 cursor-pointer whitespace-nowrap rounded-[var(--r-rh-sm)] border-0 px-3 text-[13px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] ${
    active
      ? "bg-[var(--accent)] text-[var(--ticket-cta-text)]"
      : "bg-transparent text-[var(--t3)] hover:bg-[var(--surface-2)] hover:text-[var(--t1)]"
  }`;
}

function GridSkeleton() {
  return (
    <div
      className="grid grid-cols-3 items-stretch gap-4 min-[641px]:auto-rows-fr max-[1120px]:grid-cols-2 max-[640px]:grid-cols-1"
      aria-hidden="true"
    >
      {GRID_SKELETON_IDS.map((skeletonId) => (
        <div
          key={skeletonId}
          className="h-[236px] animate-pulse rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-4"
        >
          <div className="flex items-center justify-between">
            <span className="h-5 w-24 rounded-[var(--r-rh-sm)] bg-[var(--surface-2)]" />
            <span className="h-3 w-16 rounded-full bg-[var(--surface-2)]" />
          </div>
          <span className="mt-4 block h-4 w-11/12 rounded-full bg-[var(--surface-2)]" />
          <span className="mt-2 block h-4 w-3/4 rounded-full bg-[var(--surface-2)]" />
          <span className="mt-8 block h-2 w-full rounded-full bg-[var(--surface-2)]" />
          <div className="mt-4 grid grid-cols-2 gap-3">
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

  const showLead = !hasFilters && markets.length >= LEAD_COUNT;
  const leadMarkets = showLead
    ? markets.slice(0, LEAD_COUNT).map((market) => localizedMarket(contentT, market))
    : [];
  const gridMarkets = showLead ? markets.slice(LEAD_COUNT) : markets;

  return (
    <section id="trending-markets" aria-labelledby="moments-market-heading">
      {showLead && (
        <div className="mb-10 max-[640px]:mb-8">
          <LeadMoment
            lead={leadMarkets[0]}
            next={leadMarkets.slice(1)}
            onQuickTrade={(market, side) => setQuickTrade({ market, side })}
          />
        </div>
      )}

      <div className="flex items-end justify-between gap-4">
        <h2
          id="moments-market-heading"
          className="type-poster m-0 text-[34px] max-[640px]:text-[28px]"
        >
          {heading}
        </h2>
        <Link
          href="/discover"
          className="shrink-0 pb-1 text-[13px] font-semibold text-[var(--t2)] no-underline transition-colors hover:text-[var(--t1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
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
          className="min-h-10 min-w-[280px] flex-1 basis-[320px] max-[640px]:min-w-0 max-[640px]:basis-full"
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
            pattern="mixed"
            rankStart={showLead ? LEAD_COUNT + 1 : 1}
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
            size="lg"
            className="px-7"
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
