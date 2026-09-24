import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");
const moments = readFileSync(
  resolve(appRoot, "components/prediction/MomentMarketsSection.tsx"),
  "utf8",
);
const grid = readFileSync(
  resolve(appRoot, "components/prediction/MarketGrid.tsx"),
  "utf8",
);

describe("Predict Moments market directory", () => {
  it("uses the established search, sort, and closing-window filter bar", () => {
    assert.match(moments, /data-testid="moment-filter-bar"/);
    assert.match(moments, /type="search"/);
    assert.match(moments, /SEARCH_MARKETS_PLACEHOLDER/);
    assert.match(moments, /aria-label=\{headerT\("SEARCH_MARKETS"\)\}/);
    assert.match(
      moments,
      /"activity"[\s\S]*"closing_soon"[\s\S]*"newest"/,
    );
    assert.match(moments, /data-testid=\{`market-sort-\$\{pill\.value\}`\}/);
    assert.match(moments, /"all"[\s\S]*"24h"[\s\S]*"7d"[\s\S]*"30d"/);
    assert.match(moments, /label: "1D"[\s\S]*label: "1W"[\s\S]*label: "1M"/);
    assert.match(
      moments,
      /data-testid=\{`market-window-\$\{pill\.value\}`\}/,
    );
    assert.doesNotMatch(moments, /DISCOVER_RANKING_SECTIONS/);
    assert.doesNotMatch(moments, /buildDiscoverRankings/);
  });

  it("keeps a real server-paginated board scoped to every filter", () => {
    // Kilig: 12 per page — the lead moment + two "Happening now" markets
    // take three on the default view, leaving nine grid cards.
    assert.match(moments, /const PAGE_SIZE = 12/);
    assert.match(moments, /const LEAD_COUNT = 3/);
    assert.match(
      moments,
      /const requestParams = useMemo\([\s\S]*categoryId,[\s\S]*closeBefore: dateWindowToCloseBefore\(dateWindow\),[\s\S]*q: query\.trim\(\) \|\| undefined,[\s\S]*sort: sortBy/,
    );
    assert.match(
      moments,
      /getMarkets\(\{ \.\.\.requestParams, page: 1, pageSize: PAGE_SIZE \}\)/,
    );
    assert.match(
      moments,
      /getMarkets\(\{ \.\.\.requestParams, page: page \+ 1, pageSize: PAGE_SIZE \}\)/,
    );
    assert.match(
      moments,
      /setMarkets\(\(current\) =>[\s\S]*dedupeMarkets\(\[\.\.\.current, \.\.\.\(response\.data \|\| \[\]\)\]\)/,
    );
    assert.match(moments, /loadMoreRequestRef\.current \+= 1/);
    assert.match(moments, /loadMoreRequestRef\.current !== requestId/);
  });

  it("leads with a moment and mixes card sizes instead of a uniform wall", () => {
    assert.match(moments, /<LeadMoment/);
    assert.match(moments, /const showLead = !hasFilters && markets\.length >= LEAD_COUNT/);
    assert.match(moments, /<MarketGrid[\s\S]*columns=\{3\}[\s\S]*pattern="mixed"/);
    // One quick-trade panel serves the lead, the stack and the grid.
    assert.match(moments, /<QuickTradePanel target=\{quickTrade\}/);
    assert.match(moments, /onQuickTrade=\{setQuickTrade\}/);
    assert.match(
      grid,
      /grid-cols-3[\s\S]*max-\[1120px\]:grid-cols-2[\s\S]*max-\[640px\]:grid-cols-1/,
    );
    assert.doesNotMatch(moments, /<MarketFeed/);
  });

  it("keeps filter resets and recovery scoped to the selected topic", () => {
    assert.match(moments, /export function MomentMarketsSection\(\{ categoryId \}/);
    assert.match(
      moments,
      /\[categoryId, dateWindow, query, sortBy, reloadNonce\]/,
    );
    assert.match(moments, /\[reloadNonce, requestParams\]/);
    assert.match(moments, /setMarkets\(\[\]\)/);
    assert.match(moments, /setPage\(1\)/);
    assert.match(moments, /setHasNext\(false\)/);
    assert.match(moments, /setQuery\(""\)/);
    assert.match(moments, /setSortBy\("activity"\)/);
    assert.match(moments, /setDateWindow\("all"\)/);
    assert.match(moments, /COULD_NOT_LOAD_MORE_MARKETS/);
    assert.match(moments, /onClick=\{loadMore\}/);
  });
});
