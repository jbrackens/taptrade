"use client";

/**
 * AllMarketsSection — paginated grid of open prediction markets, owning
 * its own filter state. The section header exposes category tabs, search,
 * sort, and closing-window filters. No title — the layout is self-evident.
 *
 * Both filters scope only this section (NOT the hero, Top Movers, or
 * Featured). They compose: pick "Politics" + "1D" = political markets
 * closing within 24h.
 *
 * Pagination is "Load more" rather than infinite scroll: trading users
 * scan price columns, and infinite scroll plays badly with that pattern.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarketGrid } from "./MarketGrid";
import { Button, Input } from "../ui";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import {
  addMarketToWatchlist,
  getMarketWatchlist,
  removeMarketFromWatchlist,
} from "../../lib/api/market-watchlist-client";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../ToastProvider";
import { MomentMarketsSection } from "./MomentMarketsSection";
import { categoryName } from "./market-content";
import {
  extractMarketSubcategories,
  marketMatchesSubcategory,
} from "./marketSubcategories";
import type {
  Category,
  PredictionMarket,
} from "@taptrade-ui/api-client/src/prediction-types";

const api = createPredictionClient();

const PAGE_SIZE = 9;
const SUBCATEGORY_CORPUS_SIZE = 120;

type DateWindow = "all" | "24h" | "7d" | "30d";
type MarketSort = "activity" | "closing_soon" | "newest";

const SORT_PILLS: {
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

const CATEGORY_ORDER = [
  "entertainment",
  "politics",
  "sports",
  "tech",
  "economics",
  "general",
] as const;

const TIME_PILLS: { value: DateWindow; labelKey?: string; label?: string }[] = [
  { value: "all", labelKey: "ALL" },
  { value: "24h", label: "1D" },
  { value: "7d", label: "1W" },
  { value: "30d", label: "1M" },
];

const FILTER_HEAD_CLASS =
  "mt-6 mb-[18px] flex flex-wrap items-center justify-between gap-4 max-[768px]:mt-5 max-[768px]:mb-4 max-[768px]:flex-col max-[768px]:flex-nowrap max-[768px]:items-stretch max-[768px]:justify-start max-[768px]:gap-2.5";

const CATEGORY_LIST_CLASS =
  "flex items-center gap-6 w-full border-b border-[var(--border-1)] max-[768px]:mx-[-16px] max-[768px]:w-[calc(100%+32px)] max-[768px]:flex-[0_0_auto] max-[768px]:flex-row max-[768px]:flex-nowrap max-[768px]:overflow-x-auto max-[768px]:overflow-y-hidden max-[768px]:whitespace-nowrap max-[768px]:px-4 max-[768px]:[scrollbar-width:none] max-[768px]:[-ms-overflow-style:none] max-[768px]:[-webkit-overflow-scrolling:touch] max-[768px]:[&::-webkit-scrollbar]:hidden";

const CATEGORY_PILL_BASE_CLASS =
  "relative min-h-11 cursor-pointer appearance-none bg-transparent pb-3 pt-2 text-sm font-medium border-b-2 transition-colors duration-150 [font-family:inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] max-[768px]:flex-[0_0_auto] max-[768px]:whitespace-nowrap";

const TIME_PILLS_CLASS =
  "inline-flex shrink-0 gap-1 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] p-[3px] max-[768px]:max-w-full max-[768px]:self-start max-[768px]:overflow-x-auto max-[768px]:[scrollbar-width:none] max-[768px]:[-ms-overflow-style:none] max-[768px]:[-webkit-overflow-scrolling:touch] max-[768px]:[&::-webkit-scrollbar]:hidden";

const TIME_PILL_BASE_CLASS =
  "min-w-11 min-h-[38px] cursor-pointer appearance-none rounded-[var(--r-rh-sm)] border-0 px-[14px] [font-family:inherit] text-xs font-semibold transition-colors duration-150 max-[768px]:flex-[0_0_auto] max-[768px]:whitespace-nowrap";

const DISCOVERY_CONTROLS_CLASS =
  "flex w-full flex-wrap items-center justify-between gap-3 max-[768px]:items-stretch";

const LOAD_MORE_CLASS = "mt-6 mb-0 flex justify-center";

const FEED_WITH_SUBNAV_CLASS =
  "grid grid-cols-4 items-start gap-4 max-[1600px]:grid-cols-1";
const FEED_MARKETS_CLASS = "col-span-3 min-w-0 max-[1600px]:col-span-1";
const SUBNAV_CLASS =
  "sticky top-4 self-start border-l border-[var(--border-1)] pl-4 max-[1600px]:order-first max-[1600px]:static max-[1600px]:border-b max-[1600px]:border-l-0 max-[1600px]:pb-3 max-[1600px]:pl-0";
const SUBNAV_LABEL_CLASS =
  "mb-3 text-[12px] font-semibold text-[var(--t3)]";
const SUBNAV_LIST_CLASS =
  "flex flex-col items-stretch gap-1 max-[1600px]:flex-row max-[1600px]:overflow-x-auto max-[1600px]:[scrollbar-width:none] max-[1600px]:[-ms-overflow-style:none] max-[1600px]:[-webkit-overflow-scrolling:touch] max-[1600px]:[&::-webkit-scrollbar]:hidden";
const SUBNAV_BUTTON_BASE_CLASS =
  "cursor-pointer appearance-none rounded-[var(--r-rh-md)] border-0 px-3 py-2 text-left [font-family:inherit] text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] max-[1600px]:flex-[0_0_auto]";

const EMPTY_TITLE_CLASS = "m-0 text-[18px] font-semibold text-[var(--t1)]";
const EMPTY_TEXT_CLASS = "mt-2 mb-0 text-[13px] text-[var(--t3)]";

function categoryPillClass(active: boolean): string {
  return `${CATEGORY_PILL_BASE_CLASS} ${
    active
      ? "border-[var(--accent-lo)] font-semibold text-[var(--accent-text)]"
      : "border-transparent text-[var(--t3)] hover:border-[var(--border-2)] hover:text-[var(--t1)]"
  }`;
}

// Step 3 (2026-07-26): active selection is the LIME fill with ink-on-lime —
// direction green is never a selection colour (spec §2, flagged in 2.5).
// Inactive hover darkens the label only: a background change on these light
// surfaces reads as selection, not hover.
function timePillClass(active: boolean): string {
  return `${TIME_PILL_BASE_CLASS} ${
    active
      ? "bg-[var(--accent)] text-[var(--ticket-cta-text)]"
      : "bg-transparent text-[var(--t3)] hover:text-[var(--t1)]"
  }`;
}

function subcategoryButtonClass(active: boolean): string {
  return `${SUBNAV_BUTTON_BASE_CLASS} ${
    active
      ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]"
      : "bg-transparent font-medium text-[var(--t2)] hover:bg-[var(--surface-2)] hover:text-[var(--t1)]"
  }`;
}

function dateWindowToCloseBefore(w: DateWindow): string | undefined {
  if (w === "all") return undefined;
  const ms = w === "24h" ? 24 : w === "7d" ? 24 * 7 : 24 * 30;
  return new Date(Date.now() + ms * 60 * 60 * 1000).toISOString();
}

function mergeMarkets(
  current: PredictionMarket[],
  next: PredictionMarket[],
): PredictionMarket[] {
  const seen = new Set(current.map((market) => market.id));
  const merged = [...current];
  for (const market of next) {
    if (seen.has(market.id)) continue;
    seen.add(market.id);
    merged.push(market);
  }
  return merged;
}

function orderCategories(categories: Category[]): Category[] {
  const rank = new Map<string, number>(
    CATEGORY_ORDER.map((slug, index) => [slug, index]),
  );
  return categories
    .filter((category) => category.slug.toLowerCase() !== "crypto")
    .sort((a, b) => {
      const aRank = rank.get(a.slug.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      const bRank = rank.get(b.slug.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return categories.indexOf(a) - categories.indexOf(b);
    });
}


// Phosphor "warning-circle-fill", copied VERBATIM from
// design_handoff_taptrade/logos/phosphor-paths.json (phosphor-icons/core@main,
// MIT; filled geometry on a 256 grid — never reconstruct by hand).
const PHOSPHOR_WARNING_CIRCLE_FILL =
  "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-8,56a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm8,104a12,12,0,1,1,12-12A12,12,0,0,1,128,184Z";

// Kilig loading state: a quiet solid pulse (no gradient shimmer), matching
// MomentMarketsSection's GridSkeleton.
const SKELETON_SHIMMER_CLASS = "animate-pulse rounded-full bg-[var(--surface-2)]";

function MarketCardSkeleton() {
  return (
    <div className="relative flex h-full min-h-[248px] flex-col rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-5 max-[640px]:min-h-[238px] max-[640px]:p-4">
      <div className="flex items-center gap-2">
        <span className={`h-10 w-10 !rounded-[var(--r-rh-md)] ${SKELETON_SHIMMER_CLASS}`} />
        <span className={`h-2.5 w-20 ${SKELETON_SHIMMER_CLASS}`} />
      </div>
      <span className={`mt-4 block h-3.5 w-full ${SKELETON_SHIMMER_CLASS}`} />
      <span className={`mt-2 block h-3.5 w-3/4 ${SKELETON_SHIMMER_CLASS}`} />
      <span className={`mt-4 block h-2 w-28 ${SKELETON_SHIMMER_CLASS}`} />
      <div className="mt-auto grid grid-cols-2 gap-2.5 pt-4">
        <span className={`h-11 !rounded-[var(--r-rh-md)] ${SKELETON_SHIMMER_CLASS}`} />
        <span className={`h-11 !rounded-[var(--r-rh-md)] ${SKELETON_SHIMMER_CLASS}`} />
      </div>
      <span className={`mt-3 block h-2.5 w-2/3 ${SKELETON_SHIMMER_CLASS}`} />
    </div>
  );
}

interface Props {
  categories: Category[];
  /** The approved Moments surface shares the established directory filters
   * while retaining the denser, participant-view market cards. */
  categoryId?: string;
  variant?: "catalog" | "moments";
}

export function AllMarketsSection({
  categories,
  categoryId,
  variant = "catalog",
}: Props) {
  if (variant === "moments") {
    return <MomentMarketsSection categoryId={categoryId} />;
  }

  return <CatalogAllMarketsSection categories={categories} />;
}

function CatalogAllMarketsSection({ categories }: Pick<Props, "categories">) {
  const { t } = useTranslation("prediction");
  const { t: headerT } = useTranslation("header");
  const { t: contentT } = useTranslation("market-content");
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [subcategoryCorpus, setSubcategoryCorpus] = useState<
    PredictionMarket[]
  >([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Step 3 (States 18c): errors get a real Retry — bumping the nonce
  // re-runs the load effect without reloading the route.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [categorySlug, setCategorySlug] = useState<string>("all");
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [dateWindow, setDateWindow] = useState<DateWindow>("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<MarketSort>("activity");
  const [watchedMarketIds, setWatchedMarketIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const orderedCategories = useMemo(
    () => orderCategories(categories),
    [categories],
  );

  const activeCategory = categories.find((c) => c.slug === categorySlug);
  const categoryId = activeCategory?.id;
  const activeCategoryLabel = activeCategory
    ? categoryName(contentT, activeCategory)
    : categorySlug;
  const showSubnavCategory =
    categorySlug !== "all" && categorySlug !== "general";
  const subcategorySource =
    subcategoryCorpus.length > 0 ? subcategoryCorpus : markets;
  const subcategories = useMemo(
    () =>
      showSubnavCategory
        ? extractMarketSubcategories(
            subcategorySource,
            activeCategory ?? categorySlug,
          )
        : [],
    [activeCategory, categorySlug, showSubnavCategory, subcategorySource],
  );
  const visibleMarkets = useMemo(() => {
    const base = subcategory
      ? subcategorySource.filter((market) =>
          marketMatchesSubcategory(
            market,
            subcategory,
            activeCategory ?? categorySlug,
          ),
        )
      : markets;
    return showWatchlistOnly
      ? base.filter((market) => watchedMarketIds.has(market.id))
      : base;
  }, [
    activeCategory,
    categorySlug,
    markets,
    showWatchlistOnly,
    subcategory,
    subcategorySource,
    watchedMarketIds,
  ]);
  const hasSecondaryNav = showSubnavCategory && subcategories.length > 0;

  // Watchlist is a session-protected endpoint: for anonymous visitors the
  // fetch is guaranteed 401 churn (and used to drag a doomed
  // /auth/refresh attempt behind it via the 401-retry path), so only fetch
  // once a user is actually authenticated. Re-runs on login/logout: login
  // loads the real list, logout resets to empty.
  useEffect(() => {
    if (!isAuthenticated) {
      setWatchedMarketIds(new Set());
      return;
    }
    let cancelled = false;
    getMarketWatchlist()
      .then((ids) => {
        if (!cancelled) setWatchedMarketIds(new Set(ids));
      })
      .catch(() => {
        if (!cancelled) setWatchedMarketIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: subcategory reset keyed to navigation inputs it doesn't read — intentional signal dependency
  useEffect(() => {
    setSubcategory(null);
  }, [categorySlug, dateWindow]);

  useEffect(() => {
    if (subcategory && !subcategories.includes(subcategory)) {
      setSubcategory(null);
    }
  }, [subcategory, subcategories]);

  // Initial load + refetch when either filter changes.
  // closeBefore is computed inside the effect (NOT outside) because it
  // calls Date.now(); recomputing it on every render would produce a new
  // ISO string each time and trigger an infinite re-fetch loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: categorySlug is a deliberate refetch trigger alongside the resolved categoryId
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMarkets([]);
    setSubcategoryCorpus([]);
    setPage(1);
    const search = query.trim();
    const baseParams = {
      status: "open",
      categoryId,
      closeBefore: dateWindowToCloseBefore(dateWindow),
      q: search || undefined,
      sort: sortBy,
    };
    const pageRequest = api.getMarkets({
      ...baseParams,
      page: 1,
      pageSize: PAGE_SIZE,
    });
    const corpusRequest = showSubnavCategory
      ? api
          .getMarkets({
            ...baseParams,
            page: 1,
            pageSize: SUBCATEGORY_CORPUS_SIZE,
          })
          .catch(() => null)
      : Promise.resolve(null);

    Promise.all([pageRequest, corpusRequest])
      .then(([res, corpusRes]) => {
        if (cancelled) return;
        setMarkets(res.data || []);
        setSubcategoryCorpus(corpusRes?.data || res.data || []);
        setPage(res.meta.page);
        setHasNext(res.meta.hasNext);
        setError(null);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!cancelled) setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId, categorySlug, dateWindow, query, showSubnavCategory, sortBy, reloadNonce]);

  function loadMore() {
    if (loadingMore || !hasNext) return;
    setLoadingMore(true);
    api
      .getMarkets({
        status: "open",
        page: page + 1,
        pageSize: PAGE_SIZE,
        categoryId,
        closeBefore: dateWindowToCloseBefore(dateWindow),
        q: query.trim() || undefined,
        sort: sortBy,
      })
      .then((res) => {
        const next = res.data || [];
        setMarkets((prev) => [...prev, ...next]);
        setSubcategoryCorpus((prev) => mergeMarkets(prev, next));
        setPage(res.meta.page);
        setHasNext(res.meta.hasNext);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }

  function toggleWatchlist(marketId: string) {
    // QA fix ISSUE-002 (2026-07-26): signed out, the star used to no-op
    // silently (optimistic toggle → 401 → silent revert). Say what's
    // needed instead of doing nothing.
    if (!isAuthenticated) {
      toast.info(
        t("WATCHLIST_SIGN_IN", "Sign in to save markets"),
        t(
          "WATCHLIST_SIGN_IN_BODY",
          "Log in and tap the star to build your watchlist.",
        ),
      );
      return;
    }
    const currentlyWatched = watchedMarketIds.has(marketId);
    setWatchedMarketIds((prev) => {
      const next = new Set(prev);
      if (currentlyWatched) {
        next.delete(marketId);
      } else {
        next.add(marketId);
      }
      return next;
    });
    const request = currentlyWatched
      ? removeMarketFromWatchlist(marketId)
      : addMarketToWatchlist(marketId);
    request.catch((err: unknown) => {
      setWatchedMarketIds((prev) => {
        const next = new Set(prev);
        if (currentlyWatched) {
          next.add(marketId);
        } else {
          next.delete(marketId);
        }
        return next;
      });
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    });
  }

  const filtered =
    categorySlug !== "all" ||
    dateWindow !== "all" ||
    subcategory !== null ||
    query.trim() !== "" ||
    showWatchlistOnly;
  // Step 3 (States 18b): dashed frame; an empty state gets an action only
  // when the user can DO something about it — filters qualify because the
  // user created the emptiness themselves.
  const emptyState = (
    <div className="rounded-[var(--r-rh-lg)] border border-dashed border-[var(--border-2)] bg-[var(--surface-1)] px-[18px] py-[26px] text-center">
      <h3 className={EMPTY_TITLE_CLASS}>
        {filtered ? t("NO_FILTER_MATCH") : t("NO_OPEN_MARKETS")}
      </h3>
      <p className={EMPTY_TEXT_CLASS}>
        {filtered ? t("TRY_DIFFERENT_FILTER") : t("CHECK_BACK_SOON")}
      </p>
      {filtered && (
        <Button
          variant="secondary"
          size="md"
          className="mt-3.5"
          onClick={() => {
            setCategorySlug("all");
            setDateWindow("all");
            setSubcategory(null);
            setQuery("");
            setShowWatchlistOnly(false);
          }}
        >
          {t("CLEAR_FILTERS", "Clear filters")}
        </Button>
      )}
    </div>
  );

  return (
    <>
      <header className={FILTER_HEAD_CLASS}>
        <div
          className={CATEGORY_LIST_CLASS}
          role="tablist"
          aria-label={t("FILTER_BY_CATEGORY")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={categorySlug === "all"}
            className={categoryPillClass(categorySlug === "all")}
            onClick={() => {
              setCategorySlug("all");
              setSubcategory(null);
            }}
          >
            {t("ALL")}
          </button>
          {orderedCategories.map((c) => {
            const isActive = categorySlug === c.slug;
            return (
              <button
                key={c.slug}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={categoryPillClass(isActive)}
                onClick={() => {
                  setCategorySlug(c.slug);
                  setSubcategory(null);
                }}
              >
                {categoryName(contentT, c)}
              </button>
            );
          })}
        </div>
        <div className={DISCOVERY_CONTROLS_CLASS}>
          <Input
            type="search"
            className="min-w-[260px] flex-1 max-[768px]:min-w-0 max-[768px]:basis-full max-[768px]:w-full"
            placeholder={headerT("SEARCH_MARKETS_PLACEHOLDER")}
            aria-label={headerT("SEARCH_MARKETS")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div
            className={TIME_PILLS_CLASS}
            role="tablist"
            aria-label={t("SORT_MARKETS", "Sort markets")}
          >
            {SORT_PILLS.map((pill) => {
              const isActive = sortBy === pill.value;
              return (
                <button
                  key={pill.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={timePillClass(isActive)}
                  onClick={() => setSortBy(pill.value)}
                >
                  {t(pill.labelKey, pill.fallback)}
                </button>
              );
            })}
          </div>
          <Button
            size="none"
            className={`min-h-10 px-3 text-sm ${
              showWatchlistOnly
                ? "border-[var(--accent-lo)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
                : ""
            }`}
            aria-pressed={showWatchlistOnly}
            onClick={() => setShowWatchlistOnly((value) => !value)}
          >
            {t("WATCHLIST", "Watchlist")}
          </Button>
          <div
            className={TIME_PILLS_CLASS}
            role="tablist"
            aria-label={t("FILTER_BY_CLOSING_WINDOW")}
          >
            {TIME_PILLS.map((pill) => {
              const isActive = dateWindow === pill.value;
              return (
                <button
                  key={pill.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={timePillClass(isActive)}
                  onClick={() => setDateWindow(pill.value)}
                >
                  {pill.labelKey ? t(pill.labelKey) : pill.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {loading && markets.length === 0 ? (
        // Match the loaded grid's nine-card first page to avoid layout shift.
        <div
          className="grid grid-cols-3 items-stretch gap-5 min-[641px]:auto-rows-fr max-[1120px]:grid-cols-2 max-[640px]:grid-cols-1 max-[640px]:gap-4"
          aria-hidden="true"
        >
          {Array.from({ length: PAGE_SIZE }, (_, i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </div>
      ) : error && markets.length === 0 ? (
        // Step 3 (States 18c): hairline card with a coloured left edge,
        // the phosphor warning glyph, and a ≥44px retry. Errors use the
        // system danger colour — never market-NO orange.
        <div
          role="alert"
          className="rounded-[var(--r-rh-lg)] border border-[var(--border-1)] border-l-[3px] border-l-[var(--danger)] bg-[var(--surface-1)] px-[18px] py-4"
        >
          <div className="flex items-center gap-[9px]">
            <svg
              viewBox="0 0 256 256"
              width="16"
              height="16"
              fill="currentColor"
              aria-hidden="true"
              className="flex-none text-[var(--danger)]"
            >
              {/* phosphor warning-circle-fill — verbatim from
                  design_handoff_taptrade/logos/phosphor-paths.json */}
              <path d={PHOSPHOR_WARNING_CIRCLE_FILL} />
            </svg>
            <span className="text-sm font-semibold tracking-[-0.005em] text-[var(--t1)]">
              {t("COULD_NOT_LOAD_MARKETS")}
            </span>
          </div>
          <p className="mb-0 mt-[9px] text-[13px] leading-[1.5] text-[var(--t2)]">
            {error}
          </p>
          <Button
            variant="secondary"
            size="md"
            className="mt-3.5"
            onClick={() => setReloadNonce((n) => n + 1)}
          >
            {t("RETRY", "Retry")}
          </Button>
        </div>
      ) : !loading && markets.length === 0 ? (
        emptyState
      ) : (
        <>
          {hasSecondaryNav ? (
            <div className={FEED_WITH_SUBNAV_CLASS}>
              <div className={FEED_MARKETS_CLASS}>
                {visibleMarkets.length > 0 ? (
                  <MarketGrid
                    markets={visibleMarkets}
                    columns={3}
                    watchedMarketIds={watchedMarketIds}
                    onToggleWatchlist={toggleWatchlist}
                  />
                ) : (
                  emptyState
                )}
              </div>
              <aside className={SUBNAV_CLASS} aria-label={activeCategoryLabel}>
                <div className={SUBNAV_LABEL_CLASS}>{activeCategoryLabel}</div>
                <div className={SUBNAV_LIST_CLASS} role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={subcategory === null}
                    className={subcategoryButtonClass(subcategory === null)}
                    onClick={() => setSubcategory(null)}
                  >
                    {t("ALL")}
                  </button>
                  {subcategories.map((item) => (
                    <button
                      key={item}
                      type="button"
                      role="tab"
                      aria-selected={subcategory === item}
                      className={subcategoryButtonClass(subcategory === item)}
                      onClick={() => setSubcategory(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </aside>
            </div>
          ) : visibleMarkets.length > 0 ? (
            <MarketGrid
              markets={visibleMarkets}
              columns={3}
              watchedMarketIds={watchedMarketIds}
              onToggleWatchlist={toggleWatchlist}
            />
          ) : (
            emptyState
          )}
          {hasNext && subcategory === null && (
            <div className={LOAD_MORE_CLASS}>
              <Button
                variant="secondary"
                size="lg"
                className="px-7"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? t("LOADING") : t("LOAD_MORE_MARKETS")}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
