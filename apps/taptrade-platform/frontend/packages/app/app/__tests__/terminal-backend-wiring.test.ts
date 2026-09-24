import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isPredictionTerminalRoute } from "../lib/prediction-terminal";
import { DISCOVER_RANKING_SECTIONS } from "../components/prediction/discover-rankings";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(`${appRoot}${path}`, "utf8");

describe("prediction terminal backend wiring", () => {
  it("routes discovery side actions through the shared ticket with the side preselected", () => {
    const workspace = read("components/prediction/PredictionWorkspace.tsx");
    const card = read("components/prediction/MarketCard.tsx");
    const quickTrade = read("components/prediction/QuickTradePanel.tsx");
    const connectedTicket = read(
      "components/prediction/ConnectedTradeTicket.tsx",
    );

    // No persistent trade rail on the discovery page itself: the ticket
    // only mounts on demand, inside the quick-trade overlay.
    assert.ok(!workspace.includes("<ConnectedTradeTicket"));
    assert.ok(card.includes("onClick={() => quickTrade(side)}"));
    assert.ok(card.includes("?side=${side}"));
    assert.ok(quickTrade.includes("defaultSide={current.side}"));
    assert.ok(!workspace.includes("const reviewHref ="));
    assert.ok(connectedTicket.includes("api.previewOrder"));
    assert.ok(connectedTicket.includes("api.placeOrder"));
    assert.ok(connectedTicket.includes("resolveIdempotencyKey"));
    assert.ok(connectedTicket.includes("api.getPositions"));
    assert.ok(connectedTicket.includes("getBalance"));
  });

  it("mounts the complete Moments market directory on predict", () => {
    const workspace = read("components/prediction/PredictionWorkspace.tsx");
    const catalog = read("components/prediction/AllMarketsSection.tsx");
    const moments = read("components/prediction/MomentMarketsSection.tsx");
    const predictPage = read("predict/page.tsx");
    const categoryTabs = read("components/prediction/CategoryTabs.tsx");
    const topBar = read("components/prediction/TopBar.tsx");

    assert.ok(workspace.includes("<AllMarketsSection"));
    assert.ok(workspace.includes('variant="moments"'));
    assert.ok(catalog.includes("<MomentMarketsSection"));
    assert.ok(moments.includes('id="trending-markets"'));
    assert.ok(moments.includes('id="moments-market-heading"'));
    assert.match(moments, /api\s*\.getMarkets/);
    assert.ok(moments.includes('data-testid="moment-filter-bar"'));
    assert.ok(moments.includes("market-sort-${pill.value}"));
    assert.ok(moments.includes("market-window-${pill.value}"));
    assert.ok(moments.includes("q: query.trim() || undefined"));
    assert.ok(moments.includes("closeBefore: dateWindowToCloseBefore(dateWindow)"));
    assert.ok(moments.includes("sort: sortBy"));
    assert.ok(!moments.includes("DISCOVER_RANKING_SECTIONS"));
    assert.ok(moments.includes("LOAD_MORE_MARKETS"));
    assert.ok(predictPage.includes("useSearchParams"));
    assert.ok(predictPage.includes("activeCategoryId"));
    assert.ok(workspace.includes("activeCategorySlug={activeCategorySlug}"));
    assert.ok(moments.includes("categoryId,"));
    // TerminalCategoryRail (the left discovery rail) was deleted with the
    // redesign; CategoryTabs is the horizontal topic strip that replaced
    // it on /predict, and TopBar keeps the quick link to Portfolio the
    // rail used to carry.
    assert.ok(workspace.includes("<CategoryTabs"));
    assert.ok(categoryTabs.includes('basePath = "/predict"'));
    assert.ok(
      topBar.includes('{ href: "/portfolio", labelKey: "NAV_PORTFOLIO"'),
    );
  });

  it("loads seven in-place discovery ranking tabs and real movement from backend APIs", () => {
    const discover = read("discover/page.tsx");

    assert.ok(discover.includes("api.getDiscovery"));
    assert.ok(discover.includes("api.getMarkets"));
    assert.ok(discover.includes("api.getMarketPriceHistory"));
    assert.ok(discover.includes('"1d"'));
    assert.ok(discover.includes("movementFromHistory"));
    // Honest deltas: a row with no real series renders a dash, never an
    // invented number.
    assert.ok(discover.includes('movement && movement.direction !== "flat"'));
    assert.ok(discover.includes('id="discover-heading"'));
    assert.ok(discover.includes("buildDiscoverRankings"));
    assert.ok(discover.includes("activeRankingKey"));
    assert.ok(discover.includes("setActiveRankingKey"));
    assert.ok(discover.includes('role="tablist"'));
    assert.ok(discover.includes('role="tabpanel"'));
    assert.ok(discover.includes("<RankingBoard"));
    assert.ok(discover.includes("overflow-x-auto"));
    // The old side-by-side ranking grid is gone at every breakpoint: one
    // ranking shows at a time, in a full-width panel below a horizontally
    // scrollable tab row, at the page's standard content width.
    assert.ok(discover.includes("max-w-[1280px]"));
    assert.ok(discover.includes('data-testid="discover-ranking-tabs"'));
    assert.doesNotMatch(
      discover,
      /grid-cols-2 items-start gap-x-8 gap-y-10|max-\[1023px\]:grid-cols-1/,
    );
    assert.equal(DISCOVER_RANKING_SECTIONS.length, 7);
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
    assert.ok(
      DISCOVER_RANKING_SECTIONS.every(
        (section) => section.viewAllHref === "/predict",
      ),
    );
  });

  it("shares the terminal shell across predict and discover", () => {
    const route = read("lib/prediction-terminal.ts");
    const shell = read("components/AppShell.tsx");
    const topBar = read("components/prediction/TopBar.tsx");
    const mobileTabs = read("components/MobileTabBar.tsx");

    assert.ok(route.includes('pathname === "/discover"'));
    assert.ok(route.includes('pathname.startsWith("/market/")'));
    assert.ok(shell.includes("isPredictionTerminalRoute(pathname)"));
    assert.ok(topBar.includes("isPredictionTerminalRoute(pathname)"));
    assert.ok(mobileTabs.includes("isPredictionTerminalRoute(pathname)"));
    assert.ok(topBar.includes('{ href: "/predict", labelKey: "NAV_MARKETS" }'));
    assert.ok(
      topBar.includes('{ href: "/discover", labelKey: "NAV_TRENDING" }'),
    );
    assert.ok(mobileTabs.includes('labelKey: "NAV_TRENDING"'));
    assert.ok(topBar.includes('pathname.startsWith("/market/")'));
  });

  it("routes market detail through the same terminal shell", () => {
    for (const pathname of [
      "/predict",
      "/predict/",
      "/discover",
      "/discover/",
      "/market/IMP-TEST",
      "/market/IMP-TEST/",
    ]) {
      assert.equal(
        isPredictionTerminalRoute(pathname),
        true,
        `${pathname} should use the terminal shell`,
      );
    }

    for (const pathname of [null, "/", "/auth/login", "/portfolio"]) {
      assert.equal(
        isPredictionTerminalRoute(pathname),
        false,
        `${pathname ?? "null"} should keep its existing shell`,
      );
    }

    // TerminalCategoryRail was deleted with the redesign; market detail
    // is now a two-column layout — the market column and a sticky
    // TradeTicket rail (variant="terminal") — with no category rail.
    const marketPage = read("market/[ticker]/page.tsx");
    assert.ok(!marketPage.includes("<TerminalCategoryRail"));
    assert.ok(marketPage.includes("<MarketHead"));
    assert.ok(marketPage.includes('variant="terminal"'));
    assert.match(
      marketPage,
      /grid-cols-\[minmax\(0,1fr\)_400px\][\s\S]*grid-rows-\[auto_1fr\]/,
    );
  });
});
