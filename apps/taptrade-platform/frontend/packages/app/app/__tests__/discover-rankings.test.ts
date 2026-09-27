import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  DiscoveryResponse,
  PredictionMarket,
} from "@taptrade-ui/api-client/src/prediction-types";
import {
  buildDiscoverRankings,
  DISCOVER_RANKING_LIMIT,
  DISCOVER_RANKING_SECTIONS,
} from "../components/prediction/discover-rankings";
import type { MarketMovement } from "../components/prediction/market-movement";

function market(
  id: string,
  overrides: Partial<PredictionMarket> = {},
): PredictionMarket {
  return {
    id,
    eventId: `event-${id}`,
    categoryId: "world",
    ticker: `MARKET-${id}`,
    title: `Will market ${id} resolve YES?`,
    status: "open",
    yesPricePoints: 50,
    noPricePoints: 50,
    volumePoints: 100,
    openInterestPoints: 0,
    liquidityPoints: 0,
    settlementSourceKey: "manual",
    settlementRule: "manual_attestation",
    feeRateBps: 0,
    closeAt: "2027-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const movement = (deltaPoints: number): MarketMovement => ({
  deltaPoints,
  pct: Math.abs(deltaPoints),
  direction: deltaPoints > 0 ? "up" : "down",
  values: [50, 50 + deltaPoints],
});

describe("Discover rankings", () => {
  it("keeps the seven TapTrade ranking tabs, their labels, and View All paths", () => {
    assert.equal(DISCOVER_RANKING_LIMIT, 10);
    assert.deepEqual(
      DISCOVER_RANKING_SECTIONS.map((section) => section.key),
      [
        "trending",
        "active",
        "discussed",
        "yes",
        "no",
        "gainers",
        "decliners",
      ],
    );
    assert.deepEqual(
      DISCOVER_RANKING_SECTIONS.map((section) => section.heading),
      [
        "Trending",
        "Most Active",
        "Most Discussed",
        "Most Yes-Leaning",
        "Most No-Leaning",
        "24h YES Gainers",
        "24h YES Decliners",
      ],
    );
    assert.ok(
      DISCOVER_RANKING_SECTIONS.every(
        (section) => section.viewAllHref === "/predict",
      ),
    );
    assert.ok(
      DISCOVER_RANKING_SECTIONS.every(
        (section) => !/stocktwits|watchers|stocks/i.test(section.heading),
      ),
    );
  });

  it("keeps a truthful ten-market cap without padding a short trending list", () => {
    const trending = Array.from({ length: 12 }, (_, index) =>
      market(`trending-${index + 1}`, {
        categoryId: index < 2 ? "world" : "sports",
        volumePoints: 1_000 - index,
      }),
    );
    const input = {
      discovery: {
        featured: [],
        trending,
        closingSoon: [],
        recent: [],
      },
      catalog: [],
      movements: {},
    } satisfies Parameters<typeof buildDiscoverRankings>[0];
    const rankings = buildDiscoverRankings(input);
    const trendingRanking = rankings.find(
      (ranking) => ranking.key === "trending",
    );
    const worldTrending = buildDiscoverRankings({
      ...input,
      categoryId: "world",
    }).find((ranking) => ranking.key === "trending");

    assert.equal(trendingRanking?.markets.length, 10);
    assert.deepEqual(
      trendingRanking?.markets.map((entry) => entry.id),
      trending.slice(0, 10).map((entry) => entry.id),
    );
    assert.deepEqual(
      worldTrending?.markets.map((entry) => entry.id),
      trending.slice(0, 2).map((entry) => entry.id),
    );
  });

  it("gives every category its own truthful ranking source", () => {
    const trending = market("trending", { volumePoints: 200 });
    const active = market("active", { volumePoints: 900 });
    const discussed = market("discussed", { commentCount: 12 });
    const yes = market("yes", { yesPricePoints: 82, noPricePoints: 18 });
    const no = market("no", { yesPricePoints: 13, noPricePoints: 87 });
    const gain = market("gain", { yesPricePoints: 60, noPricePoints: 40 });
    const decline = market("decline", {
      yesPricePoints: 40,
      noPricePoints: 60,
    });
    const discovery: DiscoveryResponse = {
      featured: [],
      trending: [trending],
      closingSoon: [],
      recent: [],
    };

    const rankings = buildDiscoverRankings({
      discovery,
      catalog: [active, discussed, yes, no, gain, decline],
      movements: {
        [gain.id]: movement(18),
        [decline.id]: movement(-14),
      },
      limit: 1,
    });
    const first = (key: string) =>
      rankings.find((ranking) => ranking.key === key)?.markets[0]?.id;

    assert.equal(first("trending"), trending.id);
    assert.equal(first("active"), active.id);
    assert.equal(first("discussed"), discussed.id);
    assert.equal(first("yes"), yes.id);
    assert.equal(first("no"), no.id);
    assert.equal(first("gainers"), gain.id);
    assert.equal(first("decliners"), decline.id);
  });

  it("retains catalog discussion data when a market also appears in discovery", () => {
    const discoveryMarket = market("shared");
    const catalogMarket = market("shared", { commentCount: 7 });
    const rankings = buildDiscoverRankings({
      discovery: {
        featured: [],
        trending: [discoveryMarket],
        closingSoon: [],
        recent: [],
      },
      catalog: [catalogMarket],
      movements: {},
    });
    const discussed = rankings.find((ranking) => ranking.key === "discussed");

    assert.equal(discussed?.markets[0]?.id, catalogMarket.id);
    assert.equal(discussed?.markets[0]?.commentCount, 7);
  });

  it("keeps a selected market category isolated across all seven lists", () => {
    const world = market("world", { categoryId: "world", commentCount: 2 });
    const sports = market("sports", {
      categoryId: "sports",
      commentCount: 8,
      volumePoints: 800,
    });
    const rankings = buildDiscoverRankings({
      discovery: {
        featured: [],
        trending: [world, sports],
        closingSoon: [],
        recent: [],
      },
      catalog: [world, sports],
      movements: {
        [world.id]: movement(4),
        [sports.id]: movement(-7),
      },
      categoryId: "world",
    });

    for (const ranking of rankings) {
      assert.ok(
        ranking.markets.every((market) => market.categoryId === "world"),
        `${ranking.key} should contain only the selected category`,
      );
    }
  });
});
