"use client";

/**
 * DiscoverPage — "What's moving right now" (Ink & lime step 5,
 * Discover.dc.html 14a/14b).
 *
 * Structure: a single ranked board with seven in-place tabs. Each tab uses a
 * distinct, truthful source for activity, discussion, conviction, or verified
 * 24-hour price movement, without turning the page into seven small panels.
 *
 * The movement pipeline is honest by construction: deltas come only from
 * the real /prices series (rows show "—" while loading or when history
 * is missing — never an invented number).
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Category,
  DiscoveryResponse,
  PredictionMarket,
} from "@taptrade-ui/api-client/src/prediction-types";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import TapDot from "../components/TapDot";
import { Button, Card } from "../components/ui";
import { localizedMarket } from "../components/prediction/market-content";
import {
  buildDiscoverRankings,
  marketKey,
  marketShares,
  type DiscoverRanking,
  type DiscoverRankingKey,
  type DiscoverRankingLead,
} from "../components/prediction/discover-rankings";
import { dedupeMarkets } from "../components/prediction/market-display";
import { CategoryTabs } from "../components/prediction/CategoryTabs";
import { MarketThumb } from "../components/prediction/MarketThumb";
// Step 10: movement derivation shared with the /predict feed —
// extracted so the two surfaces can't drift on honesty rules.
import {
  movementFromHistory,
  type MarketMovement,
} from "../components/prediction/market-movement";
import { logger } from "../lib/logger";
import { formatCompactPoints } from "../lib/points";

const api = createPredictionClient();
const HISTORY_FETCH_CONCURRENCY = 4;
const CATALOG_RANKING_SIZE = 100;
const HISTORY_CANDIDATE_LIMIT = 100;
const LAUNCH_CATEGORY_SLUGS = new Set([
  "sports",
  "politics",
  "entertainment",
  "economics",
  "tech",
  "technology",
]);

// Phosphor "warning-circle-fill", copied VERBATIM from
// design_handoff_taptrade/logos/phosphor-paths.json (MIT; filled 256 grid).
const PHOSPHOR_WARNING_CIRCLE_FILL =
  "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-8,56a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm8,104a12,12,0,1,1,12-12A12,12,0,0,1,128,184Z";

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/** "12d" / "5h 12m" / "42m" — the closing-soon lead fact. */
function timeRemaining(closeAt: string): { label: string; urgent: boolean } {
  const deltaMs = new Date(closeAt).getTime() - Date.now();
  if (!Number.isFinite(deltaMs) || deltaMs <= 0)
    return { label: "—", urgent: false };
  const totalMin = Math.floor(deltaMs / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const urgent = deltaMs < 24 * 60 * 60 * 1000;
  if (days > 0) return { label: `${days}d ${hours}h`, urgent };
  if (hours > 0) return { label: `${hours}h ${mins}m`, urgent };
  return { label: `${mins}m`, urgent };
}

function MarketThumbnail({ market }: { market: PredictionMarket }) {
  return (
    <MarketThumb
      categorySlug={market.categorySlug}
      imageUrl={market.imagePath || market.imageUrl || market.image_url}
      size={40}
    />
  );
}

function RankingMetric({
  market,
  movement,
  lead,
}: {
  market: PredictionMarket;
  movement?: MarketMovement | null;
  lead: DiscoverRankingLead;
}) {
  const { yesShare, noShare } = marketShares(market);

  let value = "—";
  let label = "";
  // Soft YES/NO chip when the metric is a market-direction number; plain
  // mono text for neutral counts (volume, discussion).
  let chip: "yes" | "no" | null = null;

  switch (lead) {
    case "volume":
      value = formatCompactPoints(market.volumePoints);
      label = "volume";
      break;
    case "discussion":
      value = `${market.commentCount ?? 0}`;
      label = market.commentCount === 1 ? "comment" : "comments";
      break;
    case "yes":
      value = `${Math.round(yesShare)} pts`;
      label = "YES";
      chip = "yes";
      break;
    case "no":
      value = `${Math.round(noShare)} pts`;
      label = "NO";
      chip = "no";
      break;
    case "movement":
      if (movement && movement.direction !== "flat") {
        const up = movement.direction === "up";
        value = `${up ? "+" : "−"}${Math.abs(movement.deltaPoints)} pts`;
        label = "24h YES";
        chip = up ? "yes" : "no";
      } else {
        label = "24h YES";
      }
      break;
  }

  return (
    <div className="flex-none text-right">
      {chip ? (
        <span
          className={`inline-flex items-center justify-end rounded-[var(--r-rh-sm)] px-2 py-1 font-mono text-[13px] font-semibold tabular-nums ${
            chip === "yes"
              ? "bg-[var(--yes-soft)] text-[var(--yes-text)]"
              : "bg-[var(--no-soft)] text-[var(--no-text)]"
          }`}
 >
 {value}
 </span>
 ) : (
 <span className="block text-[15px] font-semibold leading-[1.15] tabular-nums text-[var(--t3)]">
 {value}
 </span>
 )}
 <span className="mt-1 block text-[12px] font-medium text-[var(--t3)]">
 {label}
 </span>
 </div>
 );
}

function rankingMetricHeading(lead: DiscoverRankingLead): string {
 switch (lead) {
 case "volume":
 return "Volume";
 case "discussion":
 return "Discussion";
 case "yes":
 return "YES price";
 case "no":
 return "NO price";
 case "movement":
 return "24h YES";
 }
}

function RankingRow({
 market,
 rank,
 movement,
 lead,
}: {
 market: PredictionMarket;
 rank: number;
 movement?: MarketMovement | null;
 lead: DiscoverRankingLead;
}) {
 const { t } = useTranslation("prediction");
 const remaining = timeRemaining(market.closeAt);

 return (
 <Link
 href={`/market/${market.ticker}`}
 className="group relative block border-b border-[var(--border-1)] bg-[var(--surface-1)] no-underline transition-colors duration-150 last:border-b-0 hover:bg-[var(--surface-2)] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] active:bg-[var(--accent-soft)]"
 >
 <article className="grid grid-cols-[42px_minmax(0,1fr)_132px_116px] items-center gap-4 px-5 py-4 max-[860px]:grid-cols-[34px_minmax(0,1fr)_118px] max-[860px]:gap-3 max-[640px]:grid-cols-[28px_minmax(0,1fr)_82px] max-[640px]:px-3.5 max-[640px]:py-3.5">
 <span className="font-mono text-[12px] font-semibold text-[var(--t3)] tabular-nums">
 {String(rank).padStart(2, "0")}
 </span>
 <div className="flex min-w-0 items-start gap-2.5">
 <MarketThumbnail market={market} />
 <div className="min-w-0 flex-1">
 <div className="font-mono text-[12px] font-semibold text-[var(--t3)]">
 <span>{market.categoryName || market.categorySlug || "Market"}</span>
 </div>
 <h3 className="m-0 mt-1 line-clamp-2 text-[16px] font-medium leading-[1.35] tracking-[-0.012em] text-[var(--t1)] group-hover:underline">
 {market.title}
 </h3>
 <span
 className={`mt-1 hidden font-mono text-[10.5px] font-medium tabular-nums max-[860px]:block ${
                remaining.urgent ? "text-[var(--live-text)]" : "text-[var(--t3)]"
              }`}
 >
 {t("CLOSES_IN_SHORT", { time: remaining.label, defaultValue: `Closes in ${remaining.label}` })}
 </span>
 </div>
 </div>
 <RankingMetric market={market} movement={movement} lead={lead} />
 <div className="text-right max-[860px]:hidden">
 <span className="block text-[12px] font-semibold text-[var(--t3)]">
 {t("CLOSES_IN_LABEL", "Closes in")}
 </span>
 <span
 className={`mt-1 block font-mono text-[13px] font-semibold tabular-nums ${
              remaining.urgent ? "text-[var(--live-text)]" : "text-[var(--t1)]"
            }`}
          >
            {remaining.label}
          </span>
        </div>
      </article>
    </Link>
  );
}

function SectionEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="m-0 text-[13px] leading-[1.55] text-[var(--t2)]">
        {children}
      </p>
    </div>
  );
}

function RankingBoard({
  ranking,
  movements,
  viewAllLabel,
  loadingMovement,
}: {
  ranking: DiscoverRanking;
  movements: Readonly<Record<string, MarketMovement | null>>;
  viewAllLabel: string;
  loadingMovement: boolean;
}) {
  const tabId = `discover-ranking-tab-${ranking.key}`;
  const isMovementRanking =
    ranking.key === "gainers" || ranking.key === "decliners";

  return (
    <section
      data-testid={`discover-ranking-${ranking.key}`}
      id="discover-ranking-panel"
      role="tabpanel"
      aria-labelledby={tabId}
    >
      <div className="overflow-hidden rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)]">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border-1)] px-5 py-3.5 max-[640px]:px-3.5">
          <span className="font-mono text-[11px] font-medium tabular-nums text-[var(--t3)]">
            {ranking.markets.length} ranked market
            {ranking.markets.length === 1 ? "" : "s"}
          </span>
          <Link
            href={ranking.viewAllHref}
            aria-label={`${viewAllLabel} ${ranking.heading} markets`}
 className="inline-flex min-h-9 shrink-0 items-center text-[13px] font-semibold text-[var(--t2)] no-underline transition-colors hover:text-[var(--t1)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]"
 >
 {viewAllLabel}
 </Link>
 </div>
 <div
 className="grid grid-cols-[42px_minmax(0,1fr)_132px_116px] items-center gap-4 border-b border-[var(--border-1)] px-5 py-2.5 text-[12px] font-semibold text-[var(--t3)] max-[860px]:hidden"
 aria-hidden="true"
 >
 <span>Rank</span>
 <span>Market</span>
 <span className="text-right">{rankingMetricHeading(ranking.lead)}</span>
 <span className="text-right">Closes</span>
 </div>
 {loadingMovement && isMovementRanking ? (
 <SectionEmpty>Updating verified 24-hour YES movement…</SectionEmpty>
 ) : ranking.markets.length === 0 ? (
 <SectionEmpty>{ranking.empty}</SectionEmpty>
 ) : (
 <ol className="m-0 list-none p-0">
 {ranking.markets.map((market, index) => (
 <li key={marketKey(market)}>
 <RankingRow
 market={market}
 rank={index + 1}
 movement={movements[marketKey(market)]}
 lead={ranking.lead}
 />
 </li>
 ))}
 </ol>
 )}
 </div>
 </section>
 );
}

export default function DiscoverPage() {
 const { t } = useTranslation("prediction");
 const { t: contentT } = useTranslation("market-content");
 const searchParams = useSearchParams();
 const activeCategorySlug = (
 searchParams?.get("category") || ""
 ).toLowerCase();
 const [categories, setCategories] = useState<Category[]>([]);
 const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
 const [catalog, setCatalog] = useState<PredictionMarket[]>([]);
 const [movements, setMovements] = useState<
 Record<string, MarketMovement | null>
 >({});
 const [activeRankingKey, setActiveRankingKey] =
 useState<DiscoverRankingKey>("trending");
 const [loadingMovements, setLoadingMovements] = useState(false);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [reloadNonce, setReloadNonce] = useState(0);

 const visibleCategories = useMemo(
 () =>
 categories
 .filter((category) =>
 LAUNCH_CATEGORY_SLUGS.has(category.slug.toLowerCase()),
 )
 .sort((a, b) => a.sortOrder - b.sortOrder),
 [categories],
 );
 const activeCategory = visibleCategories.find(
 (category) => category.slug.toLowerCase() === activeCategorySlug,
 );

 // biome-ignore lint/correctness/useExhaustiveDependencies: reloadNonce is the retry signal — an intentional extra dependency
 useEffect(() => {
 let cancelled = false;
 setLoading(true);
 setError(null);
 Promise.all([
 api.getDiscovery(),
 api.getCategories(),
 api.getMarkets({
 status: "open",
 sort: "activity",
 page: 1,
 pageSize: CATALOG_RANKING_SIZE,
 }),
 ])
 .then(([nextDiscovery, nextCategories, nextCatalog]) => {
 if (cancelled) return;
 setDiscovery(nextDiscovery);
 setCategories(nextCategories);
 setCatalog(nextCatalog.data);
 })
 .catch((err: unknown) => {
 logger.error("Discover", "discovery load failed", err);
 if (!cancelled) {
 setError(err instanceof Error ? err.message : String(err));
 }
 })
 .finally(() => {
 if (!cancelled) setLoading(false);
 });
 return () => {
 cancelled = true;
 };
 }, [reloadNonce]);

 const activeCategoryId = activeCategory?.id;
 const historyCandidates = useMemo(() => {
 if (!discovery) return [];
 return dedupeMarkets([
 ...catalog,
 ...discovery.featured,
 ...discovery.trending,
 ...discovery.closingSoon,
 ])
 .filter(
 (market) =>
 !activeCategoryId || market.categoryId === activeCategoryId,
 )
 .slice(0, HISTORY_CANDIDATE_LIMIT);
 }, [activeCategoryId, catalog, discovery]);

 // Gainers and decliners are derived only from the real 1d price series.
 // The bounded concurrency keeps a seven-list page from flooding the API.
 useEffect(() => {
 if (historyCandidates.length === 0) {
 setMovements({});
 setLoadingMovements(false);
 return;
 }
 let cancelled = false;
 setMovements({});
 setLoadingMovements(true);
 void mapWithConcurrency(
 historyCandidates,
 HISTORY_FETCH_CONCURRENCY,
 async (market) => {
 try {
 const history = await api.getMarketPriceHistory(market.id, "1d");
 return [marketKey(market), movementFromHistory(history)] as const;
 } catch {
 return [marketKey(market), null] as const;
 }
 },
 )
 .then((entries) => {
 if (!cancelled) setMovements(Object.fromEntries(entries));
 })
 .finally(() => {
 if (!cancelled) setLoadingMovements(false);
 });
 return () => {
 cancelled = true;
 };
 }, [historyCandidates]);

 const rankings = useMemo(() => {
 if (!discovery) return [];
 return buildDiscoverRankings({
 discovery,
 catalog,
 movements,
 categoryId: activeCategoryId,
 }).map((ranking) => ({
 ...ranking,
 markets: ranking.markets.map((market) =>
 localizedMarket(contentT, market),
 ),
 }));
 }, [activeCategoryId, catalog, contentT, discovery, movements]);
 const activeRanking =
 rankings.find((ranking) => ranking.key === activeRankingKey) ??
 rankings[0];

 if (loading) {
 return (
 <div className="grid min-h-[calc(100vh-64px)] place-items-center bg-[var(--bg-deep)] text-[13px] text-[var(--t3)]">
 <TapDot label={t("DISCOVER_LOADING")} />
 </div>
 );
 }

 return (
 <div className="w-full bg-[var(--paper)]">
 <CategoryTabs
 categories={visibleCategories}
 activeCategorySlug={activeCategory?.slug.toLowerCase()}
 basePath="/discover"
 />

 <section
 className="mx-auto w-full min-w-0 max-w-[1280px] px-6 pb-16 pt-7 max-[760px]:px-4 max-[760px]:py-6"
 aria-labelledby="discover-heading"
 >
 <header>
 <h1
 id="discover-heading"
 className="type-poster m-0 text-[28px] max-[640px]:text-[24px] text-[var(--t1)]"
 >
 {activeRanking?.heading ??
 t("DISCOVER_HEADING", "What's moving right now")}
 </h1>
 <p className="mb-0 mt-2 max-w-[820px] text-[14px] leading-[1.55] text-[var(--t2)]">
 {activeRanking?.description ??
 t(
 "DISCOVER_SUBTITLE",
 "Markets ranked by activity, discussion, conviction, and verified 24-hour YES movement.",
 )}
 </p>
 </header>

 {error ? (
 <Card
 as="div"
 edge="no"
 padding="none"
 className="mt-6 px-[18px] py-4"
 role="alert"
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
 <path d={PHOSPHOR_WARNING_CIRCLE_FILL} />
 </svg>
 <span className="text-sm font-semibold tracking-[-0.005em] text-[var(--t1)]">
 {t("DISCOVER_LOAD_FAILED", "Discovery could not be loaded")}
 </span>
 </div>
 <p className="mb-0 mt-[9px] text-[13px] leading-[1.5] text-[var(--t2)]">
 {error}
 </p>
 <Button
 variant="secondary"
 size="md"
 className="mt-3.5"
 onClick={() => setReloadNonce((value) => value + 1)}
 >
 {t("RETRY", "Retry")}
 </Button>
 </Card>
 ) : activeRanking ? (
 <>
 <div
 className="mt-7 overflow-x-auto pb-1"
 data-testid="discover-ranking-tabs"
 >
 {/* Quiet segmented pills — ink selected state, never pink. */}
 <div
 role="tablist"
 aria-label="Discover rankings"
 className="inline-flex min-w-max gap-1 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] p-[3px]"
 >
 {rankings.map((ranking) => {
 const selected = ranking.key === activeRanking.key;
 return (
 <button
 key={ranking.key}
 id={`discover-ranking-tab-${ranking.key}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls="discover-ranking-panel"
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setActiveRankingKey(ranking.key)}
                      className={`min-h-9 cursor-pointer whitespace-nowrap rounded-[var(--r-rh-sm)] border-0 px-3.5 text-[13px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] ${
                        selected
                          ? "bg-[var(--accent)] text-[var(--ticket-cta-text)]"
                          : "bg-transparent text-[var(--t3)] hover:bg-[var(--surface-2)] hover:text-[var(--t1)]"
                      }`}
                    >
                      {ranking.heading}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-4">
              <RankingBoard
                key={activeRanking.key}
                ranking={activeRanking}
                movements={movements}
                loadingMovement={loadingMovements}
                viewAllLabel={t("VIEW_ALL_MARKETS", "View all")}
              />
            </div>
          </>
        ) : (
          <div className="mt-7 overflow-hidden rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)]">
            <SectionEmpty>
              No discovery rankings are available right now.
            </SectionEmpty>
          </div>
        )}

        <p className="mb-0 mt-8 border-t border-[var(--border-1)] pt-4 text-[11px] leading-[1.5] text-[var(--t3)]">
          {t("MARKET_RISK_FOOTER")}
        </p>
      </section>
    </div>
  );
}
