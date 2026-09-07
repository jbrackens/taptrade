/**
 * The ranked groups on /discover deliberately stay client-side.
 *
 * The public discovery endpoint provides only editorial buckets while the
 * market catalog provides the broader activity and discussion corpus. Keeping
 * these rules here makes the relationship between a visible ranking and its
 * real source explicit, and prevents the Discover page from drifting back to
 * a single generic feed.
 */

import type {
  DiscoveryResponse,
  PredictionMarket,
} from "@taptrade-ui/api-client/src/prediction-types";
import { dedupeMarkets, normalizePriceShares } from "./market-display";
import type { MarketMovement } from "./market-movement";

export const DISCOVER_RANKING_LIMIT = 10;

export type DiscoverRankingKey =
  | "trending"
  | "active"
  | "discussed"
  | "yes"
  | "no"
  | "gainers"
  | "decliners";

export type DiscoverRankingLead =
  | "movement"
  | "volume"
  | "discussion"
  | "yes"
  | "no";

export interface DiscoverRankingSection {
  key: DiscoverRankingKey;
  heading: string;
  description: string;
  empty: string;
  lead: DiscoverRankingLead;
  viewAllHref: string;
}

export interface DiscoverRanking extends DiscoverRankingSection {
  markets: PredictionMarket[];
}

/**
 * Seven prediction-market rankings, adapted from the sportsbook-era
 * sentiment board. "Most discussed" is intentionally used instead of a
 * fabricated watcher count, and price movers use only the real 24h series.
 */
export const DISCOVER_RANKING_SECTIONS: readonly DiscoverRankingSection[] = [
  {
    key: "trending",
    heading: "Trending",
    description: "Markets drawing the strongest activity right now.",
    empty: "Nothing is trending yet. Activity will surface markets here.",
    lead: "volume",
    viewAllHref: "/predict",
  },
  {
    key: "active",
    heading: "Most Active",
    description: "Ranked by total traded volume.",
    empty: "No active markets are available right now.",
    lead: "volume",
    viewAllHref: "/predict",
  },
  {
    key: "discussed",
    heading: "Most Discussed",
    description: "Markets with the largest live discussion.",
    empty: "Discussion activity is not available yet.",
    lead: "discussion",
    viewAllHref: "/predict",
  },
  {
    key: "yes",
    heading: "Most Yes-Leaning",
    description: "Ranked by the market's current YES price.",
    empty: "No open markets are available for this ranking.",
    lead: "yes",
    viewAllHref: "/predict",
  },
  {
    key: "no",
    heading: "Most No-Leaning",
    description: "Ranked by the market's current NO price.",
    empty: "No open markets are available for this ranking.",
    lead: "no",
    viewAllHref: "/predict",
  },
  {
    key: "gainers",
    heading: "24h YES Gainers",
    description: "Largest verified increases in YES price over 24 hours.",
    empty: "No verified YES-price gains are available yet.",
    lead: "movement",
    viewAllHref: "/predict",
  },
  {
    key: "decliners",
    heading: "24h YES Decliners",
    description: "Largest verified decreases in YES price over 24 hours.",
    empty: "No verified YES-price declines are available yet.",
    lead: "movement",
    viewAllHref: "/predict",
  },
];

export function marketKey(market: PredictionMarket): string {
  return market.id || market.ticker;
}

export function marketShares(market: PredictionMarket): {
  yesShare: number;
  noShare: number;
} {
  return normalizePriceShares(market.yesPricePoints, market.noPricePoints);
}

function byVolume(a: PredictionMarket, b: PredictionMarket): number {
  return b.volumePoints - a.volumePoints;
}

function byYesShare(a: PredictionMarket, b: PredictionMarket): number {
  const difference = marketShares(b).yesShare - marketShares(a).yesShare;
  return difference || byVolume(a, b);
}

function byNoShare(a: PredictionMarket, b: PredictionMarket): number {
  const difference = marketShares(b).noShare - marketShares(a).noShare;
  return difference || byVolume(a, b);
}

function byDiscussion(a: PredictionMarket, b: PredictionMarket): number {
  const difference = (b.commentCount ?? 0) - (a.commentCount ?? 0);
  return difference || byVolume(a, b);
}

function movementFor(
  market: PredictionMarket,
  movements: Readonly<Record<string, MarketMovement | null>>,
): MarketMovement | null {
  return movements[marketKey(market)] ?? null;
}

function byMovement(
  movements: Readonly<Record<string, MarketMovement | null>>,
  direction: "up" | "down",
) {
  return (a: PredictionMarket, b: PredictionMarket) => {
    const aDelta = movementFor(a, movements)?.deltaPoints ?? 0;
    const bDelta = movementFor(b, movements)?.deltaPoints ?? 0;
    const difference =
      direction === "up" ? bDelta - aDelta : aDelta - bDelta;
    return difference || byVolume(a, b);
  };
}

function selectMarkets(
  key: DiscoverRankingKey,
  trending: PredictionMarket[],
  pool: PredictionMarket[],
  movements: Readonly<Record<string, MarketMovement | null>>,
): PredictionMarket[] {
  switch (key) {
    case "trending":
      return trending;
    case "active":
      return [...pool].sort(byVolume);
    case "discussed":
      return pool
        .filter((market) => market.commentCount != null)
        .sort(byDiscussion);
    case "yes":
      return [...pool].sort(byYesShare);
    case "no":
      return [...pool].sort(byNoShare);
    case "gainers":
      return pool
        .filter((market) => (movementFor(market, movements)?.deltaPoints ?? 0) > 0)
        .sort(byMovement(movements, "up"));
    case "decliners":
      return pool
        .filter((market) => (movementFor(market, movements)?.deltaPoints ?? 0) < 0)
        .sort(byMovement(movements, "down"));
  }
}

export function buildDiscoverRankings({
  discovery,
  catalog,
  movements,
  categoryId,
  limit = DISCOVER_RANKING_LIMIT,
}: {
  discovery: DiscoveryResponse;
  catalog: PredictionMarket[];
  movements: Readonly<Record<string, MarketMovement | null>>;
  categoryId?: string;
  limit?: number;
}): DiscoverRanking[] {
  const belongsToCategory = (market: PredictionMarket) =>
    !categoryId || market.categoryId === categoryId;
  const trending = discovery.trending.filter(belongsToCategory);
  const pool = dedupeMarkets([
    // ListMarkets carries user-facing discussion counts, while discovery
    // buckets intentionally do not. Put the catalog first so a duplicated
    // market retains its public activity fields instead of losing them.
    ...catalog.filter(belongsToCategory),
    ...discovery.featured,
    ...trending,
    ...discovery.closingSoon.filter(belongsToCategory),
  ]);

  return DISCOVER_RANKING_SECTIONS.map((section) => ({
    ...section,
    markets: selectMarkets(section.key, trending, pool, movements).slice(
      0,
      limit,
    ),
  }));
}
