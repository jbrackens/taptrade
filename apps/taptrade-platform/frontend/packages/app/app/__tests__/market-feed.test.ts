/**
 * Ink & lime step 10 — commentCount (§3-09) + the feed used by discovery,
 * plus the two i18n cleanups. Available Markets uses the restored grid.
 *
 * Source-level assertions (repo convention — node:test, no DOM harness):
 *  - the gateway stitches commentCount onto user-facing ListMarkets only
 *    (worker sweeps use Sort:"id" and keep their cheap shape)
 *  - discovery draws NO hand-made sparkline and invents no deltas: the
 *    only price history is the featured market's real MarketChart; cards
 *    lean on the live price only
 *  - commentCount is trusted only when the API sent it
 *  - cards carry the watchlist bookmark wherever the host wires watchlist
 *    state (the single-column MarketFeed was retired 2026-09-24)
 *  - movement derivation lives in one module that /discover imports
 *  - de/ is retired; SELL_SHARES_HOLD_CTA uses native i18next plurals
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(resolve(appRoot, rel), "utf-8");
}

const card = read("components/prediction/MarketCard.tsx");
const featured = read("components/prediction/FeaturedMarket.tsx");
const rankings = read("components/prediction/discover-rankings.ts");
const section = read("components/prediction/AllMarketsSection.tsx");
const grid = read("components/prediction/MarketGrid.tsx");
const sqlRepo = readFileSync(
  resolve(
    appRoot,
    "../../../../go-platform/services/gateway/internal/prediction/sql_repository.go",
  ),
  "utf-8",
);
const goTypes = readFileSync(
  resolve(
    appRoot,
    "../../../../go-platform/services/gateway/internal/prediction/types.go",
  ),
  "utf-8",
);
const apiTypes = readFileSync(
  resolve(appRoot, "../../api-client/src/prediction-types.ts"),
  "utf-8",
);

describe("§3-09 commentCount (step 10)", () => {
  it("stitches counts onto user-facing list responses only", () => {
    assert.match(
      sqlRepo,
      /strings\.TrimSpace\(filter\.Sort\) != "id"/,
      "worker sweeps (Sort:\"id\") keep their cheap shape",
    );
    assert.match(
      sqlRepo,
      /prediction_market_comments\s*\n?\s*WHERE market_id = ANY\(\$1\) GROUP BY market_id/,
      "one batched, index-backed GROUP BY over the page ids",
    );
    assert.match(goTypes, /CommentCount int `json:"commentCount,omitempty" db:"-"`/);
  });

  it("exposes the field as unknown-when-absent on the client", () => {
    assert.match(apiTypes, /commentCount\?: number/);
    assert.match(
      rankings,
      /\.filter\(\(market\) => market\.commentCount != null\)/,
      "the discussion ranking trusts the count only when the API sent it",
    );
  });

  it("survives BOTH wire whitelists — the field vanished twice during implementation", () => {
    // The gateway's Market.MarshalJSON and the api-client's
    // normalizePredictionMarket are each explicit field lists; a struct
    // tag or interface field alone never reaches the UI.
    assert.match(goTypes, /CommentCount:\s+m\.CommentCount,/);
    const client = readFileSync(
      resolve(appRoot, "../../api-client/src/prediction-client.ts"),
      "utf-8",
    );
    assert.match(
      client,
      /commentCount:\s*\n?\s*typeof row\.commentCount === "number" \? row\.commentCount : undefined/,
    );
  });
});

describe("Markets grid and discovery feed", () => {
  it("renders Available Markets in a nine-card, responsive grid", () => {
    assert.match(section, /const PAGE_SIZE = 9/);
    assert.equal(
      (section.match(/pageSize: PAGE_SIZE/g) ?? []).length,
      2,
      "the initial request and each Load More request should use the nine-card batch size",
    );
    assert.match(
      section,
      /setMarkets\(\(prev\) => \[\.\.\.prev, \.\.\.next\]\)/,
      "Load More should append the next batch to the existing grid",
    );
    assert.match(section, /<MarketGrid[\s\S]*columns=\{3\}/);
    // The 2026-09-24 redesign moved the 3→2 column breakpoint from 1120px
    // to 1020px (MarketGrid's GRID_CLASS_BY_COLUMNS).
    assert.match(
      grid,
      /grid-cols-3[\s\S]*max-\[1020px\]:grid-cols-2[\s\S]*max-\[640px\]:grid-cols-1/,
      "the restored grid should retain its desktop, tablet, and mobile columns",
    );
    assert.ok(
      !section.includes("<MarketFeed"),
      "Available Markets should not fall back to the single-column feed",
    );
  });

  it("draws no sparkline and invents no deltas", () => {
    for (const src of [card, featured]) {
      assert.ok(
        !src.includes("<svg"),
        "no hand-drawn chart markup (icons are phosphor components)",
      );
      assert.doesNotMatch(src, /getMarketPriceHistory|market-movement/);
    }
    assert.equal(
      (featured.match(/<MarketChart\b/g) ?? []).length,
      1,
      "exactly one real price history on the board — the featured market's chart",
    );
  });

  it("keeps the activity meta row: volume in points", () => {
    assert.match(card, /formatCompactPoints\(volumePoints\)/);
    assert.match(card, /t\("VOL_SHORT", "vol"\)/);
  });

  it("keeps the watchlist bookmark on cards when the host wires it", () => {
    assert.match(card, /\{onToggleWatchlist && \(/);
    assert.match(card, /aria-pressed=\{watched\}/);
    assert.match(card, /ADD_TO_WATCHLIST/);
    assert.match(card, /onClick=\{\(\) => onToggleWatchlist\(marketId\)\}/);
  });

  it("ships a nine-card skeleton that matches the real grid", () => {
    assert.match(section, /function MarketCardSkeleton/);
    assert.match(section, /Array\.from\(\{ length: PAGE_SIZE \}/);
  });

  it("keeps movement derivation in one shared module", () => {
    const discover = read("discover/page.tsx");
    assert.match(discover, /from "\.\.\/components\/prediction\/market-movement"/);
    assert.match(rankings, /from "\.\/market-movement"/);
  });
});

describe("i18n cleanups (step 10)", () => {
  const LOCALES = ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"];

  it("retires the de locale directory", () => {
    assert.ok(
      !existsSync(resolve(appRoot, "../public/static/locales/de")),
      "de carried only legacy sportsbook namespaces and was never registered",
    );
  });

  it("ships the share strings in every locale", () => {
    for (const locale of LOCALES) {
      const dict = JSON.parse(
        read(`../public/static/locales/${locale}/prediction.json`),
      ) as Record<string, string>;
      for (const key of ["SHARE_MARKET", "SHARE_COPIED", "SHARE_FAILED"]) {
        assert.ok(dict[key], `${locale}: ${key} missing`);
      }
    }
  });

  it("uses native plural interpolation in the sell CTA call site", () => {
    const ticket = read("components/prediction/TradeTicket.tsx");
    assert.match(ticket, /t\("SELL_SHARES_HOLD_CTA", \{\s*\n?\s*count: requestedQuantity/);
    assert.ok(!ticket.includes("plural: requestedQuantity"));
  });
});
