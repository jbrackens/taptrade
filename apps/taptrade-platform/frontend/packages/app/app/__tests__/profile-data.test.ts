/**
 * profile-data — the arithmetic behind the profile page: the settled-result
 * series its chart draws and the value of an open position at today's price.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  Position,
  PredictionMarket,
  SettledPositionResult,
} from "@taptrade-ui/api-client/src/prediction-types";
import {
  positionMark,
  profileInitials,
  seriesForPeriod,
  settledResultSeries,
} from "../components/account/profile-data";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-28T12:00:00Z");

function settled(daysAgo: number, realizedPoints: number): SettledPositionResult {
  return {
    id: `s${daysAgo}`,
    marketId: `m${daysAgo}`,
    side: "yes",
    quantity: 10,
    entryPricePoints: 40,
    exitPricePoints: realizedPoints >= 0 ? 100 : 0,
    realizedPoints,
    settlementPoints: realizedPoints >= 0 ? 1000 : 0,
    paidAt: new Date(NOW - daysAgo * DAY).toISOString(),
  };
}

describe("settledResultSeries", () => {
  it("runs a total oldest first, whatever order the history arrives in", () => {
    const series = settledResultSeries([settled(1, -200), settled(20, 600), settled(3, 100)]);
    assert.deepEqual(
      series.map((p) => p.value),
      [600, 700, 500],
    );
  });

  it("skips rows without a usable timestamp", () => {
    const bad = { ...settled(2, 50), paidAt: "not a date" };
    assert.equal(settledResultSeries([bad, settled(1, 10)]).length, 1);
  });
});

describe("seriesForPeriod", () => {
  const series = settledResultSeries([settled(40, 600), settled(10, 100), settled(2, -300)]);

  it("measures a week from the total entering it", () => {
    const { points, change } = seriesForPeriod(series, "1w", NOW);
    assert.equal(change, -300);
    assert.equal(points[0].value, 700, "starts at the total before the window");
    assert.equal(points[points.length - 1].value, 400);
    assert.equal(points[points.length - 1].at, NOW);
  });

  it("measures all time from zero", () => {
    const { points, change } = seriesForPeriod(series, "all", NOW);
    assert.equal(points[0].value, 0);
    assert.ok(points[0].at < series[0].at, "starts a little before the first settlement");
    assert.equal(change, 400);
  });

  it("stays flat through a quiet period", () => {
    const { points, change } = seriesForPeriod(settledResultSeries([settled(60, 500)]), "1m", NOW);
    assert.equal(change, 0);
    assert.deepEqual(points.map((p) => p.value), [500, 500]);
  });

  it("returns nothing for an empty history", () => {
    assert.deepEqual(seriesForPeriod([], "all", NOW), { points: [], change: 0 });
  });
});

describe("positionMark", () => {
  const position = {
    id: "p1",
    userId: "u1",
    marketId: "m1",
    side: "no",
    quantity: 50,
    avgPricePoints: 30,
    totalCostPoints: 1500,
    realizedPoints: 0,
  } as Position;
  const market = { id: "m1", yesPricePoints: 55, noPricePoints: 45, status: "open" } as PredictionMarket;

  it("values the held side at its current price", () => {
    assert.deepEqual(positionMark(position, market), { price: 45, value: 2250, gain: 750 });
  });

  it("values a voided market at cost", () => {
    assert.deepEqual(positionMark(position, { ...market, status: "voided" }), { value: 1500, gain: 0 });
  });

  it("knows nothing about a market that failed to load", () => {
    assert.deepEqual(positionMark(position, undefined), {});
  });
});

describe("profileInitials", () => {
  it("takes first and last initials, ignoring an email domain", () => {
    assert.equal(profileInitials("Maria Santos"), "MS");
    assert.equal(profileInitials("demo@phoenix.local"), "D");
    assert.equal(profileInitials("juan.dela.cruz"), "JC");
    assert.equal(profileInitials("   "), "?");
  });
});
