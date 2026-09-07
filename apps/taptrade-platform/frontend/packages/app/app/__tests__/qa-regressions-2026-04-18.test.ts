/**
 * QA regression tests — 2026-04-18
 *
 * Locks in the fixes found during /qa on localhost after the
 * Pariflow dark-broadcast redesign shipped. Each test maps to a
 * specific bug found via gstack browse.
 *
 * Run: npx tsx --test app/__tests__/qa-regressions-2026-04-18.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(resolve(appRoot, rel), "utf-8");
}

function sliceBetween(
  source: string,
  startToken: string,
  endToken: string,
): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(start, -1, `missing start token ${startToken}`);
  assert.notEqual(end, -1, `missing end token ${endToken}`);
  return source.slice(start, end);
}

function listSourceFiles(rel: string): string[] {
  const root = resolve(appRoot, rel);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      out.push(...listSourceFiles(`${rel}/${entry}`));
      continue;
    }
    if (/\.(ts|tsx|json)$/.test(entry)) {
      out.push(`${rel}/${entry}`);
    }
  }
  return out;
}

// ── Tap Trade safety: user-facing cashier surfaces stay absent ────

describe("points-only safety boundary", () => {
  it("does not ship the user-facing cashier routes", () => {
    for (const rel of [
      "cashier/page.tsx",
      "cashier/cheque/page.tsx",
      "cashier/loading.tsx",
      "cashier/error.tsx",
    ]) {
      assert.equal(
        existsSync(resolve(appRoot, rel)),
        false,
        `${rel} should not exist in the points-only app`,
      );
    }
  });

  it("does not expose prohibited money path segments in app routes", () => {
    const routeFiles = listSourceFiles(".").filter((rel) =>
      /\/(?:page|route)\.tsx?$/.test(rel),
    );
    const prohibitedSegment =
      /(^|\/)(cashier|cashout|crypto|deposit|deposits|fiat|payment|payments|prize|prizes|redeem|redemption|withdraw|withdrawal|withdrawals)(\/|$)/i;
    const offenders = routeFiles.filter((rel) =>
      prohibitedSegment.test(rel.replace(/^\.\//, "")),
    );

    assert.deepEqual(offenders, []);
  });

  it("returns retired money paths as absent before auth redirects", () => {
    const proxySource = read("../proxy.ts");
    const protectedRoutes = sliceBetween(
      proxySource,
      "const PROTECTED_ROUTES = [",
      "];",
    );

    assert.ok(
      proxySource.includes("RETIRED_MONEY_ROUTE_PATTERN") &&
        proxySource.includes("isRetiredMoneyRoute(pathname)") &&
        proxySource.includes('new NextResponse("Not found", { status: 404 })'),
      "proxy should 404 retired money paths before auth redirects",
    );
    assert.ok(
      !protectedRoutes.includes('"/cashier"'),
      "cashier must not stay in auth-protected routes because that creates a live login redirect",
    );
  });

  it("does not ship the old cashier UI components", () => {
    for (const rel of [
      "components/CryptoDepositCard.tsx",
      "components/NonCustodialCashierStatus.tsx",
      "components/DepositThresholdModal.tsx",
      "components/CashierCanaryPanel.tsx",
    ]) {
      assert.equal(
        existsSync(resolve(appRoot, rel)),
        false,
        `${rel} should not exist in the points-only app`,
      );
    }
  });

  it("does not ship cashier or crypto payment API clients in the user app", () => {
    for (const rel of [
      "lib/api/alpha-cashier-client.ts",
      "lib/api/noncustodial-cashier-client.ts",
      "lib/api/crypto-client.ts",
      "lib/services/currency.ts",
      "lib/format.ts",
    ]) {
      assert.equal(
        existsSync(resolve(appRoot, rel)),
        false,
        `${rel} should not exist in the points-only app`,
      );
    }

    const apiIndex = read("lib/api/index.ts");
    assert.ok(!apiIndex.includes("cashier-client"));
    assert.ok(!apiIndex.includes("crypto-client"));
  });

  it("does not keep generic money formatter or site currency settings contracts", () => {
    // P12 dead-code sweep (2026-07-12): the sportsbook-era settings /
    // siteSettings slices (and the lib/store barrel that re-exported them)
    // were deleted outright — they had zero consumers. The currency /
    // odds-format contracts they carried must not return as files.
    for (const rel of [
      "lib/store/index.ts",
      "lib/store/settingsSlice.ts",
      "lib/store/siteSettingsSlice.ts",
    ]) {
      assert.equal(
        existsSync(resolve(appRoot, rel)),
        false,
        `${rel} carried retired sportsbook currency/odds contracts and should not return`,
      );
    }
    const store = read("lib/store/store.ts");
    for (const retired of [
      "Currency",
      "oddsFormat",
      "BettingPreferences",
      "settingsSlice",
      "siteSettingsSlice",
    ]) {
      assert.ok(
        !store.includes(retired),
        `store.ts should not reference retired contract ${retired}`,
      );
    }
    assert.equal(
      existsSync(resolve(appRoot, "lib/utils/odds.ts")),
      false,
      "unused sportsbook odds formatter should not ship in the points-only app",
    );
  });

  it("does not keep the retired dollar-stake prediction store contract", () => {
    assert.equal(
      existsSync(resolve(appRoot, "lib/store/predictionSlice.ts")),
      false,
      "unused predictionSlice.ts carried retired stakeUsd state",
    );

    // lib/store/index.ts was deleted in the P12 dead-code sweep (2026-07-12)
    // — store.ts is the only remaining store module to police.
    const storeSource = read("lib/store/store.ts");

    for (const source of [storeSource]) {
      assert.ok(!source.includes("predictionReducer"));
      assert.ok(!source.includes("predictionSlice"));
      assert.ok(!source.includes("stakeUsd"));
      assert.ok(!source.includes("setPredictionStake"));
      assert.ok(!source.includes("selectPredictionStake"));
    }
  });

  it("does not keep a cashier-named Redux slice in the launch store", () => {
    assert.equal(
      existsSync(resolve(appRoot, "lib/store/cashierSlice.ts")),
      false,
      "cashierSlice.ts should be renamed away from cashier terminology",
    );

    const storeSource = read("lib/store/store.ts");
    assert.ok(!storeSource.includes("cashierReducer"));
    assert.ok(!storeSource.includes("cashier:"));
    assert.ok(storeSource.includes("pointBalance:"));
  });

  it("trade ticket never links insufficient-balance users to cashier", () => {
    const source = read("components/prediction/TradeTicket.tsx");
    assert.ok(!source.includes('href="/cashier"'));
    assert.ok(source.includes('t("NOT_ENOUGH_POINTS")'));
  });

  it("recent trade tape displays sizes as points, not cash", () => {
    const source = read("components/prediction/RecentTrades.tsx");
    // Sizes go through the shared whole-Points formatter (app/lib/points).
    assert.ok(source.includes("formatPoints(size)"));
    assert.match(source, /from ["'](?:\.\.\/)+lib\/points["']/);
    assert.ok(!source.includes(">${size.toFixed(2)}"));
    assert.ok(!source.includes("$1/contract"));
  });

  it("has no launch-source cashier route links", () => {
    const offenders = listSourceFiles(".")
      .filter((rel) => !rel.startsWith("./__tests__/"))
      .filter((rel) => {
        const source = read(rel.replace(/^\.\//, ""));
        return /href=["']\/cashier\b|router\.push\(["']\/cashier\b|\/cashier\/cheque\b/.test(
          source,
        );
      });
    assert.deepEqual(offenders, []);
  });

  it("has no cashier or crypto payment endpoints in the user app API layer", () => {
    const forbiddenEndpoint =
      /\/api\/v1\/cashier|\/v1\/cashier|\/api\/v1\/payments\/crypto|deposit-intents|withdrawal-intents|wallet_switchEthereumChain|eth_sendTransaction|MetaMask is required|USDC cashier/;
    const offenders = listSourceFiles("lib/api").filter((rel) =>
      forbiddenEndpoint.test(read(rel)),
    );
    assert.deepEqual(offenders, []);
  });

  it("keeps public homepage teasers away from crypto and cash-value framing", () => {
    // The 2026-08-09 dark-landing rebuild replaced the hardcoded teaser
    // cards with editorial desk chips + a real-data ticker; the invariant
    // (no crypto tease on the homepage) is now expressed through the desk
    // list.
    const homepageSource = read("page.tsx");
    assert.ok(homepageSource.includes('"ESPORTS & ARENAS"'));
    assert.ok(!homepageSource.includes("CRYPTO & CHAINS"));

    const forbiddenHomepageCopy =
      /crypto|bitcoin|btc|usd|\$|dollar|cash|deposit|withdraw|withdrawal|prize|redeem|payout|wager|stake|fiat|kripto|加密|pembayaran|赔付|賠付/i;
    const offenders = listSourceFiles("../public/static/locales")
      .filter((rel) => rel.endsWith("/page-home.json"))
      .filter((rel) => forbiddenHomepageCopy.test(read(rel)));

    assert.deepEqual(offenders, []);
  });
});

// ── Bug C: wallet-client drops broken sportsbook fallback ─────────

describe("wallet-client: no sportsbook fallbacks", () => {
  const source = read("lib/api/wallet-client.ts");

  it("getTransactions no longer falls back to /wallets/{id}/transactions", () => {
    // The plural /wallets/ sportsbook endpoint does not exist in the
    // Predict gateway — it always 404ed.
    assert.ok(
      !source.includes("/api/v1/wallets/${userId}/transactions"),
      "wallet-client should not reference the sportsbook transactions endpoint",
    );
  });

  it("getTransactions primary path is /wallet/{id}/ledger", () => {
    assert.ok(
      source.includes("/api/v1/wallet/${userId}/ledger"),
      "wallet-client should use /wallet/{id}/ledger as the primary path",
    );
  });

  it("daily claim uses the wallet ledger-backed endpoint", () => {
    assert.ok(source.includes("claimDailyPoints"));
    assert.ok(source.includes("/api/v1/wallet/daily-claim"));
  });

  it("wallet reservations write point-ledger review markers", () => {
    const walletServiceSource = read(
      "../../../../go-platform/services/gateway/internal/wallet/service.go",
    );

    assert.ok(
      walletServiceSource.includes(
        'insertLedgerMarkerTx(ctx, tx, request.UserID, "reservation"',
      ),
      "wallet holds should write reservation ledger markers",
    );
    assert.ok(
      walletServiceSource.includes(
        'insertLedgerMarkerTx(ctx, tx, userID, "release"',
      ),
      "wallet releases should write release ledger markers",
    );
    assert.ok(
      walletServiceSource.includes("reservationLedgerKey"),
      "reservation/release marker idempotency should be keyed by reference",
    );
  });
});

describe("rewards daily claim", () => {
  const source = read("rewards/page.tsx");
  const walletClientSource = read("lib/api/wallet-client.ts");
  const loyaltyClientSource = read("lib/api/loyalty-client.ts");
  const gatewayWalletSource = read(
    "../../../../go-platform/services/gateway/internal/http/wallet_handlers.go",
  );

  it("renders a real daily claim action wired to the wallet client", () => {
    assert.ok(source.includes("claimDailyPoints"));
    assert.ok(source.includes("handleDailyClaim"));
    assert.ok(source.includes("DailyClaimControl"));
    assert.ok(source.includes("point ledger"));
  });

  it("renders configured point packs backed by idempotent point-ledger grants", () => {
    assert.ok(source.includes("getPointPacks"));
    assert.ok(source.includes("claimPointPack"));
    assert.ok(source.includes("PointPacksControl"));
    assert.ok(source.includes("gameplay point packs for predictions only"));
    assert.ok(
      source.includes("no cashout, withdrawal, crypto, fiat, or prize path"),
    );
    assert.ok(walletClientSource.includes("/api/v1/wallet/point-packs"));
    assert.ok(walletClientSource.includes("/api/v1/wallet/point-packs/claim"));
    assert.ok(gatewayWalletSource.includes("POINT_PACK_STARTER_BOOST_CENTS"));
    assert.ok(
      gatewayWalletSource.includes('Reason:         "point_pack_grant"'),
    );
    assert.ok(
      gatewayWalletSource.includes('"point_pack:" + userID + ":" + pack.ID'),
    );
  });

  it("renders missions backed by completed ledger activity and mission rewards", () => {
    assert.ok(source.includes("getMissions"));
    assert.ok(source.includes("claimMission"));
    assert.ok(source.includes("MissionsControl"));
    assert.ok(source.includes("Complete gameplay missions"));
    assert.ok(walletClientSource.includes("/api/v1/wallet/missions"));
    assert.ok(walletClientSource.includes("/api/v1/wallet/missions/claim"));
    assert.ok(
      gatewayWalletSource.includes("MISSION_DAILY_CHECK_IN_REWARD_CENTS"),
    );
    assert.ok(
      gatewayWalletSource.includes("MISSION_FIVE_PREDICTIONS_REWARD_CENTS"),
    );
    assert.ok(
      gatewayWalletSource.includes("MISSION_TEN_PREDICTIONS_REWARD_CENTS"),
    );
    assert.ok(
      gatewayWalletSource.includes("MISSION_FIVE_SETTLED_RESULTS_REWARD_CENTS"),
    );
    assert.ok(
      gatewayWalletSource.includes("MISSION_TEN_SETTLED_RESULTS_REWARD_CENTS"),
    );
    assert.ok(
      gatewayWalletSource.includes("MISSION_MONTHLY_CHECK_IN_REWARD_CENTS"),
    );
    assert.ok(gatewayWalletSource.includes('"five_predictions"'));
    assert.ok(gatewayWalletSource.includes('"ten_predictions"'));
    assert.ok(gatewayWalletSource.includes('"five_settled_results"'));
    assert.ok(gatewayWalletSource.includes('"ten_settled_results"'));
    assert.ok(gatewayWalletSource.includes('"monthly_check_in"'));
    assert.ok(
      gatewayWalletSource.includes("MISSION_SEASONAL_CHECK_IN_REWARD_CENTS"),
    );
    assert.ok(gatewayWalletSource.includes('"seasonal_check_in"'));
    assert.ok(
      gatewayWalletSource.includes("MISSION_QUARTERLY_CHECK_IN_REWARD_CENTS"),
    );
    assert.ok(gatewayWalletSource.includes('"quarterly_check_in"'));
    assert.ok(gatewayWalletSource.includes('Reason:         "mission_reward"'));
    assert.ok(gatewayWalletSource.includes('"daily_claim:"+userID+":"+date'));
  });

  it("renders streaks backed by daily claim ledger activity and streak rewards", () => {
    assert.ok(source.includes("getStreaks"));
    assert.ok(source.includes("claimStreak"));
    assert.ok(source.includes("StreaksControl"));
    assert.ok(source.includes("Keep daily gameplay-point claims going"));
    assert.ok(walletClientSource.includes("/api/v1/wallet/streaks"));
    assert.ok(walletClientSource.includes("/api/v1/wallet/streaks/claim"));
    assert.ok(gatewayWalletSource.includes("STREAK_DAILY_3_REWARD_CENTS"));
    assert.ok(gatewayWalletSource.includes("STREAK_DAILY_14_REWARD_CENTS"));
    assert.ok(gatewayWalletSource.includes('"daily_14"'));
    assert.ok(gatewayWalletSource.includes("STREAK_DAILY_30_REWARD_CENTS"));
    assert.ok(gatewayWalletSource.includes('"daily_30"'));
    assert.ok(gatewayWalletSource.includes("STREAK_DAILY_60_REWARD_CENTS"));
    assert.ok(gatewayWalletSource.includes('"daily_60"'));
    assert.ok(gatewayWalletSource.includes("STREAK_DAILY_90_REWARD_CENTS"));
    assert.ok(gatewayWalletSource.includes('"daily_90"'));
    assert.ok(gatewayWalletSource.includes('Reason:         "streak_reward"'));
    assert.ok(
      gatewayWalletSource.includes('prefix := "daily_claim:" + userID + ":"'),
    );
  });

  it("renders badges as non-redeemable cosmetics backed by ledger achievements", () => {
    assert.ok(source.includes("getBadges"));
    assert.ok(source.includes("BadgesControl"));
    assert.ok(source.includes("non-redeemable status markers"));
    assert.ok(walletClientSource.includes("/api/v1/wallet/badges"));
    assert.ok(gatewayWalletSource.includes("badgeDefinitions"));
    assert.ok(gatewayWalletSource.includes("CosmeticID"));
    assert.ok(gatewayWalletSource.includes("ledgerHasIdempotencyPrefix"));
    assert.ok(gatewayWalletSource.includes('"prediction_veteran"'));
    assert.ok(gatewayWalletSource.includes('"prediction_expert"'));
    assert.ok(gatewayWalletSource.includes('"streak_champion"'));
    assert.ok(gatewayWalletSource.includes('"monthly_streak"'));
    assert.ok(gatewayWalletSource.includes('"double_monthly_streak"'));
    assert.ok(gatewayWalletSource.includes('"quarterly_streak"'));
    assert.ok(gatewayWalletSource.includes('"monthly_check_in"'));
    assert.ok(gatewayWalletSource.includes('"seasonal_check_in"'));
    assert.ok(gatewayWalletSource.includes('"quarterly_check_in"'));
    assert.ok(gatewayWalletSource.includes('"settlement_veteran"'));
    assert.ok(gatewayWalletSource.includes('"settlement_expert"'));
  });

  it("renders reward limit status backed by ledger-based grant caps", () => {
    assert.ok(source.includes("getRewardLimitStatus"));
    assert.ok(source.includes("RewardLimitControl"));
    assert.ok(source.includes("Daily reward limit"));
    assert.ok(walletClientSource.includes("/api/v1/wallet/reward-limits"));
    assert.ok(gatewayWalletSource.includes("REWARD_DAILY_GRANT_LIMIT_CENTS"));
    assert.ok(gatewayWalletSource.includes("checkRewardGrantLimit"));
    assert.ok(gatewayWalletSource.includes("daily reward point limit reached"));
  });

  it("models loyalty standing and tiers with point-native XP/rank aliases", () => {
    const standingInterface =
      /export interface LoyaltyStanding \{[\s\S]*?\n\}/.exec(
        loyaltyClientSource,
      )?.[0] ?? "";
    const tierInterface =
      /export interface LoyaltyTier \{[\s\S]*?\n\}/.exec(
        loyaltyClientSource,
      )?.[0] ?? "";
    for (const token of [
      "xpPoints: number",
      "rankName: string",
      "nextRankName: string",
      "xpToNextRank: number",
      'unit: "PTS"',
      "minXpPoints: number",
    ]) {
      assert.ok(
        loyaltyClientSource.includes(token),
        `loyalty-client should expose point-native field ${token}`,
      );
    }
    for (const retired of [
      "tierName",
      "nextTier",
      "nextTierName",
      "pointsToNextTier",
      "pointsThreshold",
    ]) {
      assert.ok(
        !standingInterface.includes(retired) &&
          !tierInterface.includes(retired),
        `exported loyalty types should not expose retired tier alias ${retired}`,
      );
    }
    assert.ok(
      loyaltyClientSource.includes("type RawLoyaltyStanding") &&
        loyaltyClientSource.includes("normalizeLoyaltyStanding") &&
        loyaltyClientSource.includes("normalizeLoyaltyTier"),
      "older loyalty response parsing should stay private to the normalizer",
    );
  });
});

describe("market social discussion", () => {
  const clientSource = read("lib/api/market-social-client.ts");
  const componentSource = read("components/prediction/MarketDiscussion.tsx");
  const marketPageSource = read("market/[ticker]/page.tsx");
  const publicProfileSource = read("users/[userId]/page.tsx");
  const activityPageSource = read("activity/page.tsx");
  const gatewaySocialSource = read(
    "../../../../go-platform/services/gateway/internal/http/market_social_handlers.go",
  );

  it("uses prediction-native market social endpoints", () => {
    assert.ok(
      clientSource.includes("/api/v1/social/markets/${marketId}/comments"),
    );
    assert.ok(
      clientSource.includes("/api/v1/social/comments/${commentId}/react"),
    );
    assert.ok(
      clientSource.includes("/api/v1/social/comments/${commentId}/report"),
    );
  });

  it("renders comments, replies, reactions, and reports on market detail", () => {
    assert.ok(marketPageSource.includes("MarketDiscussion"));
    assert.ok(componentSource.includes("getMarketComments"));
    assert.ok(componentSource.includes("createMarketComment"));
    assert.ok(componentSource.includes("reactToMarketComment"));
    assert.ok(componentSource.includes("reportMarketComment"));
    assert.ok(componentSource.includes("setReplyTo(comment.id)"));
  });

  it("exposes a real market share action with clipboard fallback", () => {
    assert.ok(marketPageSource.includes("handleShareMarket"));
    assert.ok(marketPageSource.includes("navigator.share"));
    assert.ok(marketPageSource.includes("navigator.clipboard.writeText"));
    assert.ok(marketPageSource.includes("SHARE_MARKET"));
  });

  it("ships public profiles, follows, and activity feed wiring", () => {
    assert.ok(
      clientSource.includes(
        "/api/v1/social/users/${encodeURIComponent(userId)}/profile",
      ),
    );
    assert.ok(
      clientSource.includes(
        "/api/v1/social/users/${encodeURIComponent(userId)}/follow",
      ),
    );
    assert.ok(
      clientSource.includes(
        "/api/v1/social/users/${encodeURIComponent(userId)}/activity",
      ),
    );
    assert.ok(clientSource.includes("/api/v1/social/activity"));
    assert.ok(componentSource.includes("followSocialUser"));
    assert.ok(
      componentSource.includes(
        "href={`/users/${encodeURIComponent(comment.userId)}`",
      ),
    );
    assert.ok(componentSource.includes('href="/activity"'));
    assert.ok(publicProfileSource.includes("getPublicUserProfile"));
    assert.ok(publicProfileSource.includes("getUserActivity"));
    assert.ok(publicProfileSource.includes("followSocialUser"));
    assert.ok(activityPageSource.includes("getGlobalActivity"));
  });

  it("includes persisted trade fills in social activity surfaces", () => {
    for (const activityType of [
      '"comment"',
      '"follow"',
      '"trade"',
      '"settlement"',
      '"reward"',
      '"leaderboard"',
    ]) {
      assert.ok(clientSource.includes(activityType));
    }
    assert.ok(activityPageSource.includes('item.type === "trade"'));
    assert.ok(publicProfileSource.includes('item.type === "trade"'));
    assert.ok(gatewaySocialSource.includes("FROM prediction_trades"));
    assert.ok(gatewaySocialSource.includes("'trade' AS type"));
    assert.ok(gatewaySocialSource.includes("'Bought ' || quantity::text"));
    assert.ok(gatewaySocialSource.includes("'Sold ' || quantity::text"));
  });

  it("includes settlement and payout events in social activity surfaces", () => {
    assert.ok(gatewaySocialSource.includes("prediction_payouts p"));
    assert.ok(gatewaySocialSource.includes("prediction_settlements s"));
    assert.ok(gatewaySocialSource.includes("'settlement' AS type"));
    assert.ok(
      gatewaySocialSource.includes("'Market resolved ' || upper(result)"),
    );
    assert.ok(gatewaySocialSource.includes("'Settled ' || upper(p.side)"));
    assert.ok(activityPageSource.includes('item.type === "settlement"'));
    assert.ok(publicProfileSource.includes('item.type === "settlement"'));
  });

  it("includes reward and leaderboard movement in social activity surfaces", () => {
    assert.ok(gatewaySocialSource.includes("FROM loyalty_ledger"));
    assert.ok(gatewaySocialSource.includes("'reward' AS type"));
    assert.ok(
      gatewaySocialSource.includes(
        "'Earned ' || delta_points::text || ' reward points",
      ),
    );
    assert.ok(gatewaySocialSource.includes("FROM leaderboard_snapshots"));
    assert.ok(gatewaySocialSource.includes("'leaderboard' AS type"));
    assert.ok(gatewaySocialSource.includes("'Rank #' || rank::text"));
    assert.ok(activityPageSource.includes('item.type === "reward"'));
    assert.ok(activityPageSource.includes('item.type === "leaderboard"'));
    assert.ok(publicProfileSource.includes('item.type === "reward"'));
    assert.ok(publicProfileSource.includes('item.type === "leaderboard"'));
  });
});

describe("market detail liquidity honesty", () => {
  const marketPageSource = read("market/[ticker]/page.tsx");
  const orderBookSource = read("components/prediction/OrderBook.tsx");
  const predictionTypesSource = read(
    "../../api-client/src/prediction-types.ts",
  );
  const seedPredictionSource = read(
    "../../../../go-platform/services/gateway/seed-data/seed_prediction.sql",
  );

  it("does not synthesize order book rows from price and liquidity", () => {
    assert.ok(!marketPageSource.includes("function synthesizeBook"));
    assert.ok(!marketPageSource.includes("synthesizeBook("));
    assert.ok(!orderBookSource.includes("synthesized book"));
    assert.ok(!orderBookSource.includes("shape-only rendering"));
  });

  it("renders real order book depth or an explicit AMM liquidity snapshot", () => {
    assert.ok(
      marketPageSource.includes("function MarketDepth") &&
        marketPageSource.includes('market.executionMode === "order_book"') &&
        marketPageSource.includes("adaptBookForDisplay(orderBook)") &&
        marketPageSource.includes("function LiquiditySnapshot") &&
        marketPageSource.includes("AMM_LIQUIDITY"),
      "Market detail should branch between real order book data and explicit AMM liquidity",
    );
  });

  it("renders AMM curve and reserve fields without inventing order book depth", () => {
    assert.ok(predictionTypesSource.includes("ammYesShares?: number"));
    assert.ok(predictionTypesSource.includes("ammNoShares?: number"));
    assert.ok(predictionTypesSource.includes("ammSubsidyPoints?: number"));
    assert.ok(marketPageSource.includes("function AMMCurve"));
    assert.ok(marketPageSource.includes("AMM_PRICE_MARKER"));
    assert.ok(marketPageSource.includes("AMM_RESERVE_BALANCE"));
    assert.ok(marketPageSource.includes("market.ammYesShares"));
    assert.ok(marketPageSource.includes("market.ammNoShares"));
    assert.ok(marketPageSource.includes("market.ammSubsidyPoints"));
    assert.ok(marketPageSource.includes("formatCompactPoints(subsidy)"));
  });

  it("backs AMM impact quotes with the order preview endpoint", () => {
    assert.ok(marketPageSource.includes("const AMM_QUOTE_SIZES = [1, 10, 25]"));
    assert.ok(marketPageSource.includes("api.previewOrder({"));
    assert.ok(marketPageSource.includes('side: "yes"'));
    assert.ok(marketPageSource.includes('action: "buy"'));
    assert.ok(marketPageSource.includes('orderType: "market"'));
    assert.ok(marketPageSource.includes("function AMMCurve"));
    assert.ok(marketPageSource.includes("AMM_IMPACT_QUOTES"));
    assert.ok(marketPageSource.includes("quote.newYesPricePoints"));
    assert.ok(marketPageSource.includes("quote.averageFillPricePoints"));
    assert.ok(marketPageSource.includes("quote.totalCostWithFeesPoints"));
  });

  it("keeps a launch-safe legacy AMM seed market for live detail proof", () => {
    assert.ok(seedPredictionSource.includes("WHERE ticker = 'DOTA-GF-MAP1'"));
    assert.ok(seedPredictionSource.includes("execution_mode = 'amm'"));
    assert.ok(seedPredictionSource.includes("amm_yes_shares = 18.50000000"));
    assert.ok(seedPredictionSource.includes("amm_no_shares = 42.00000000"));
    assert.ok(
      seedPredictionSource.includes("quote-only AMM detail UI"),
      "seed should document why this AMM fixture exists",
    );
  });
});

describe("market detail related markets", () => {
  const marketPageSource = read("market/[ticker]/page.tsx");

  it("prefers event, series, and category related markets before fallback", () => {
    // The chain now runs inside load() so it starts concurrently with the
    // other secondary fetches (2026-07-12 waterfall fix): `m` is the fetched
    // market and `ev` the awaited event, but the lazy preference order —
    // event, then series, then category, then generic — is unchanged.
    assert.ok(
      marketPageSource.includes("await addRelated({ eventId: m.eventId })") &&
        marketPageSource.includes(
          "await addRelated({ seriesId: ev.seriesId })",
        ) &&
        marketPageSource.includes(
          "await addRelated({ categoryId: ev.categoryId })",
        ) &&
        marketPageSource.includes("await addRelated({})"),
      "related markets should be selected by actual event/series/category context before generic fallback",
    );
  });

  it("keeps related market volume in points copy", () => {
    assert.ok(marketPageSource.includes("formatCompactPoints(m.volumePoints)"));
    assert.ok(
      !marketPageSource.includes(
        "value: `$${(m.volumePoints / 100).toFixed(0)}`",
      ),
    );
  });
});

// ── Bug E: compliance cool-off check must stay live ───────────────

describe("compliance-client: cool-off stub", () => {
  const source = read("lib/api/compliance-client.ts");

  it("getCoolOffStatus fetches /compliance/rg/restrictions", () => {
    const m = /export async function getCoolOffStatus[\s\S]*?^\}/m.exec(source);
    assert.ok(m, "getCoolOffStatus should be defined");
    assert.ok(
      m![0].includes("/api/v1/compliance/rg/restrictions"),
      "getCoolOffStatus body should call /compliance/rg/restrictions",
    );
  });

  it("getCoolOffStatus is no longer an unconditional inactive stub", () => {
    const m = /export async function getCoolOffStatus[\s\S]*?^\}/m.exec(source);
    assert.ok(
      !/return\s+\{\s*status:\s*"inactive",\s*coolOffUntil:\s*null\s*\};\s*$/.test(
        m![0].trim(),
      ),
      "function should not end as an unconditional inactive stub",
    );
  });
});

// ── Bug D: card styling must not be inside <Link> ─────────────────
// Updated for Ink & lime step 11: MarketCard/MarketGrid retired — the
// feed (MarketFeed) is the browse card everywhere. Same invariant, new
// file: an accessible name must never swallow style text.

describe("MarketFeed: Tailwind styling outside Link", () => {
  const source = read("components/prediction/MarketFeed.tsx");

  it("does not render <style> as a child of <Link>", () => {
    const linkBlock = /<Link[\s\S]*?<\/Link>/.exec(source);
    assert.ok(linkBlock, "<Link> should exist in MarketFeed");
    assert.ok(
      !linkBlock![0].includes("<style>"),
      "Link element should not contain a <style> tag — keep styling in Tailwind classes outside the Link body",
    );
  });

  it("does not reintroduce a local style helper", () => {
    assert.ok(
      !/MarketCardStyles|MarketFeedStyles/.test(source),
      "MarketFeed should not rely on a local style helper",
    );
  });
});

// ── Bug F: browse-card invariants ─────────────────────────────────
//
// Updated for Ink & lime step 11: the P8 MarketCard/MarketGrid pair is
// retired — the single-column feed (MarketFeed, Predict Light Social 3a)
// is the browse card on /predict, /category/* and /series/*. The
// invariants that survived the redesign are pinned against the feed:
// sentiment-not-probability-pill, priced side actions with real tap
// sizes, ?side= deep links, no fake sparklines/deltas, and the
// point-native volume contract.

describe("MarketFeed composition", () => {
  const feedSource = read("components/prediction/MarketFeed.tsx");
  const marketSentimentSource = read(
    "components/prediction/marketSentiment.ts",
  );

  it("renders the sentiment sentence, not a probability pill", () => {
    assert.ok(
      feedSource.includes("calculateMarketSentiment") &&
        feedSource.includes("t(sentiment.displayStringKey"),
      "feed rows should render the helper-provided market sentiment translation key",
    );
    assert.ok(
      marketSentimentSource.includes("MARKET_SENTIMENT_SPLIT_ROOM") &&
        marketSentimentSource.includes("MARKET_SENTIMENT_STRONG_DOUBT") &&
        marketSentimentSource.includes("MARKET_SENTIMENT_HEAVY_BACKING"),
      "Market sentiment helper should cover neutral and heavy leading translation keys",
    );
    assert.ok(
      !feedSource.includes("PROBABILITY_CHANCE") &&
        !feedSource.includes("probabilityDescriptorKey"),
      "the feed should not render the old chance/descriptor probability pill",
    );
  });

  it("ships translated market sentiment keys in every prediction locale", () => {
    const locales = ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"];
    const keys = [
      "MARKET_SENTIMENT_STRONG_DOUBT",
      "MARKET_SENTIMENT_LEANING_NO",
      "MARKET_SENTIMENT_SPLIT_ROOM",
      "MARKET_SENTIMENT_LEANING_YES",
      "MARKET_SENTIMENT_HEAVY_BACKING",
    ];

    for (const locale of locales) {
      const predictionLocale = read(
        `../public/static/locales/${locale}/prediction.json`,
      );
      for (const key of keys) {
        assert.ok(
          predictionLocale.includes(`"${key}"`),
          `${locale}/prediction.json should include ${key}`,
        );
      }
    }
  });

  it("keeps YES/NO actions priced without losing tap size", () => {
    assert.ok(
      feedSource.includes("min-h-12"),
      "hero side actions keep a firm (48px) tap size",
    );
    assert.ok(
      feedSource.includes("justify-between"),
      "side actions separate the side label from the side price",
    );
    assert.ok(
      feedSource.includes("{market.yesPricePoints}¢") &&
        feedSource.includes("{market.noPricePoints}¢"),
      "side actions show the side prices in cents",
    );
  });

  it("YES/NO actions deep-link with ?side= so the trade ticket pre-selects", () => {
    assert.ok(
      /\?side=yes/.test(feedSource) && /\?side=no/.test(feedSource),
      "feed side actions should link to /market/<ticker>?side=yes|no",
    );
  });

  it("does not render seeded placeholder sparklines or fake deltas", () => {
    assert.ok(
      !feedSource.includes("seededSparklinePoints"),
      "the feed should not render seeded placeholder sparklines",
    );
    assert.ok(
      !feedSource.includes("mkt-delta"),
      "the feed should not render placeholder cent deltas",
    );
  });

  it("keeps activity volume on the point-native prop contract", () => {
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      feedSource.includes("formatCompactPoints(market.volumePoints)") &&
        !feedSource.includes("volumePointsCents") &&
        !feedSource.includes("volumeCents") &&
        !feedSource.includes("liquidityPoints"),
      "the feed should render activity from the canonical volumePoints field only",
    );
  });
});

describe("MarketChart terminal colors", () => {
  // P4: rendering moved to MarketChartCanvas (lightweight-charts); the
  // P11 color contract is unchanged and now pinned there.
  const canvasSource = read("components/prediction/MarketChartCanvas.tsx");

  it("uses the terminal violet for price history, not movement colors", () => {
    assert.ok(
      canvasSource.includes('cssVar(container, "--accent-lo")'),
      "chart canvas should use the terminal violet chart token",
    );
    assert.ok(
      !/lineColor\s*[:=]\s*isUp\s*\?/.test(canvasSource),
      "chart line color should not switch to YES/NO based on movement",
    );
  });

  // P11 terminal: the complement stays visible as market context without
  // competing with the violet primary series.
  it("draws the complement side as a muted mirror line", () => {
    assert.ok(
      canvasSource.includes('cssVar(container, "--t4")'),
      "chart canvas should keep the complement on a quiet neutral token",
    );
    assert.ok(
      canvasSource.includes("withAlpha(muted, 0.45)"),
      "chart complement line should render muted at 0.45",
    );
  });
});

describe("Navigation underline treatment", () => {
  const allMarketsSource = read("components/prediction/AllMarketsSection.tsx");
  const topBarSource = read("components/prediction/TopBar.tsx");

  function functionBody(source: string, name: string): string {
    const match = new RegExp(`function\\s+${name}\\([\\s\\S]*?^\\}`, "m").exec(
      source,
    );
    assert.ok(match, `${name} should be declared`);
    return match[0];
  }

  function constValue(source: string, name: string): string {
    const match = new RegExp(
      `const\\s+${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    ).exec(source);
    assert.ok(match, `${name} should be declared as a class constant`);
    return match[1] ?? match[2] ?? "";
  }

  it("uses Tailwind underline links for category and top navigation", () => {
    for (const [label, source, container, item, active] of [
      [
        "category navigation",
        allMarketsSource,
        "CATEGORY_LIST_CLASS",
        "CATEGORY_PILL_BASE_CLASS",
        "categoryPillClass",
      ],
      [
        "top navigation",
        topBarSource,
        "TOP_BAR_NAV_CLASS",
        "TOP_BAR_LINK_CLASS",
        "TOP_BAR_LINK_ACTIVE_CLASS",
      ],
    ] as const) {
      // P9 (2026-07-07): the category nav keeps its full-width underline
      // track; the top-bar nav dropped it — as a flex sibling of the search
      // field its track ended mid-air, reading as a rendering glitch. The
      // top bar's own bottom hairline is the line now.
      if (label === "category navigation") {
        assert.ok(
          constValue(source, container).includes(
            "flex items-center gap-6 border-b border-neutral-200 w-full",
          ),
          `${label} should use the shared underline container classes`,
        );
      } else {
        assert.ok(
          !constValue(source, container).includes("border-b"),
          `${label} should not draw a mid-air underline track`,
        );
      }
      const itemClass = constValue(source, item);
      for (const token of [
        "relative",
        "pb-3",
        "pt-2",
        "text-sm",
        "font-medium",
        "border-b-2",
        "transition-all",
        "duration-200",
      ]) {
        assert.ok(
          itemClass.includes(token),
          `${label} should include ${token}`,
        );
      }
      assert.ok(
        source.includes("text-neutral-500") &&
          source.includes("border-transparent") &&
          source.includes("hover:text-neutral-800") &&
          source.includes("hover:border-neutral-300"),
        `${label} should keep inactive borders transparent`,
      );
      const activeClass =
        active === "categoryPillClass"
          ? functionBody(source, active)
          : constValue(source, active);
      // P9 (2026-07-07): mint text/underline moved to the white-AA pair —
      // --accent-text (4.9:1 text) + --accent-lo (3.1:1 indicator). Raw
      // --accent (1.9:1 on white) is fill-only per DESIGN.md §8.
      assert.ok(
        activeClass.includes("text-[var(--accent-text)]") &&
          source.includes("font-semibold") &&
          source.includes("border-[var(--accent-lo)]"),
        `${label} should draw the selected mint underline`,
      );
    }

    assert.ok(
      !functionBody(allMarketsSource, "categoryPillClass").includes(
        "bg-[var(--yes)] font-semibold text-[#061a10]",
      ),
      "Category navigation should no longer use active pill fill",
    );
    assert.ok(
      !constValue(topBarSource, "TOP_BAR_LINK_ACTIVE_CLASS").includes(
        "bg-[var(--yes)] font-semibold text-[#061a10]",
      ),
      "Top navigation should no longer use active pill fill",
    );
  });

  it("uses soft rectangular corners for active segmented controls", () => {
    // P9.2 (2026-07-07): the market-page chart range switcher became a
    // quiet mono text-tab row (Robinhood-structure pass) — only the
    // discovery closing-window control remains a segmented fill.
    for (const [label, source, constant] of [
      ["closing-window shell", allMarketsSource, "TIME_PILLS_CLASS"],
      ["closing-window button", allMarketsSource, "TIME_PILL_BASE_CLASS"],
    ] as const) {
      const classValue = constValue(source, constant);
      assert.ok(
        classValue.includes("rounded-md"),
        `${label} should use 6px Tailwind corners`,
      );
      assert.ok(
        !classValue.includes("var(--r-pill)") && !classValue.includes("999px"),
        `${label} should not use capsule radius`,
      );
    }
  });

  it("uses soft rectangular corners for category navigation pills", () => {
    const categoryPillsSource = read("components/prediction/CategoryPills.tsx");
    const categoryPillClass = constValue(
      categoryPillsSource,
      "PILL_BASE_CLASS",
    );
    assert.ok(
      categoryPillClass.includes("rounded-md"),
      "Category pills should use 6px Tailwind corners",
    );
    assert.ok(
      !categoryPillClass.includes("var(--r-pill)") &&
        !categoryPillClass.includes("999px"),
      "Category pills should not use capsule radius",
    );
  });
});

describe("Navigation pill active colors", () => {
  const allMarketsSource = read("components/prediction/AllMarketsSection.tsx");
  const marketChartSource = read("components/prediction/MarketChart.tsx");
  const categoryPillsSource = read("components/prediction/CategoryPills.tsx");

  function functionBody(source: string, name: string): string {
    const match = new RegExp(`function\\s+${name}\\([\\s\\S]*?^\\}`, "m").exec(
      source,
    );
    assert.ok(match, `${name} should be declared`);
    return match[0];
  }

  // Active selection uses the brand-purple fill with its high-contrast
  // foreground, and a DIRECTION token
  // may never be a selection colour (spec §2 one-job-per-channel).
  it("uses purple for segmented active fills, never a direction token", () => {
    for (const [label, activeClass] of [
      [
        "closing-window active",
        functionBody(allMarketsSource, "timePillClass"),
      ],
    ] as const) {
      assert.ok(
        activeClass.includes("bg-[var(--accent)]") &&
          activeClass.includes("text-[var(--ticket-cta-text)]"),
        `${label} should be the purple fill with its contrast foreground`,
      );
      assert.ok(
        !activeClass.includes("bg-[var(--yes)]") &&
          !activeClass.includes("bg-[var(--no)]"),
        `${label} must not use a direction token as a selection colour`,
      );
    }
  });

  it("renders the market chart range switcher as quiet text tabs", () => {
    const rangeClass = functionBody(marketChartSource, "rangeButtonClass");
    assert.ok(
      rangeClass.includes("border-[var(--accent-lo)]") &&
        rangeClass.includes("border-transparent"),
      "chart range tabs should underline the active range in terminal violet",
    );
    assert.ok(
      !rangeClass.includes("bg-[var(--yes)]") &&
        !rangeClass.includes("bg-[var(--accent)]"),
      "chart range tabs should not use segmented fills",
    );
  });

  it("uses lavender and purple tokens for active category pills", () => {
    function constValue(source: string, name: string): string {
      const match = new RegExp(
        `const\\s+${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
      ).exec(source);
      assert.ok(match, `${name} should be declared as a class constant`);
      return match[1] ?? match[2] ?? "";
    }

    const categoryActiveClass = constValue(
      categoryPillsSource,
      "PILL_ACTIVE_CLASS",
    );
    assert.ok(
      categoryActiveClass.includes("bg-[var(--accent-soft)]") &&
        categoryActiveClass.includes("border-[var(--accent)]") &&
        categoryActiveClass.includes("text-[var(--accent-text)]"),
      "Active category pills should use lavender and purple tokens",
    );
  });
});

describe("Predict discovery controls", () => {
  const allMarketsSource = read("components/prediction/AllMarketsSection.tsx");
  const predictionWorkspaceSource = read(
    "components/prediction/PredictionWorkspace.tsx",
  );
  const momentMarketsSource = read(
    "components/prediction/MomentMarketsSection.tsx",
  );
  const discoverPageSource = read("discover/page.tsx");
  const seriesPageSource = read("series/[slug]/page.tsx");
  // Step 11: MarketGrid/MarketCard retired — MarketFeed is the browse
  // card everywhere; the watch-control pins moved onto it.
  const marketFeedSource = read("components/prediction/MarketFeed.tsx");
  const watchlistClientSource = read("lib/api/market-watchlist-client.ts");
  const predictionClientSource = read(
    "../../api-client/src/prediction-client.ts",
  );

  it("backs in-page search and sort with market-list API params", () => {
    assert.ok(
      allMarketsSource.includes('const [query, setQuery] = useState("")'),
      "AllMarketsSection should own an in-page search query",
    );
    assert.ok(
      allMarketsSource.includes(
        'const [sortBy, setSortBy] = useState<MarketSort>("activity")',
      ),
      "AllMarketsSection should own an explicit sort mode",
    );
    assert.ok(
      allMarketsSource.includes("q: search || undefined") &&
        allMarketsSource.includes("sort: sortBy"),
      "initial market load should pass search and sort to getMarkets",
    );
    assert.ok(
      allMarketsSource.includes("q: query.trim() || undefined") &&
        allMarketsSource.includes("sort: sortBy"),
      "load more should keep search and sort scoped",
    );
    assert.ok(
      predictionClientSource.includes('query.set("q", params.q)') &&
        predictionClientSource.includes('query.set("sort", params.sort)'),
      "PredictionApiClient.getMarkets should serialize q and sort",
    );
  });

  it("uses the in-place Moments filter grid instead of a carousel and persistent trade rail", () => {
    assert.ok(
      predictionWorkspaceSource.includes('variant="moments"') &&
        predictionWorkspaceSource.includes("categoryId={activeCategoryId}"),
      "PredictionWorkspace should mount the approved Moments presentation",
    );
    assert.ok(
      !predictionWorkspaceSource.includes('aria-roledescription="carousel"') &&
        !predictionWorkspaceSource.includes("<ConnectedTradeTicket"),
      "The discovery viewport should not restore the removed carousel or trade rail",
    );
    assert.ok(
      momentMarketsSource.includes('data-testid="moment-filter-bar"') &&
        momentMarketsSource.includes('type="search"') &&
        momentMarketsSource.includes("market-sort-${pill.value}") &&
        momentMarketsSource.includes("market-window-${pill.value}") &&
        momentMarketsSource.includes("q: query.trim() || undefined") &&
        momentMarketsSource.includes(
          "closeBefore: dateWindowToCloseBefore(dateWindow)",
        ) &&
        momentMarketsSource.includes("sort: sortBy") &&
        !momentMarketsSource.includes("DISCOVER_RANKING_SECTIONS"),
      "The established search, sort, and closing-window controls should filter in place",
    );
    assert.ok(
      momentMarketsSource.includes("const PAGE_SIZE = 9") &&
        momentMarketsSource.includes("pageSize: PAGE_SIZE") &&
        momentMarketsSource.includes(
          "dedupeMarkets([...current, ...(response.data || [])])",
        ) &&
        momentMarketsSource.includes("<MarketGrid markets={markets} columns={3} />"),
      "The live Moments grid should remain a responsive 3×3, nine-at-a-time market directory",
    );
  });

  it("backs watchlist filtering with persistent watchlist endpoints", () => {
    assert.ok(
      watchlistClientSource.includes('"/api/v1/watchlist/markets"') &&
        watchlistClientSource.includes("apiClient.put") &&
        watchlistClientSource.includes("apiClient.delete"),
      "market-watchlist-client should list, add, and remove persistent watchlist rows",
    );
    assert.ok(
      allMarketsSource.includes("getMarketWatchlist") &&
        allMarketsSource.includes("addMarketToWatchlist") &&
        allMarketsSource.includes("removeMarketFromWatchlist"),
      "AllMarketsSection should hydrate and mutate the persisted watchlist",
    );
    assert.ok(
      allMarketsSource.includes("showWatchlistOnly") &&
        allMarketsSource.includes("watchedMarketIds") &&
        allMarketsSource.includes("onToggleWatchlist={toggleWatchlist}"),
      "AllMarketsSection should filter by watched markets and pass toggle state into the grid",
    );
    assert.ok(
      marketFeedSource.includes("watched={watchedMarketIds?.has(") &&
        marketFeedSource.includes("onToggleWatchlist={onToggleWatchlist}"),
      "MarketFeed should pass market identity and watch state into hero and rows",
    );
    assert.ok(
      marketFeedSource.includes("aria-pressed={watched}") &&
        marketFeedSource.includes("REMOVE_FROM_WATCHLIST") &&
        marketFeedSource.includes("ADD_TO_WATCHLIST"),
      "MarketFeed should expose an accessible watch/unwatch control",
    );
  });

  it("backs /discover movement with market price history instead of deterministic deltas", () => {
    assert.ok(
      discoverPageSource.includes("getMarketPriceHistory") &&
        discoverPageSource.includes("movementFromHistory") &&
        discoverPageSource.includes('"1d"'),
      "/discover should derive 24h movement from market price history",
    );
    assert.ok(
      !discoverPageSource.includes("deterministicDelta"),
      "/discover should not render pseudo-random movement deltas",
    );
  });

  it("keeps taxonomy support in the client and dedicated series page without crowding the markets feed", () => {
    assert.ok(
      predictionClientSource.includes("/api/v1/series") &&
        predictionClientSource.includes("/api/v1/tags") &&
        predictionClientSource.includes(
          'query.set("seriesId", params.seriesId)',
        ) &&
        predictionClientSource.includes('query.set("tag", params.tag)'),
      "PredictionApiClient should expose series/tags and serialize seriesId/tag market filters",
    );
    assert.ok(
      !allMarketsSource.includes("getSeries") &&
        !allMarketsSource.includes("getTags") &&
        !allMarketsSource.includes("selectedTag") &&
        !allMarketsSource.includes("TAXONOMY_PANEL_CLASS") &&
        !allMarketsSource.includes("href={`/series/${item.slug}`}"),
      "AllMarketsSection should omit the crowded Series/Tags controls",
    );
    assert.ok(
      seriesPageSource.includes("getSeries") &&
        seriesPageSource.includes("seriesId: match.id") &&
        seriesPageSource.includes("MarketFeed"),
      "/series/[slug] should resolve a real series and list its open markets",
    );
  });
});

describe("Static informational pages", () => {
  const contentPageSource = read("components/ContentPage.tsx");
  const footerSource = read("components/prediction/PredictFooter.tsx");
  const globalsSource = read("globals.css");
  const proxySource = read("../proxy.ts");
  const tosSource = read("tos/page.tsx");
  const aboutSource = read("about/page.tsx");

  it("exposes /tos as the Terms of Use page and keeps /about content available", () => {
    assert.ok(
      tosSource.includes('export { default } from "../terms/page"'),
      "/tos should render the Terms of Use content",
    );
    assert.ok(
      aboutSource.includes('slug="about-us"') &&
        aboutSource.includes("About Tap Trade"),
      "/about should render the About Us fallback content",
    );
  });

  it("keeps Terms of Use linked through the public footer and auth proxy", () => {
    assert.ok(
      footerSource.includes('href: "/tos"') &&
        footerSource.includes('label: "Terms of Use"'),
      "Footer should link Terms of Use to /tos",
    );
    assert.ok(
      proxySource.includes('"/tos"'),
      "/tos should be listed as a public informational route",
    );
  });

  it("uses the light static content page treatment", () => {
    assert.ok(
      contentPageSource.includes('className="content-page"') &&
        contentPageSource.includes('className="content-page-body"'),
      "ContentPageRenderer should use the static content page classes",
    );
    assert.ok(
      globalsSource.includes(".content-page") &&
        globalsSource.includes("background: var(--surface-1)") &&
        globalsSource.includes("color: var(--t1)") &&
        globalsSource.includes(".content-page-body h2"),
      "Static pages should use light readable typography styles",
    );
    assert.ok(
      !contentPageSource.includes("prose-invert"),
      "Static content pages should not use inverted dark prose styling",
    );
  });
});

describe("Social auth feature gate", () => {
  const featuresSource = read("lib/features.ts");

  // Register split redesign (2026-07-08, owner-directed): the register page
  // renders Google/Apple/SSO unconditionally per the reference layout. The
  // old dead-end risk this gate prevented is handled in the component now:
  // clicks PROBE the OAuth start route and degrade to an inline notice when
  // a provider isn't configured, instead of navigating into raw JSON. Login
  // keeps the flag-gated grid.
  it("keeps social OAuth honest: login flag-gated, register probe-degraded", () => {
    assert.ok(
      featuresSource.includes("FEATURE_SOCIAL_AUTH") &&
        featuresSource.includes("NEXT_PUBLIC_FEATURE_SOCIAL_AUTH"),
      "social auth should have an explicit public feature flag",
    );
    assert.ok(
      read("auth/login/page.tsx").includes("FEATURE_SOCIAL_AUTH") &&
        read("auth/login/page.tsx").includes("<SocialAuthButtons />"),
      "login should gate social buttons behind FEATURE_SOCIAL_AUTH",
    );
    const register = read("auth/register/page.tsx");
    // QA fix ISSUE-018/008 (2026-07-26): apple/sso have no oauth
    // registration in the auth service (start route → hard 404), so the
    // stacked trio is now the backend-registered verified-email set.
    assert.ok(
      register.includes('providers={["google", "facebook", "discord"]}') &&
        register.includes('variant="stacked"'),
      "register should render only backend-registered providers in the stacked layout",
    );
    const buttons = read("components/auth/SocialAuthButtons.tsx");
    assert.ok(
      buttons.includes('redirect: "manual"') &&
        buttons.includes("isn't configured for this deployment yet") &&
        buttons.includes("/start/`"),
      "social buttons must probe the start route (trailing slash — Next's 308 masquerades as a provider redirect) and degrade to an inline notice",
    );
  });
});

describe("Live markets feature gate", () => {
  const featuresSource = read("lib/features.ts");
  const topBarSource = read("components/prediction/TopBar.tsx");
  const mobileTabBarSource = read("components/MobileTabBar.tsx");
  const livePageSource = read("live/page.tsx");

  it("keeps the dedicated Live surface hidden unless explicitly enabled", () => {
    assert.ok(
      featuresSource.includes("FEATURE_LIVE_MARKETS") &&
        featuresSource.includes("NEXT_PUBLIC_FEATURE_LIVE_MARKETS"),
      "live markets should have an explicit public feature flag",
    );
    assert.ok(
      topBarSource.includes("FEATURE_LIVE_MARKETS") &&
        topBarSource.includes('href: "/live"') &&
        topBarSource.includes("enabled: FEATURE_LIVE_MARKETS"),
      "desktop nav should hide Live unless FEATURE_LIVE_MARKETS is enabled",
    );
    assert.ok(
      mobileTabBarSource.includes("FEATURE_LIVE_MARKETS") &&
        mobileTabBarSource.includes('href: "/live"') &&
        mobileTabBarSource.includes("enabled: FEATURE_LIVE_MARKETS"),
      "mobile nav should hide Live unless FEATURE_LIVE_MARKETS is enabled",
    );
    assert.ok(
      livePageSource.includes("FEATURE_LIVE_MARKETS") &&
        livePageSource.includes('router.replace("/predict")') &&
        livePageSource.includes("getLiveMarkets"),
      "direct /live visits should redirect without fetching live data when the flag is off",
    );
  });
});

describe("Registration auth flow", () => {
  const registerSource = read("auth/register/page.tsx");
  const authProviderSource = read("components/AuthProvider.tsx");

  it("signs the user in after account creation instead of returning to login", () => {
    assert.ok(
      registerSource.includes("const { login } = useAuth();") &&
        // QA fix ISSUE-010 (2026-07-26): register suppresses login()'s
        // "Welcome back!" toast via opts — the call gained a third arg.
        registerSource.includes(
          "const newUser = await login(form.username, form.password, {",
        ),
      "register page should establish an authenticated session after successful signup",
    );
    assert.ok(
      registerSource.includes(
        'router.replace(safeReturnPath(searchParams.get("returnUrl")))',
      ),
      "register page should land on the validated returnUrl after automatic login",
    );
    assert.ok(
      !registerSource.includes('window.location.href = "/auth/login"'),
      "register page should not force users back through the sign-in screen after signup",
    );
  });

  it("claims starter points and shows the points-only no-cashout disclosure", () => {
    // ISSUE-011 intent (new users must LEARN they have points), current
    // mechanism: AuthProvider claims once per session and announces on the
    // server-truth `granted` flag. The register page must NOT also claim —
    // the duplicate raced the session claim (concurrent same-key credits)
    // and stacked a second toast.
    assert.ok(
      !registerSource.includes("claimStarterGrant"),
      "register page must not claim the starter grant directly — AuthProvider owns the claim",
    );
    assert.ok(
      authProviderSource.includes("res.enabled && res.granted") &&
        authProviderSource.includes("STARTER_GRANT_TOAST_TITLE") &&
        authProviderSource.includes("STARTER_GRANT_TOAST_BODY"),
      "AuthProvider should announce the welcome grant exactly when the server says it was granted",
    );
    // Whitespace-normalized: prettier re-wraps JSX text across lines, which
    // must not defeat a copy scan (the rendered string is unchanged).
    const registerCopy = registerSource.replace(/\s+/g, " ");
    assert.ok(
      registerCopy.includes("non-redeemable gameplay points") &&
        registerCopy.includes("cannot be cashed") &&
        registerCopy.includes("no-cashout disclosure"),
      "register page should require an explicit points-only no-cashout disclosure",
    );
    assert.ok(
      registerSource.includes("terms_accepted: true") &&
        registerSource.includes("terms_version: TERMS_VERSION") &&
        registerSource.includes("launch_disclosure_accepted: true") &&
        registerSource.includes(
          "launch_disclosure_version: LAUNCH_DISCLOSURE_VERSION",
        ),
      "register page should persist terms and points-only disclosure acceptance with the auth service",
    );
  });

  it("keeps the session-level starter grant fallback idempotent per user", () => {
    assert.ok(
      authProviderSource.includes(
        "const starterGrantClaimedFor = useRef<string | null>(null)",
      ) &&
        authProviderSource.includes(
          "starterGrantClaimedFor.current === user.id",
        ) &&
        authProviderSource.includes("starterGrantClaimedFor.current = user.id"),
      "AuthProvider should claim the starter grant once per authenticated user id",
    );
  });
});

describe("Mobile navigation and chat parity", () => {
  const mobileTabBarSource = read("components/MobileTabBar.tsx");
  const chatSidebarSource = read("components/chat/ChatSidebar.tsx");

  it("keeps mobile primary nav aligned with desktop auth rules", () => {
    assert.ok(
      mobileTabBarSource.includes('href: "/discover"') &&
        mobileTabBarSource.includes("NAV_TRENDING"),
      "mobile nav should expose Trending like the desktop primary nav",
    );
    assert.ok(
      mobileTabBarSource.includes("useAuth()") &&
        mobileTabBarSource.includes("requiresAuth") &&
        mobileTabBarSource.includes("isAuthenticated"),
      "mobile nav should hide auth-required destinations until login",
    );
    assert.ok(
      mobileTabBarSource.includes("NAV_LEADERBOARDS") &&
        !mobileTabBarSource.includes("NAV_BOARDS"),
      "mobile nav should use the same Leaderboards label key as desktop",
    );
  });

  it("opens mobile chat in the native in-app chat surface", () => {
    assert.ok(
      chatSidebarSource.includes("chat-mobile-sheet") &&
        chatSidebarSource.includes("renderChatPanel(false)") &&
        chatSidebarSource.includes("<ChatFrame"),
      "mobile chat should render the same in-app ChatFrame as desktop",
    );
    assert.ok(
      !chatSidebarSource.includes("window.open"),
      "mobile chat should not send users to a different external chat flow",
    );
  });

  it("keeps chat seed messages away from sportsbook and cash-value topics", () => {
    for (const retired of [
      "oddswatcher",
      "sportsbook_sam",
      "BTC",
      "$100K",
      "Solana",
      "ETH",
      "$90",
      "oil above",
    ]) {
      assert.ok(
        !chatSidebarSource.includes(retired),
        `chat seed messages should not include ${retired}`,
      );
    }

    assert.ok(chatSidebarSource.includes("pricewatcher"));
    assert.ok(chatSidebarSource.includes("grand prix safety-car market"));
  });

  it("keeps footer and geo denial copy point-native", () => {
    const footerSource = read("components/prediction/PredictFooter.tsx");
    const geoComplySource = read("lib/services/geocomply.ts");
    const accountSource = read("account/page.tsx");
    const tradeTicketSource = read("components/prediction/TradeTicket.tsx");

    assert.ok(
      footerSource.includes("Non-redeemable point prediction markets"),
      "footer should state the point-native launch boundary",
    );
    assert.ok(!footerSource.includes("sports bets"));
    assert.ok(!geoComplySource.includes("Betting is not available"));
    assert.ok(!geoComplySource.includes("place a bet"));
    assert.ok(
      geoComplySource.includes("submit a prediction order"),
      "geo denial copy should describe prediction orders",
    );
    assert.ok(!accountSource.includes("bet analytics"));
    assert.ok(!accountSource.includes("betting heatmap"));
    assert.ok(!accountSource.includes("sportsbook products"));
    assert.ok(!tradeTicketSource.includes("not restart from $25"));
  });
});

describe("Market copy localization", () => {
  const marketContentSource = read("components/prediction/market-content.ts");
  const predictionTypesSource = read(
    "../../api-client/src/prediction-types.ts",
  );

  it("models API-provided market translations", () => {
    assert.ok(
      predictionTypesSource.includes("export interface MarketTranslation") &&
        predictionTypesSource.includes(
          "translations?: Record<string, MarketTranslation>",
        ),
      "PredictionMarket should expose API-provided localized title/description copy",
    );
  });

  it("prefers API-provided localized copy before static fallback files", () => {
    assert.ok(
      marketContentSource.includes("market.translations"),
      "market-content should read dynamic translations from the market payload",
    );
    assert.ok(
      marketContentSource.indexOf(
        'const apiTitle = localizedCopy(market, "title")',
      ) <
        marketContentSource.indexOf(
          'const bundledTitle = staticCopy(t, market, "title")',
        ) &&
        marketContentSource.indexOf(
          'const bundledTitle = staticCopy(t, market, "title")',
        ) <
          marketContentSource.indexOf(
            'const templatedTitle = templateCopy(t, market, "title")',
          ),
      "marketTitle should prefer API translations before bundled market-content fallbacks",
    );
    assert.ok(
      marketContentSource.indexOf(
        'const apiDescription = localizedCopy(market, "description")',
      ) <
        marketContentSource.indexOf(
          'const bundledDescription = staticCopy(t, market, "description")',
        ) &&
        marketContentSource.indexOf(
          'const bundledDescription = staticCopy(t, market, "description")',
        ) <
          marketContentSource.indexOf(
            'const templatedDescription = templateCopy(t, market, "description")',
          ),
      "marketDescription should prefer API translations before bundled market-content fallbacks",
    );
  });

  it("keeps bundled market-content fallbacks away from crypto and cash-value framing", () => {
    const forbiddenMarketCopy =
      /\b(?:crypto|bitcoin|btc|usd|dollar|cash|deposit|withdraw|withdrawal|prize|redeem|payout|wager|stake|fiat|kripto|solana|spcx|ipo|nvda|spy)\b|\$|加密|比特幣|比特币|美元/i;
    const offenders: string[] = [];

    function visit(value: unknown, source: string, keyPath: string) {
      if (typeof value === "string") {
        if (forbiddenMarketCopy.test(value)) {
          offenders.push(`${source}:${keyPath}`);
        }
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, next] of Object.entries(value)) {
        visit(next, source, `${keyPath}.${key}`);
      }
    }

    for (const rel of listSourceFiles("../public/static/locales").filter(
      (file) => file.endsWith("/market-content.json"),
    )) {
      visit(JSON.parse(read(rel)), rel, "$");
    }

    assert.deepEqual(offenders, []);
  });

  it("does not feature crypto as a launch discovery category", () => {
    const predictSource = read("predict/page.tsx");
    const allMarketsSource = read(
      "components/prediction/AllMarketsSection.tsx",
    );
    const trendingSource = read("components/prediction/TrendingSidebar.tsx");
    const categoryPillsSource = read("components/prediction/CategoryPills.tsx");
    const featuredCarouselSource = read(
      "components/prediction/FeaturedCarousel.tsx",
    );
    const marketImageSource = read(
      "components/prediction/utils/marketImage.ts",
    );
    const subcategorySource = read(
      "components/prediction/marketSubcategories.ts",
    );
    const layoutSource = read("layout.tsx");

    assert.ok(predictSource.includes('"entertainment"'));
    assert.ok(!predictSource.includes('"crypto", "politics"'));
    assert.ok(allMarketsSource.includes('slug.toLowerCase() !== "crypto"'));
    assert.ok(!trendingSource.includes('btc: "Crypto"'));
    assert.ok(!trendingSource.includes('crypto: "Crypto"'));
    assert.ok(!trendingSource.includes('btc: "Technology"'));
    assert.ok(!trendingSource.includes('eth: "Technology"'));
    assert.ok(!trendingSource.includes('crypto: "Technology"'));
    assert.ok(!categoryPillsSource.includes("crypto:"));
    assert.ok(!featuredCarouselSource.includes("Crypto"));
    assert.ok(!marketImageSource.includes("crypto:"));
    assert.ok(!subcategorySource.includes("Crypto Markets"));
    assert.ok(!subcategorySource.includes('label: "Bitcoin"'));
    assert.ok(!layoutSource.includes("pageants, crypto"));
  });
});

describe("Full-page translation coverage", () => {
  const i18nConfigSource = read("lib/i18n/config.ts");
  const portfolioSource = read("portfolio/page.tsx");
  const marketPageSource = read("market/[ticker]/page.tsx");
  const marketChartSource = read("components/prediction/MarketChart.tsx");
  const orderBookSource = read("components/prediction/OrderBook.tsx");
  const discoverPageSource = read("discover/page.tsx");
  const heroPriceHistorySource = read(
    "components/prediction/utils/useHeroPriceHistory.ts",
  );
  const portfolioLocaleSource = read(
    "../public/static/locales/en/portfolio.json",
  );
  const predictionClientSource = read(
    "../../api-client/src/prediction-client.ts",
  );
  const predictionTypesSource = read(
    "../../api-client/src/prediction-types.ts",
  );
  const officePunterSearchSource = read(
    "../../office/app/components/users/PunterSearch.tsx",
  );
  const officeRiskSummarySource = read(
    "../../office/translations/en/page-risk-management-summary.js",
  );
  const gatewayHandlerSource = read(
    "../../../../go-platform/services/gateway/internal/http/handlers.go",
  );
  const criticalPageNamespaces = [
    "account",
    "portfolio",
    "rewards",
    "settings",
    "leaderboards",
  ];
  const supportedLaunchLanguages = [
    "en",
    "zh-Hans",
    "zh-Hant",
    "tl",
    "ms",
    "id",
  ];
  const launchUnsafeValuePattern =
    /\b(?:deposit|withdrawals?|cash(?:ier|out)?|casino|crypto|fiat|bets?|betting|odds|sportsbook|wagers?|wagering|stakes?|payouts?|payments?|usd|dollars?)\b|\$|tunai|kasino|kripto|penarikan|deposito|pembayaran|bayaran|现金|現金|加密|提款|取款|存款|支付|賠付|赔付|奖金|獎金|投注|下注|赌|賭/i;

  function flattenStrings(
    value: unknown,
    prefix = "",
    output: Record<string, string> = {},
  ): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return output;
    }
    for (const [key, child] of Object.entries(value)) {
      const nextKey = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === "object" && !Array.isArray(child)) {
        flattenStrings(child, nextKey, output);
      } else if (typeof child === "string") {
        output[nextKey] = child;
      }
    }
    return output;
  }

  function readLocale(lang: string, namespace: string): Record<string, string> {
    const source = readFileSync(
      resolve(appRoot, `../public/static/locales/${lang}/${namespace}.json`),
      "utf-8",
    );
    return flattenStrings(JSON.parse(source));
  }

  function listLocaleNamespaces(lang: string): string[] {
    return readdirSync(resolve(appRoot, `../public/static/locales/${lang}`))
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(/\.json$/, ""))
      .sort();
  }

  function isAllowedLocaleSafetyValue(key: string, value: string): boolean {
    return key.endsWith("PASSWORD_REGEX") && value.startsWith("^");
  }

  it("keeps supported launch locale values out of cash and gambling claims", () => {
    const offenders: string[] = [];

    for (const lang of supportedLaunchLanguages) {
      for (const namespace of listLocaleNamespaces(lang)) {
        const locale = readLocale(lang, namespace);
        for (const [key, value] of Object.entries(locale)) {
          if (
            launchUnsafeValuePattern.test(value) &&
            !isAllowedLocaleSafetyValue(key, value)
          ) {
            offenders.push(`${lang}/${namespace}.json ${key}: ${value}`);
          }
        }
      }
    }

    assert.deepStrictEqual(offenders, []);
  });

  it("keeps legacy result and esports locale labels point-native", () => {
    const unsafeLegacyValue =
      /Financial Transaction ID|^Sport$|^OUTRIGHTS$|^Matches$|^Decimal$|^American$|^Fractional$/;
    const offenders: string[] = [];

    for (const lang of supportedLaunchLanguages) {
      for (const namespace of ["page-esports-bets", "win-loss-statistics"]) {
        const locale = readLocale(lang, namespace);
        for (const [key, value] of Object.entries(locale)) {
          if (unsafeLegacyValue.test(value)) {
            offenders.push(`${lang}/${namespace}.json ${key}: ${value}`);
          }
        }
      }
    }

    assert.deepStrictEqual(offenders, []);
  });

  it("keeps leaderboard locale labels on point-result wording", () => {
    const unsafeLeaderboardPattern =
      /\bP&L\b|profit|keuntungan|\bkita\b|盈亏|盈虧|利润|利潤/i;
    const offenders: string[] = [];

    for (const lang of supportedLaunchLanguages) {
      const locale = readLocale(lang, "leaderboards");
      for (const [key, value] of Object.entries(locale)) {
        if (unsafeLeaderboardPattern.test(value)) {
          offenders.push(`${lang}/leaderboards.json ${key}: ${value}`);
        }
      }
    }

    assert.deepStrictEqual(offenders, []);
  });

  it("keeps portfolio and account result labels on point wording", () => {
    const unsafeResultPattern =
      /\bP&L\b|profit|keuntungan|\bkita\b|盈亏|盈虧|利润|利潤/i;
    const offenders: string[] = [];

    for (const lang of supportedLaunchLanguages) {
      for (const namespace of ["portfolio", "account", "win-loss-statistics"]) {
        const locale = readLocale(lang, namespace);
        for (const [key, value] of Object.entries(locale)) {
          if (unsafeResultPattern.test(value)) {
            offenders.push(`${lang}/${namespace}.json ${key}: ${value}`);
          }
        }
      }
    }

    assert.deepStrictEqual(offenders, []);
  });

  it("keeps office account-review result copy point-denominated", () => {
    assert.ok(
      officePunterSearchSource.includes('label: "Point balance"'),
      "office account search should label balances as points",
    );
    assert.ok(
      officePunterSearchSource.includes('label: "Point result"'),
      "office account search should label results as point results",
    );
    assert.ok(
      officePunterSearchSource.includes("pts"),
      "office account search should render account amounts in points",
    );
    assert.ok(
      !officePunterSearchSource.includes('label: "P&L"') &&
        !officePunterSearchSource.includes("`$${value.toLocaleString") &&
        !/\{value < 0 \? "-" : "\+"\}\$/.test(officePunterSearchSource),
      "office account search should not render P&L or dollar-formatted account results",
    );
    assert.ok(
      !/Platform profit/i.test(officeRiskSummarySource),
      "office risk reports should not render platform profit wording",
    );
    assert.ok(
      officeRiskSummarySource.includes(
        'DAILY_REPORTS_PLATFORM_PROFIT: "Platform point result"',
      ),
      "office risk reports should render platform point-result wording",
    );
    assert.ok(
      !/"(?:Total bets|Bets with odds boost|Bets with both|Bet count|Odds boost ID|Unique odds boosts|Odds boost usage breakdown)"/.test(
        officeRiskSummarySource,
      ),
      "office risk reports should not render bet or odds-boost wording",
    );
    assert.ok(
      officeRiskSummarySource.includes(
        'DAILY_REPORTS_TOTAL_BETS: "Total predictions"',
      ) &&
        officeRiskSummarySource.includes(
          'METRIC_BETS_WITH_ODDS_BOOST: "Predictions with point boosts"',
        ) &&
        officeRiskSummarySource.includes('TABLE_BET_COUNT: "Prediction count"'),
      "office risk reports should render prediction and point-boost wording",
    );
  });

  it("keeps sharpness copy away from investment-return wording", () => {
    const unsafeSharpnessPattern =
      /\bROI\b|return on risk|return on investment|imbal hasil atas risiko|pulangan atas risiko|风险回报率|風險回報率/i;
    const offenders: string[] = [];

    for (const lang of supportedLaunchLanguages) {
      for (const namespace of ["portfolio", "leaderboards"]) {
        const locale = readLocale(lang, namespace);
        for (const [key, value] of Object.entries(locale)) {
          if (unsafeSharpnessPattern.test(value)) {
            offenders.push(`${lang}/${namespace}.json ${key}: ${value}`);
          }
        }
      }
    }

    assert.deepStrictEqual(offenders, []);
  });

  it("loads page namespaces for portfolio and leaderboards", () => {
    assert.ok(
      i18nConfigSource.includes('"portfolio"') &&
        i18nConfigSource.includes('"leaderboards"'),
      "i18n config should register the portfolio and leaderboards namespaces",
    );
  });

  it("routes requested account surfaces through i18n", () => {
    for (const file of [
      "account/page.tsx",
      "account/settings/page.tsx",
      "portfolio/page.tsx",
      "leaderboards/page.tsx",
      "rewards/page.tsx",
    ]) {
      assert.ok(
        read(file).includes("useTranslation("),
        `${file} should use i18n for visible page copy`,
      );
    }
  });

  it("prefers point-native portfolio settlement history aliases", () => {
    const settledPositionResultTypeSource = predictionTypesSource.slice(
      predictionTypesSource.indexOf("export interface SettledPositionResult"),
      predictionTypesSource.indexOf("export interface DiscoveryResponse"),
    );
    const settledPositionResultNormalizerSource = predictionClientSource.slice(
      predictionClientSource.indexOf("function normalizeSettledPositionResult"),
      predictionClientSource.indexOf(
        "function normalizeSettlementPointDisbursement",
      ),
    );
    assert.ok(
      settledPositionResultTypeSource.includes("entryPricePoints: number") &&
        settledPositionResultTypeSource.includes("exitPricePoints: number") &&
        settledPositionResultTypeSource.includes("realizedPoints: number") &&
        settledPositionResultTypeSource.includes("settlementPoints: number") &&
        predictionTypesSource.includes('unit?: "PTS" | string'),
      "SettledPositionResult should expose point-native settlement-history fields",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      !predictionTypesSource.includes("export interface SettledPayout") &&
        !settledPositionResultTypeSource.includes("entryPricePointsCents") &&
        !settledPositionResultTypeSource.includes("entryPriceCents") &&
        !settledPositionResultTypeSource.includes("exitPricePointsCents") &&
        !settledPositionResultTypeSource.includes("exitPriceCents") &&
        !settledPositionResultTypeSource.includes("pnlPoints") &&
        !settledPositionResultTypeSource.includes("payoutPoints"),
      "SettledPositionResult should not export retired price/payout/P&L aliases or payout-named history type",
    );
    assert.ok(
      predictionClientSource.includes("normalizeSettledPositionResult") &&
        settledPositionResultNormalizerSource.includes(
          "row.entryPricePoints",
        ) &&
        settledPositionResultNormalizerSource.includes("row.exitPricePoints") &&
        predictionClientSource.includes("row.realizedPoints") &&
        predictionClientSource.includes("row.settlementPoints") &&
        predictionClientSource.includes('unit: row.unit || "PTS"'),
      "PredictionApiClient should normalize portfolio history from point-native aliases",
    );
    assert.ok(
      !settledPositionResultNormalizerSource.includes(
        "entryPricePoints: entryPricePoints",
      ) &&
        !settledPositionResultNormalizerSource.includes(
          "exitPricePoints: exitPricePoints",
        ) &&
        !settledPositionResultNormalizerSource.includes(
          "pnlPoints: realizedPoints",
        ) &&
        !settledPositionResultNormalizerSource.includes(
          "payoutPoints: settlementPoints",
        ),
      "PredictionApiClient should not reattach retired portfolio-history price/result aliases",
    );
    assert.ok(
      portfolioSource.includes("settled results") &&
        portfolioLocaleSource.includes("settled results") &&
        !portfolioSource.includes("settled payouts") &&
        !portfolioLocaleSource.includes("settled payouts"),
      "Portfolio visible copy should describe settled results, not payouts",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      portfolioSource.includes("h.settlementPoints") &&
        portfolioSource.includes("h.realizedPoints") &&
        portfolioSource.includes("h.entryPricePoints") &&
        portfolioSource.includes("h.exitPricePoints") &&
        !portfolioSource.includes("h.entryPricePointsCents") &&
        !portfolioSource.includes("h.entryPriceCents") &&
        !portfolioSource.includes("h.exitPricePointsCents") &&
        !portfolioSource.includes("h.exitPriceCents") &&
        !portfolioSource.includes("h.payoutPoints") &&
        !portfolioSource.includes("h.pnlPoints") &&
        !portfolioSource.includes("pointsByMarketId") &&
        !portfolioSource.includes("getLoyaltyLedger"),
      "Portfolio history points should render the settlement credit, not loyalty accrual",
    );
    assert.ok(
      portfolioLocaleSource.includes('"pointsShort": "+{{points}}"') &&
        portfolioLocaleSource.includes(
          '"earnedPoints": "Settlement {{points}}"',
        ),
      "Portfolio history point copy should not duplicate point units",
    );
    assert.ok(
      gatewayHandlerSource.includes(
        "Winning positions settle at 100 points per share.",
      ) &&
        !gatewayHandlerSource.includes("Winning positions pay 100¢/contract."),
      "Settlement notifications should use point-native language",
    );
  });

  it("prefers point-native market payload aliases", () => {
    const marketType = predictionTypesSource.slice(
      predictionTypesSource.indexOf("export interface PredictionMarket"),
      predictionTypesSource.indexOf(
        "export interface MarketJurisdictionPolicy",
      ),
    );
    const normalizeMarket = predictionClientSource.slice(
      predictionClientSource.indexOf("function normalizePredictionMarket"),
      predictionClientSource.indexOf("function normalizeMarketPriceHistory"),
    );
    assert.ok(
      marketType.includes("yesPricePoints: number") &&
        marketType.includes("noPricePoints: number") &&
        marketType.includes("volumePoints: number") &&
        marketType.includes("openInterestPoints: number") &&
        marketType.includes("liquidityPoints: number") &&
        predictionTypesSource.includes("ammSubsidyPoints?: number") &&
        predictionTypesSource.includes("collateralPoolPoints?: number") &&
        predictionTypesSource.includes("settlementPoolPoints?: number"),
      "PredictionMarket should expose point-native market payload fields",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      !marketType.includes("yesPricePointsCents") &&
        !marketType.includes("yesPriceCents") &&
        !marketType.includes("noPricePointsCents") &&
        !marketType.includes("noPriceCents") &&
        !marketType.includes("lastTradePricePointsCents") &&
        !marketType.includes("lastTradePriceCents") &&
        !marketType.includes("volumePointsCents") &&
        !marketType.includes("volumeCents") &&
        !marketType.includes("openInterestPointsCents") &&
        !marketType.includes("openInterestCents") &&
        !marketType.includes("liquidityPointsCents") &&
        !marketType.includes("liquidityCents") &&
        !marketType.includes("ammSubsidyPointsCents") &&
        !marketType.includes("ammSubsidyCents") &&
        !marketType.includes("collateralPoolPointsCents") &&
        !marketType.includes("collateralPoolCents") &&
        !marketType.includes("settledPayoutPoolPoints"),
      "PredictionMarket should not export retired market response aliases",
    );
    assert.ok(
      predictionClientSource.includes("normalizePredictionMarket") &&
        predictionClientSource.includes("type LegacyPredictionMarket") &&
        predictionClientSource.includes("normalizeDiscoveryResponse") &&
        predictionClientSource.includes(
          "response.data.map(normalizePredictionMarket)",
        ) &&
        predictionClientSource.includes("row.volumePoints") &&
        predictionClientSource.includes("row.liquidityPoints") &&
        predictionClientSource.includes("row.bestYesBidPoints") &&
        predictionClientSource.includes('unit: row.unit || "PTS"'),
      "PredictionApiClient should normalize market payloads from point-native aliases",
    );
    assert.ok(
      !/yesPricePoints: yesPricePoints|volumePoints: volumePoints|liquidityPoints: liquidityPoints/.test(
        normalizeMarket,
      ),
      "normalizePredictionMarket should not reattach retired market aliases",
    );
  });

  it("prefers point-native live market update aliases", () => {
    const liveMarketPageSource = read("market/[ticker]/page.tsx");
    const gatewayPredictionHandlersSource = read(
      "../../../../go-platform/services/gateway/internal/http/prediction_handlers.go",
    );
    const liveMarketPayloadSource = sliceBetween(
      gatewayPredictionHandlersSource,
      "type marketUpdatePayload struct",
      "// buildOrderBookHintPayload",
    );
    const orderBookHintPayloadSource = sliceBetween(
      gatewayPredictionHandlersSource,
      "func buildOrderBookHintPayload",
      "func buildMarketUpdatePayload",
    );
    // Motion pass 2026-08-07: the normalizer moved to the shared
    // components/prediction/live.ts (the /predict workspace subscribes
    // too). Same invariant — point-native aliases normalize on every
    // consumer — checked at the shared module plus the page's usage.
    const liveModuleSource = read("components/prediction/live.ts");
    assert.ok(
      liveMarketPageSource.includes("normalizeMarketUpdateFields") &&
        liveMarketPageSource.includes("normalizedMarketFields") &&
        liveModuleSource.includes("yesPricePoints") &&
        liveModuleSource.includes("noPricePoints") &&
        liveModuleSource.includes("lastTradePricePoints") &&
        liveModuleSource.includes("volumePoints") &&
        liveModuleSource.includes("openInterestPoints") &&
        liveModuleSource.includes('unit: payload.unit || "PTS"'),
      "Live market updates should normalize WebSocket frames from point-native aliases (shared live.ts, consumed by the market detail page)",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      liveMarketPayloadSource.includes("YesPricePoints") &&
        liveMarketPayloadSource.includes("NoPricePoints") &&
        liveMarketPayloadSource.includes("LastTradePricePoints") &&
        liveMarketPayloadSource.includes("VolumePoints") &&
        liveMarketPayloadSource.includes("OpenInterestPoints") &&
        liveMarketPayloadSource.includes('json:"yesPricePoints"') &&
        liveMarketPayloadSource.includes('json:"noPricePoints"') &&
        liveMarketPayloadSource.includes('json:"lastTradePricePoints') &&
        liveMarketPayloadSource.includes('json:"volumePoints"') &&
        liveMarketPayloadSource.includes('json:"openInterestPoints"') &&
        !liveMarketPayloadSource.includes("PointsCents") &&
        !liveMarketPayloadSource.includes('json:"yesPriceCents"') &&
        !liveMarketPayloadSource.includes('json:"noPriceCents"') &&
        !liveMarketPayloadSource.includes('json:"lastTradePriceCents') &&
        !liveMarketPayloadSource.includes('json:"volumeCents"') &&
        !liveMarketPayloadSource.includes('json:"openInterestCents"'),
      "Gateway live market update frames should emit only canonical *Points wire keys",
    );
    assert.ok(
      orderBookHintPayloadSource.includes('"bestYesBidPoints"') &&
        orderBookHintPayloadSource.includes('"bestYesAskPoints"') &&
        orderBookHintPayloadSource.includes('"bestNoBidPoints"') &&
        orderBookHintPayloadSource.includes('"bestNoAskPoints"') &&
        !orderBookHintPayloadSource.includes("PointsCents") &&
        !orderBookHintPayloadSource.includes('"bestYesBidCents"') &&
        !orderBookHintPayloadSource.includes('"bestYesAskCents"') &&
        !orderBookHintPayloadSource.includes('"bestNoBidCents"') &&
        !orderBookHintPayloadSource.includes('"bestNoAskCents"') &&
        predictionTypesSource.includes("bestYesBidPoints?: number") &&
        predictionTypesSource.includes("bestYesAskPoints?: number") &&
        predictionTypesSource.includes("bestNoBidPoints?: number") &&
        predictionTypesSource.includes("bestNoAskPoints?: number"),
      "OrderBookHint should expose only point-native best-quote aliases",
    );
  });

  it("prefers point-native admin dashboard activity aliases", () => {
    const dashboardMoverType = sliceBetween(
      predictionTypesSource,
      "export interface DashboardMover",
      "export interface DashboardVolumeStats",
    );
    const dashboardStatsType = sliceBetween(
      predictionTypesSource,
      "export interface DashboardVolumeStats",
      "// --- Market price history",
    );
    const dashboardNormalizerSource = sliceBetween(
      predictionClientSource,
      "function normalizeDashboardVolumeStats",
      "function normalizeDashboardMover",
    );
    const dashboardMoverNormalizerSource = sliceBetween(
      predictionClientSource,
      "function normalizeDashboardMover",
      "function normalizePricePoint",
    );

    assert.ok(
      dashboardMoverType.includes("yesPricePointsStart: number") &&
        dashboardMoverType.includes("yesPricePointsNow: number") &&
        dashboardMoverType.includes("volumePoints: number") &&
        dashboardMoverType.includes('unit: "PTS" | string') &&
        dashboardStatsType.includes("totalVolumePoints: number") &&
        dashboardStatsType.includes('unit: "PTS" | string'),
      "Dashboard stats types should expose required point-native activity fields",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      !dashboardMoverType.includes("yesPricePointsCentsStart") &&
        !dashboardMoverType.includes("yesPriceCentsStart") &&
        !dashboardMoverType.includes("yesPricePointsCentsNow") &&
        !dashboardMoverType.includes("yesPriceCentsNow") &&
        !dashboardMoverType.includes("volumePointsCents") &&
        !dashboardMoverType.includes("volumeCents") &&
        !dashboardStatsType.includes("totalVolumePointsCents") &&
        !dashboardStatsType.includes("totalVolumeCents"),
      "Exported dashboard stats types should not expose retired activity aliases",
    );
    assert.ok(
      predictionClientSource.includes("type LegacyDashboardMover") &&
        predictionClientSource.includes("type LegacyDashboardVolumeStats") &&
        predictionClientSource.includes("row.totalVolumePoints") &&
        predictionClientSource.includes("row.yesPricePointsStart") &&
        predictionClientSource.includes("row.yesPricePointsNow") &&
        predictionClientSource.includes("row.volumePoints"),
      "PredictionApiClient should normalize dashboard activity from point-native aliases",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      !dashboardNormalizerSource.includes("...row") &&
        !dashboardNormalizerSource.includes("totalVolumePointsCents:") &&
        !dashboardNormalizerSource.includes("totalVolumeCents:") &&
        !dashboardMoverNormalizerSource.includes("...row") &&
        !dashboardMoverNormalizerSource.includes("yesPriceCentsStart:") &&
        !dashboardMoverNormalizerSource.includes("yesPriceCentsNow:") &&
        !dashboardMoverNormalizerSource.includes("volumePointsCents:") &&
        !dashboardMoverNormalizerSource.includes("volumeCents:"),
      "Dashboard normalizers should not reattach retired activity aliases",
    );
  });

  it("prefers point-native admin drift alert aliases", () => {
    const driftAlertType = sliceBetween(
      predictionTypesSource,
      "export interface CollateralDriftAlert",
      "export interface DriftAlertsResponse",
    );
    const driftAlertNormalizerSource = sliceBetween(
      predictionClientSource,
      "function normalizeCollateralDriftAlert",
      "function normalizeSettledPositionResult",
    );

    assert.ok(
      driftAlertType.includes("maxDriftPoints: number") &&
        driftAlertType.includes("totalDriftPoints: number") &&
        driftAlertType.includes('unit: "PTS" | string'),
      "CollateralDriftAlert should expose required point-native drift fields",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      !driftAlertType.includes("maxDriftPointsCents") &&
        !driftAlertType.includes("maxDriftCents") &&
        !driftAlertType.includes("totalDriftPointsCents") &&
        !driftAlertType.includes("totalDriftCents"),
      "Exported CollateralDriftAlert should not expose retired drift aliases",
    );
    assert.ok(
      predictionClientSource.includes("type LegacyCollateralDriftAlert") &&
        predictionClientSource.includes("type LegacyDriftAlertsResponse") &&
        predictionClientSource.includes("normalizeCollateralDriftAlert") &&
        predictionClientSource.includes("row.maxDriftPoints") &&
        predictionClientSource.includes("row.totalDriftPoints") &&
        predictionClientSource.includes(
          "data: response.data.map(normalizeCollateralDriftAlert)",
        ),
      "PredictionApiClient should normalize drift alerts from point-native aliases",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      !driftAlertNormalizerSource.includes("...row") &&
        !driftAlertNormalizerSource.includes("maxDriftPointsCents:") &&
        !driftAlertNormalizerSource.includes("maxDriftCents:") &&
        !driftAlertNormalizerSource.includes("totalDriftPointsCents:") &&
        !driftAlertNormalizerSource.includes("totalDriftCents:"),
      "Drift alert normalizer should not reattach retired drift aliases",
    );
  });

  it("keeps price history rows point-native after private legacy normalization", () => {
    const pricePointTypeStart = predictionTypesSource.indexOf(
      "export interface PricePoint",
    );
    const pricePointTypeEnd = predictionTypesSource.indexOf(
      "export interface MarketPriceHistory",
      pricePointTypeStart,
    );
    const pricePointType = predictionTypesSource.slice(
      pricePointTypeStart,
      pricePointTypeEnd,
    );
    const pricePointNormalizerStart = predictionClientSource.indexOf(
      "function normalizePricePoint",
    );
    const pricePointNormalizerEnd = predictionClientSource.indexOf(
      "type LegacyPortfolioSummary",
      pricePointNormalizerStart,
    );
    const pricePointNormalizer = predictionClientSource.slice(
      pricePointNormalizerStart,
      pricePointNormalizerEnd,
    );
    assert.ok(
      pricePointType.includes("yesPricePoints: number") &&
        pricePointType.includes("volumePoints: number") &&
        pricePointType.includes('unit?: "PTS" | string'),
      "PricePoint should expose required point-native price-history fields",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      !pricePointType.includes("yesPricePointsCents") &&
        !pricePointType.includes("yesPriceCents") &&
        !pricePointType.includes("volumePointsCents") &&
        !pricePointType.includes("volumeCents"),
      "exported PricePoint should not expose retired price-history aliases",
    );
    assert.ok(
      predictionClientSource.includes("normalizeMarketPriceHistory") &&
        predictionClientSource.includes("normalizePricePoint") &&
        predictionClientSource.includes("type LegacyPricePoint") &&
        predictionClientSource.includes("row.yesPricePoints") &&
        predictionClientSource.includes("row.volumePoints") &&
        predictionClientSource.includes('unit: row.unit || "PTS"'),
      "PredictionApiClient should normalize price-history buckets from point-native aliases",
    );
    assert.ok(
      !/yesPricePoints: yesPricePoints|volumePoints: volumePoints/.test(
        pricePointNormalizer,
      ),
      "normalizePricePoint should not reattach retired price-history aliases",
    );
    // Step 10: movementFromHistory moved from discover/page.tsx into the
    // shared components/prediction/market-movement.ts (consumed by both
    // /discover and the /predict feed) — the point-native read pins there.
    const marketMovementSource = read(
      "components/prediction/market-movement.ts",
    );
    assert.ok(
      marketChartSource.includes("p.yesPricePoints") &&
        marketMovementSource.includes("point.yesPricePoints") &&
        heroPriceHistorySource.includes("p.yesPricePoints"),
      "price-history UI consumers should read point-native history fields",
    );
  });

  it("keeps order book depth rows point-native after private legacy normalization", () => {
    const orderBookLevelTypeStart = predictionTypesSource.indexOf(
      "export interface OrderBookLevel",
    );
    const orderBookLevelTypeEnd = predictionTypesSource.indexOf(
      "export interface OrderBookSide",
      orderBookLevelTypeStart,
    );
    const orderBookLevelType = predictionTypesSource.slice(
      orderBookLevelTypeStart,
      orderBookLevelTypeEnd,
    );
    const orderBookNormalizerStart = predictionClientSource.indexOf(
      "function normalizeOrderBookLevel",
    );
    const orderBookNormalizerEnd = predictionClientSource.indexOf(
      "function normalizePricePoint",
      orderBookNormalizerStart,
    );
    const orderBookNormalizer = predictionClientSource.slice(
      orderBookNormalizerStart,
      orderBookNormalizerEnd,
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      orderBookLevelType.includes("pricePoints: number") &&
        orderBookLevelType.includes("shares: number") &&
        orderBookLevelType.includes("cumulativeShares: number") &&
        orderBookLevelType.includes("notionalPoints: number") &&
        orderBookLevelType.includes("totalNotionalPoints: number") &&
        orderBookLevelType.includes('unit: "PTS" | string') &&
        !orderBookLevelType.includes("pricePointsCents") &&
        !orderBookLevelType.includes("priceCents") &&
        !orderBookLevelType.includes("quantity") &&
        !orderBookLevelType.includes("total: number"),
      "OrderBookLevel should expose point-native depth fields without retired aliases",
    );
    assert.ok(
      predictionClientSource.includes("normalizeOrderBook") &&
        predictionClientSource.includes("normalizeOrderBookLevel") &&
        predictionClientSource.includes("type LegacyOrderBookLevel") &&
        predictionClientSource.includes("row.pricePoints") &&
        predictionClientSource.includes("row.shares") &&
        predictionClientSource.includes("row.cumulativeShares") &&
        predictionClientSource.includes("row.notionalPoints") &&
        predictionClientSource.includes("row.totalNotionalPoints") &&
        predictionClientSource.includes('unit: row.unit || "PTS"'),
      "PredictionApiClient should normalize order-book levels from point-native fields",
    );
    assert.ok(
      !/pricePoints: pricePoints|quantity: shares|total: cumulativeShares/.test(
        orderBookNormalizer,
      ),
      "normalizeOrderBookLevel should not reattach retired order-book depth aliases",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      marketPageSource.includes("lvl.pricePoints") &&
        marketPageSource.includes("lvl.shares") &&
        marketPageSource.includes("lvl.cumulativeShares") &&
        orderBookSource.includes("pricePoints: number") &&
        orderBookSource.includes("cumulativeShares: number") &&
        !marketPageSource.includes("lvl.pricePointsCents") &&
        !marketPageSource.includes("lvl.priceCents") &&
        !marketPageSource.includes("lvl.quantity") &&
        !marketPageSource.includes("lvl.total"),
      "market detail order-book UI should consume normalized point-native depth fields",
    );
  });

  it("prefers point-native portfolio summary aliases", () => {
    const accountSource = read("account/page.tsx");
    const summaryTypeSource = predictionTypesSource.slice(
      predictionTypesSource.indexOf("export interface PortfolioSummary"),
      predictionTypesSource.indexOf("export interface SettledPositionResult"),
    );
    const summaryNormalizerSource = predictionClientSource.slice(
      predictionClientSource.indexOf("function normalizePortfolioSummary"),
      predictionClientSource.indexOf("function normalizeOrderPreview"),
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      summaryTypeSource.includes("totalValuePoints: number") &&
        summaryTypeSource.includes("portfolioValuePoints: number") &&
        summaryTypeSource.includes("investedPoints: number") &&
        summaryTypeSource.includes("unrealizedPoints: number") &&
        summaryTypeSource.includes("realizedPoints: number") &&
        !summaryTypeSource.includes("totalValuePointsCents") &&
        !summaryTypeSource.includes("totalValueCents") &&
        !summaryTypeSource.includes("unrealizedPnlPoints") &&
        !summaryTypeSource.includes("realizedPnlPoints"),
      "PortfolioSummary should expose point-native summary aliases",
    );
    assert.ok(
      summaryNormalizerSource.includes("normalizePortfolioSummary") &&
        summaryNormalizerSource.includes("row.totalValuePoints") &&
        summaryNormalizerSource.includes("row.portfolioValuePoints") &&
        summaryNormalizerSource.includes("row.unrealizedPoints") &&
        summaryNormalizerSource.includes("row.realizedPoints") &&
        predictionClientSource.includes("type LegacyPortfolioSummary") &&
        !summaryNormalizerSource.includes(
          "totalValuePoints: totalValuePoints",
        ) &&
        !summaryNormalizerSource.includes(
          "unrealizedPnlPoints: unrealizedPoints",
        ) &&
        !summaryNormalizerSource.includes(
          "realizedPnlPoints: realizedPoints",
        ) &&
        summaryNormalizerSource.includes('unit: row.unit || "PTS"'),
      "PredictionApiClient should normalize portfolio summary from point-native aliases",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      portfolioSource.includes("s.totalValuePoints") &&
        portfolioSource.includes("s?.realizedPoints") &&
        accountSource.includes("summary.totalValuePoints") &&
        accountSource.includes("summary.realizedPoints") &&
        !portfolioSource.includes("s.totalValuePointsCents") &&
        !portfolioSource.includes("s.totalValueCents") &&
        !portfolioSource.includes("s?.realizedPnlPoints") &&
        !accountSource.includes("summary.totalValuePointsCents") &&
        !accountSource.includes("summary.totalValueCents") &&
        !accountSource.includes("summary.realizedPnlPoints"),
      "Portfolio/account pages should render summary cards from point-native fields",
    );
  });

  it("prefers point-native portfolio position aliases", () => {
    const positionTypeSource = predictionTypesSource.slice(
      predictionTypesSource.indexOf("export interface Position"),
      predictionTypesSource.indexOf("export interface Trade"),
    );
    const positionNormalizerSource = predictionClientSource.slice(
      predictionClientSource.indexOf("function normalizePosition"),
      predictionClientSource.indexOf("function normalizeSettleMarketResponse"),
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      positionTypeSource.includes("avgPricePoints: number") &&
        positionTypeSource.includes("totalCostPoints: number") &&
        positionTypeSource.includes("realizedPoints: number") &&
        positionTypeSource.includes('unit?: "PTS" | string') &&
        !positionTypeSource.includes("avgPricePointsCents") &&
        !positionTypeSource.includes("avgPriceCents") &&
        !positionTypeSource.includes("totalCostPointsCents") &&
        !positionTypeSource.includes("totalCostCents") &&
        !positionTypeSource.includes("realizedPnlPoints"),
      "Position should expose point-native position price/cost/result aliases",
    );
    assert.ok(
      positionNormalizerSource.includes("normalizePosition") &&
        positionNormalizerSource.includes("row.avgPricePoints") &&
        positionNormalizerSource.includes("row.totalCostPoints") &&
        positionNormalizerSource.includes("row.realizedPoints") &&
        predictionClientSource.includes("LegacyPosition[]") &&
        predictionClientSource.includes("positions.map(normalizePosition)") &&
        !positionNormalizerSource.includes("avgPricePoints: avgPricePoints") &&
        !positionNormalizerSource.includes(
          "totalCostPoints: totalCostPoints",
        ) &&
        !positionNormalizerSource.includes(
          "realizedPnlPoints: realizedPoints",
        ) &&
        positionNormalizerSource.includes('unit: row.unit || "PTS"'),
      "PredictionApiClient should normalize portfolio positions from point-native price/cost/result aliases",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      portfolioSource.includes("p.avgPricePoints") &&
        portfolioSource.includes("p.totalCostPoints") &&
        !portfolioSource.includes("p.avgPricePointsCents") &&
        !portfolioSource.includes("p.avgPriceCents") &&
        !portfolioSource.includes("p.totalCostPointsCents") &&
        !portfolioSource.includes("p.totalCostCents") &&
        !portfolioSource.includes("p.realizedPnlPoints"),
      "Portfolio page should render positions from point-native fields",
    );
  });

  it("prefers point-native order cost aliases", () => {
    const orderTypeSource = predictionTypesSource.slice(
      predictionTypesSource.indexOf("export interface PredictionOrder"),
      predictionTypesSource.indexOf("export interface Position"),
    );
    const orderNormalizerSource = predictionClientSource.slice(
      predictionClientSource.indexOf("function normalizePredictionOrder"),
      predictionClientSource.indexOf("function normalizePosition"),
    );
    assert.ok(
      orderTypeSource.includes("totalCostPoints: number") &&
        orderTypeSource.includes("pricePoints?: number") &&
        orderTypeSource.includes("reservedPoints?: number") &&
        orderTypeSource.includes("capturedPoints?: number") &&
        orderTypeSource.includes("releasedPoints?: number") &&
        orderTypeSource.includes("averageFillPricePoints?: number") &&
        orderTypeSource.includes("filledCostPoints?: number") &&
        orderTypeSource.includes("notionalCapPoints?: number") &&
        // Points unit-model (2026-07-07): single canonical *Points wire key.
        !orderTypeSource.includes("PointsCents") &&
        !orderTypeSource.includes("priceCents") &&
        !orderTypeSource.includes("walletReservationId") &&
        !orderTypeSource.includes("totalCostCents") &&
        !orderTypeSource.includes("filledCostCents") &&
        !orderTypeSource.includes("notionalCapCents"),
      "PredictionOrder should expose point-native order price/cost aliases",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      predictionTypesSource.includes(
        "notionalCapPoints: preferred point-native",
      ) &&
        predictionTypesSource.includes("pricePoints: preferred point-native") &&
        !predictionTypesSource.includes("priceCents?: number") &&
        !predictionTypesSource.includes("notionalCapCents?: number") &&
        !predictionTypesSource.includes("PointsCents") &&
        !predictionTypesSource.includes("transitional compatibility alias"),
      "PlaceOrderRequest should expose only point-native price/cap aliases",
    );
    assert.ok(
      orderNormalizerSource.includes("normalizePredictionOrder") &&
        orderNormalizerSource.includes("row.pricePoints") &&
        orderNormalizerSource.includes("row.averageFillPricePoints") &&
        orderNormalizerSource.includes("row.capturedPoints") &&
        orderNormalizerSource.includes("row.reservedPoints") &&
        orderNormalizerSource.includes("row.notionalCapPoints") &&
        predictionClientSource.includes("LegacyPredictionOrder") &&
        !orderNormalizerSource.includes("pricePoints: pricePoints") &&
        !orderNormalizerSource.includes(
          "averageFillPricePoints: averageFillPricePoints",
        ) &&
        !orderNormalizerSource.includes("totalCostPoints: totalCostPoints") &&
        !orderNormalizerSource.includes("filledCostPoints: filledCostPoints") &&
        !orderNormalizerSource.includes(
          "notionalCapPoints: notionalCapPoints",
        ) &&
        !orderNormalizerSource.includes("walletReservationId") &&
        orderNormalizerSource.includes('unit: row.unit || "PTS"'),
      "PredictionApiClient should normalize orders from point-native aliases",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      portfolioSource.includes("o.totalCostPoints") &&
        !portfolioSource.includes("o.totalCostPointsCents") &&
        !portfolioSource.includes("o.totalCostCents"),
      "Portfolio page should render orders from point-native fields",
    );
    assert.ok(
      !predictionTypesSource.includes("reservedCashPoints?: number") &&
        !predictionTypesSource.includes("capturedCashPoints?: number") &&
        !predictionTypesSource.includes("releasedCashPoints?: number"),
      "PredictionOrder should not expose retired cash-named reservation aliases",
    );
    assert.ok(
      !predictionClientSource.includes("reservedCashPoints: reservedPoints") &&
        !predictionClientSource.includes(
          "capturedCashPoints: capturedPoints",
        ) &&
        !predictionClientSource.includes("releasedCashPoints: releasedPoints"),
      "PredictionApiClient should not reattach retired cash-named order aliases",
    );
  });

  it("prefers point-native order preview aliases", () => {
    const previewTypeSource = predictionTypesSource.slice(
      predictionTypesSource.indexOf("export interface OrderPreview"),
      predictionTypesSource.indexOf("export interface PortfolioSummary"),
    );
    const previewNormalizerSource = predictionClientSource.slice(
      predictionClientSource.indexOf("function normalizeOrderPreview"),
      predictionClientSource.indexOf("function normalizeTrade"),
    );
    assert.ok(
      previewTypeSource.includes("pricePoints: number") &&
        previewTypeSource.includes("totalCostPoints: number") &&
        previewTypeSource.includes("feePoints: number") &&
        previewTypeSource.includes("maxResultPoints: number") &&
        previewTypeSource.includes("maxLossPoints: number") &&
        previewTypeSource.includes("newYesPricePoints: number") &&
        previewTypeSource.includes("newNoPricePoints: number") &&
        predictionTypesSource.includes("totalCostWithFeesPoints?: number") &&
        predictionTypesSource.includes("estimatedSlippagePoints?: number") &&
        // Points unit-model (2026-07-07): single canonical *Points wire key.
        !previewTypeSource.includes("PointsCents") &&
        !previewTypeSource.includes("priceCents") &&
        !previewTypeSource.includes("totalCostCents") &&
        !previewTypeSource.includes("feeCents") &&
        !previewTypeSource.includes("maxProfitPoints") &&
        !previewTypeSource.includes("maxLossCents") &&
        !previewTypeSource.includes("newYesPriceCents") &&
        !previewTypeSource.includes("newNoPriceCents") &&
        !previewTypeSource.includes("averageFillPriceCents") &&
        !previewTypeSource.includes("totalCostWithFeesCents") &&
        !previewTypeSource.includes("estimatedSlippageCents"),
      "OrderPreview should expose point-native cost/result/slippage aliases",
    );
    assert.ok(
      previewNormalizerSource.includes("normalizeOrderPreview") &&
        previewNormalizerSource.includes("row.totalCostPoints") &&
        previewNormalizerSource.includes("row.maxResultPoints") &&
        previewNormalizerSource.includes("row.estimatedSlippagePoints") &&
        predictionClientSource.includes("type LegacyOrderPreview") &&
        !previewNormalizerSource.includes("pricePoints: pricePoints") &&
        !previewNormalizerSource.includes("totalCostPoints: totalCostPoints") &&
        !previewNormalizerSource.includes("feePoints: feePoints") &&
        !previewNormalizerSource.includes("maxProfitPoints: maxResultPoints") &&
        !previewNormalizerSource.includes("maxProfitPoints: maxResultPoints") &&
        !previewNormalizerSource.includes("maxLossPoints: maxLossPoints") &&
        !previewNormalizerSource.includes(
          "newYesPricePoints: newYesPricePoints",
        ) &&
        !previewNormalizerSource.includes(
          "newNoPricePoints: newNoPricePoints",
        ) &&
        !previewNormalizerSource.includes(
          "averageFillPricePoints: averageFillPricePoints",
        ) &&
        !previewNormalizerSource.includes(
          "totalCostWithFeesPoints: totalCostWithFeesPoints",
        ) &&
        !previewNormalizerSource.includes(
          "estimatedSlippagePoints: estimatedSlippagePoints",
        ) &&
        !predictionClientSource.includes("toPointNativeOrderRequest") &&
        !predictionClientSource.includes(
          "notionalCapPoints: req.notionalCapPoints",
        ) &&
        previewNormalizerSource.includes('unit: row.unit || "PTS"'),
      "PredictionApiClient should normalize order previews without preserving request cap shims",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      marketPageSource.includes("quote.newYesPricePoints") &&
        marketPageSource.includes("quote.averageFillPricePoints") &&
        marketPageSource.includes("quote.totalCostWithFeesPoints") &&
        !marketPageSource.includes("quote.newYesPricePointsCents") &&
        !marketPageSource.includes("quote.newYesPriceCents") &&
        !marketPageSource.includes("quote.averageFillPricePointsCents") &&
        !marketPageSource.includes("quote.averageFillPriceCents") &&
        !marketPageSource.includes("quote.totalCostWithFeesPointsCents") &&
        !marketPageSource.includes("quote.totalCostWithFeesCents"),
      "Market detail AMM preview quotes should render from point-native preview fields",
    );
  });

  it("prefers point-native trade tape aliases", () => {
    const tradeTypeSource = predictionTypesSource.slice(
      predictionTypesSource.indexOf("export interface Trade"),
      predictionTypesSource.indexOf("export interface OrderPreview"),
    );
    const tradeNormalizerSource = predictionClientSource.slice(
      predictionClientSource.indexOf("function normalizeTrade"),
      predictionClientSource.indexOf("function normalizePredictionOrder"),
    );
    const recentTradesSource = read("components/prediction/RecentTrades.tsx");
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      tradeTypeSource.includes("pricePoints: number") &&
        tradeTypeSource.includes("feePoints: number") &&
        tradeTypeSource.includes("notionalPoints: number") &&
        tradeTypeSource.includes('unit?: "PTS" | string') &&
        !tradeTypeSource.includes("PointsCents") &&
        !tradeTypeSource.includes("priceCents") &&
        !tradeTypeSource.includes("feeCents"),
      "Trade should expose point-native trade-tape aliases",
    );
    assert.ok(
      tradeNormalizerSource.includes("normalizeTrade") &&
        predictionClientSource.includes("trades.map(normalizeTrade)") &&
        predictionClientSource.includes("type LegacyTrade") &&
        tradeNormalizerSource.includes("row.pricePoints") &&
        tradeNormalizerSource.includes("row.feePoints") &&
        tradeNormalizerSource.includes("row.notionalPoints") &&
        !tradeNormalizerSource.includes("pricePoints: pricePoints") &&
        !tradeNormalizerSource.includes("feePoints: feePoints") &&
        tradeNormalizerSource.includes('unit: row.unit || "PTS"'),
      "PredictionApiClient should normalize trade tape rows from point-native aliases",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    assert.ok(
      recentTradesSource.includes(".pricePoints") &&
        !recentTradesSource.includes(".pricePointsCents") &&
        !recentTradesSource.includes(".priceCents"),
      "RecentTrades should render trade prices from point-native fields",
    );
  });

  it("prefers point-native admin settlement disbursement aliases", () => {
    const settlementNormalizerSource = predictionClientSource.slice(
      predictionClientSource.indexOf(
        "function normalizeSettlementPointDisbursement",
      ),
      predictionClientSource.indexOf(
        "function normalizeSettlementPointDisbursement",
      ) + 1200,
    );
    assert.ok(
      predictionTypesSource.includes("interface SettlementPointDisbursement") &&
        predictionTypesSource.includes(
          "pointDisbursements?: SettlementPointDisbursement[]",
        ) &&
        !predictionTypesSource.includes("payouts?: SettlementPayout[]") &&
        predictionTypesSource.includes("totalSettlementPoints?: number") &&
        predictionTypesSource.includes("settlementPoints?: number") &&
        !predictionTypesSource.includes("totalPayoutPoints?: number"),
      "Settlement admin response types should expose point-native disbursement aliases",
    );
    assert.ok(
      predictionClientSource.includes("normalizeSettleMarketResponse") &&
        predictionClientSource.includes("response.pointDisbursements") &&
        predictionClientSource.includes(
          "normalizeSettlementPointDisbursement",
        ) &&
        predictionClientSource.includes("settlementPoints") &&
        !settlementNormalizerSource.includes("payoutPoints: settlementPoints"),
      "PredictionApiClient should normalize admin settlement responses from point-native aliases",
    );
    assert.ok(
      !predictionClientSource.includes("payouts: pointDisbursements"),
      "PredictionApiClient should not reattach retired settlement payouts arrays",
    );
  });

  it("ships locale JSON for requested pages in every supported language", () => {
    for (const lang of ["en", "zh-Hans", "zh-Hant", "tl", "ms", "id"]) {
      for (const ns of ["portfolio", "leaderboards"]) {
        assert.ok(
          existsSync(
            resolve(appRoot, `../public/static/locales/${lang}/${ns}.json`),
          ),
          `${lang}/${ns}.json should exist`,
        );
      }
    }
  });

  it("does not ship mostly-English fallback copy for SEA full-page locales", () => {
    const allowedSharedStrings = new Set([
      "YES",
      "NO",
      "pts",
      "Portfolio",
      "Rewards Center",
      "Leaderboards",
    ]);

    for (const namespace of criticalPageNamespaces) {
      const english = readLocale("en", namespace);
      for (const lang of ["tl", "ms", "id"]) {
        const localized = readLocale(lang, namespace);
        const comparable = Object.entries(english).filter(([, value]) => {
          const trimmed = value.trim();
          return (
            trimmed.length >= 3 &&
            !allowedSharedStrings.has(trimmed) &&
            !/^{{[^}]+}}/.test(trimmed)
          );
        });
        const identical = comparable.filter(
          ([key, value]) => localized[key]?.trim() === value.trim(),
        );
        const identicalRatio = identical.length / comparable.length;

        assert.ok(
          identicalRatio <= 0.25,
          `${lang}/${namespace}.json has too much English fallback copy: ${identical.length}/${comparable.length} identical strings`,
        );
      }
    }
  });
});
