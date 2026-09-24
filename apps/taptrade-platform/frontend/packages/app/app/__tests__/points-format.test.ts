import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertIntegerPoints,
  formatCompactPoints,
  formatPoints,
  formatPointsAmount,
  pointsToUsdDisplay,
  toWholePoints,
} from "../lib/points";
import { formatPointDelta } from "../lib/point-ledger";

// Whole-Points unit model (migration 050, 2026-07-07): API integers ARE
// whole Points. app/lib/points.ts is the single Points-display module —
// these tests pin its formatting contract and guard against the ÷100
// per-page formatters that survived the migration.

describe("formatPoints", () => {
  it("renders whole Points with thousands separators and the pts suffix", () => {
    assert.equal(formatPoints(0), "0 pts");
    assert.equal(formatPoints(98), "98 pts");
    assert.equal(formatPoints(1250), "1,250 pts");
    assert.equal(formatPoints(42350), "42,350 pts");
    // Live wallet balance observed on the local gateway (u-1) — the TopBar
    // regression: this used to render "519996.00 pts" via toFixed(2).
    assert.equal(formatPoints(519996), "519,996 pts");
  });

  it("never grows decimals on integers", () => {
    assert.doesNotMatch(formatPoints(98), /\./);
    assert.doesNotMatch(formatPoints(1500742), /\./);
    assert.equal(formatPoints(1500742), "1,500,742 pts");
  });

  it("preserves sign for negative point results", () => {
    // Live leaderboard pnl_weekly entry (bob) — whole Points on the wire.
    assert.equal(formatPoints(-664), "-664 pts");
  });

  it("renders out-of-contract fractional values honestly at 2dp", () => {
    assert.equal(formatPoints(6.5), "6.50 pts");
  });
});

describe("formatPointsAmount", () => {
  it("renders the bare grouped amount for surfaces with their own unit label", () => {
    assert.equal(formatPointsAmount(42350), "42,350");
    assert.equal(formatPointsAmount(15000), "15,000");
    assert.equal(formatPointsAmount(500), "500");
  });
});

describe("formatCompactPoints", () => {
  it("keeps sub-thousand values whole", () => {
    assert.equal(formatCompactPoints(0), "0 pts");
    assert.equal(formatCompactPoints(999), "999 pts");
  });

  it("buckets thousands and millions with .0 trimmed", () => {
    assert.equal(formatCompactPoints(1_000), "1K pts");
    assert.equal(formatCompactPoints(1_234), "1.2K pts");
    assert.equal(formatCompactPoints(1_000_000), "1M pts");
    assert.equal(formatCompactPoints(1_200_000), "1.2M pts");
    assert.equal(formatCompactPoints(3_400_000), "3.4M pts");
  });

  it("clamps negatives to zero (compact stats are gauges, not deltas)", () => {
    assert.equal(formatCompactPoints(-500), "0 pts");
  });

  it("renders IMP-402FD0BF's true volume as 158.6M pts (volume 100x regression)", () => {
    // Real wire value after the gateway fix: GET /api/v1/markets returns
    // volumePoints 158570119 for "Will Egypt win the 2026 FIFA World Cup?"
    // (imported catalog volume 158570118.6712, already whole Points).
    assert.equal(formatCompactPoints(158_570_119), "158.6M pts");
    // The formatter is faithful to its input — the pre-fix wire value
    // (inflated 100× by the retired `im.volume * 100` overlay in the
    // gateway's marketSelectQuery) rendered as 15857M pts. The fix lives
    // in the gateway + migration 052, NOT in a client-side rescale.
    assert.equal(formatCompactPoints(15_857_011_867), "15857M pts");
  });
});

describe("wire guards", () => {
  it("toWholePoints rounds numbers and zeroes everything else", () => {
    assert.equal(toWholePoints(12), 12);
    assert.equal(toWholePoints(12.4), 12);
    assert.equal(toWholePoints(undefined), 0);
    assert.equal(toWholePoints(null), 0);
    assert.equal(toWholePoints("12"), 0);
    assert.equal(toWholePoints(Number.NaN), 0);
    assert.equal(toWholePoints(Number.POSITIVE_INFINITY), 0);
  });

  it("assertIntegerPoints passes integers through and repairs violations", () => {
    assert.equal(assertIntegerPoints(42), 42);
    assert.equal(assertIntegerPoints(0), 0);
    assert.equal(assertIntegerPoints(-7), -7);
    assert.equal(assertIntegerPoints(42.6, "test"), 43);
    assert.equal(assertIntegerPoints(Number.NaN, "test"), 0);
  });
});

describe("delta formatting", () => {
  it("derives sign from the movement type over the absolute amount", () => {
    assert.equal(formatPointDelta({ type: "credit", amount: 25 }), "+25 pts");
    assert.equal(formatPointDelta({ type: "debit", amount: 6 }), "-6 pts");
    // Sign comes from the type even if a wire amount arrives negative.
    assert.equal(formatPointDelta({ type: "debit", amount: -6 }), "-6 pts");
    assert.equal(formatPointDelta({ type: "credit", amount: -25 }), "+25 pts");
  });
});

describe("pointsToUsdDisplay (nominal value, currently unused by any surface)", () => {
  it("converts 1 Point = 1 cent of nominal play value", () => {
    assert.equal(pointsToUsdDisplay(98), "$0.98");
    assert.equal(pointsToUsdDisplay(158_570_119), "$1,585,701.19");
  });
});

// ── Shared-module regression ────────────────────────────────────────────────
// The 2026-07-07 migration left per-page ÷100 formatters behind; the same
// wire values rendered 100× apart between surfaces (TierPill vs /rewards,
// wallet balance vs portfolio summary). Pin every previously-affected
// surface to app/lib/points and keep ÷100 out of them for good.

const SHARED_POINTS_IMPORT = /from ["'](?:\.\.\/)+lib\/points["']/;
// Matches "/100" and "/ 100" but not "/1000" (time math).
const DIVIDE_BY_100 = /\/\s*100(?!\d)/;

const POINTS_SURFACES = [
  "../rewards/page.tsx",
  "../rewards/ActiveBonusesControl.tsx",
  "../components/WageringProgress.tsx",
  "../portfolio/page.tsx",
  "../account/page.tsx",
  "../leaderboards/page.tsx",
  "../components/prediction/OrderBook.tsx",
  "../components/prediction/RecentTrades.tsx",
  "../components/prediction/MarketFeed.tsx",
];

describe("points surfaces use the shared module", () => {
  for (const rel of POINTS_SURFACES) {
    it(`${rel.replace("../", "app/")} imports lib/points and never divides by 100`, () => {
      const source = readFileSync(resolve(__dirname, rel), "utf-8");
      assert.match(source, SHARED_POINTS_IMPORT);
      assert.doesNotMatch(source, DIVIDE_BY_100);
      assert.ok(
        !source.includes("function formatPoints"),
        "local formatPoints implementations are retired — import lib/points",
      );
    });
  }

  it("TopBar renders the balance through ui/PointsFlow, not toFixed", () => {
    // P3: the balance chip animates via PointsFlow, which carries the same
    // whole-Points contract as lib/points (checked below). The ban on
    // toFixed/÷100/local formatters is unchanged.
    const source = readFileSync(
      resolve(__dirname, "../components/prediction/TopBar.tsx"),
      "utf-8",
    );
    assert.ok(!source.includes("balance.toFixed"));
    assert.doesNotMatch(source, DIVIDE_BY_100);
    assert.ok(
      !source.includes("function formatPoints"),
      "local formatPoints implementations are retired",
    );
    assert.ok(source.includes("<PointsFlow value={balance}"));
  });

  it("PointsFlow pins the whole-Points unit model", () => {
    const source = readFileSync(
      resolve(__dirname, "../components/ui/PointsFlow.tsx"),
      "utf-8",
    );
    assert.ok(source.includes("Math.round(value)"));
    assert.ok(source.includes("maximumFractionDigits: 0"));
    assert.ok(source.includes('locales="en-US"'));
    assert.doesNotMatch(source, DIVIDE_BY_100);
  });
});
