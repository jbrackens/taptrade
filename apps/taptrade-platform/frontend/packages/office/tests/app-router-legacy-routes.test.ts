import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const officeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const loadTranslationModule = createRequire(import.meta.url);
const launchUnsafeTranslationValuePattern =
  /\b(?:deposit|withdrawals?|cash(?:ier|out)?|casino|crypto|fiat|redeem(?:able)?|prizes?|wagers?|wagering|stakes?|refunds?|payouts?|payments?|payment|usd|dollars?|wallet|freebets?|cents?)\b|\$/i;

function exists(rel: string): boolean {
  return existsSync(resolve(officeRoot, rel));
}

function read(rel: string): string {
  return readFileSync(resolve(officeRoot, rel), "utf-8");
}

function walkFiles(rel: string): string[] {
  const abs = resolve(officeRoot, rel);
  if (!existsSync(abs)) {
    return [];
  }
  const stat = statSync(abs);
  if (stat.isFile()) {
    return [rel];
  }
  const files: string[] = [];
  for (const entry of readdirSync(abs)) {
    files.push(...walkFiles(`${rel}/${entry}`));
  }
  return files;
}

function collectTranslationValues(
  value: unknown,
  source: string,
  keyPath: string,
  out: Array<{ source: string; keyPath: string; value: string }>,
): void {
  if (typeof value === "string") {
    out.push({ source, keyPath, value });
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    collectTranslationValues(
      child,
      source,
      keyPath ? `${keyPath}.${key}` : key,
      out,
    );
  }
}

describe("legacy office Pages Router entrypoints", () => {
  const retiredPages = [
    "pages/index.tsx",
    "pages/logs/index.tsx",
    "pages/not-authorized/index.tsx",
    "pages/terms-and-conditions/index.tsx",
    "pages/account/settings/index.tsx",
    "pages/account/security/index.tsx",
  ];

  it("keeps user-facing legacy routes out of the Pages Router", () => {
    for (const rel of retiredPages) {
      expect(exists(rel), `${rel} should stay retired`).toBe(false);
    }
  });

  it("replaces retired entrypoints with App Router routes", () => {
    for (const rel of [
      "app/page.tsx",
      "app/logs/page.tsx",
      "app/not-authorized/page.tsx",
      "app/terms-and-conditions/page.tsx",
      "app/account/settings/page.tsx",
      "app/account/security/page.tsx",
      "app/(dashboard)/prediction-admin/activity/page.tsx",
      "app/(dashboard)/prediction-admin/taxonomy/page.tsx",
    ]) {
      expect(exists(rel), `${rel} should exist`).toBe(true);
    }
  });

  it("preserves scoped audit-log filters on /logs redirects", () => {
    const logsPage = read("app/logs/page.tsx");
    expect(logsPage).toContain("new URLSearchParams");
    expect(logsPage).toContain("query.append");
    expect(logsPage).toContain("redirect(`/audit-logs");
  });
});

describe("retired App Router sportsbook and prototype surfaces", () => {
  it("keeps beta-hidden dead dashboard routes as redirects", () => {
    const redirects = [
      ["app/(dashboard)/campaigns/page.tsx", 'redirect("/dashboard")'],
      ["app/(dashboard)/reports/page.tsx", 'redirect("/dashboard")'],
      [
        "app/(dashboard)/risk-management/page.tsx",
        'redirect("/prediction-admin/risk")',
      ],
    ] as const;

    for (const [rel, redirectCall] of redirects) {
      expect(read(rel), `${rel} should remain a redirect`).toContain(
        redirectCall,
      );
    }
  });

  it("keeps sportsbook-era dashboard widgets out of source", () => {
    for (const rel of [
      "app/components/dashboard/ActiveBetsWidget.tsx",
      "app/components/dashboard/LiveMatchesWidget.tsx",
      "app/components/dashboard/RevenueWidget.tsx",
      "app/components/dashboard/RiskAlertsWidget.tsx",
      "app/components/dashboard/RecentActivityWidget.tsx",
      "app/hooks/useTradingWebSocket.ts",
    ]) {
      expect(exists(rel), `${rel} should stay retired`).toBe(false);
    }
  });

  it("keeps active barrels limited to prediction-safe exports", () => {
    const dashboardBarrel = read("app/components/dashboard/index.ts");
    expect(dashboardBarrel).toContain(
      'export { DashboardLayout } from "./DashboardLayout"',
    );
    for (const retiredExport of [
      "RevenueWidget",
      "ActiveBetsWidget",
      "LiveMatchesWidget",
      "RiskAlertsWidget",
      "RecentActivityWidget",
    ]) {
      expect(dashboardBarrel).not.toContain(retiredExport);
    }

    const hooksBarrel = read("app/hooks/index.ts");
    expect(hooksBarrel).toContain('export { useConfirm } from "./useConfirm"');
    expect(hooksBarrel).not.toContain("useTradingWebSocket");
  });

  it("keeps launch-prohibited cashier/payment admin surfaces retired", () => {
    const dashboardLayout = read("app/(dashboard)/layout.tsx");
    const appLayout = read("app/layout.tsx");

    for (const rel of [
      "app/(dashboard)/cashier/page.tsx",
      "containers/provider-ops/cashier-review.tsx",
      "components/users/wallet/table-actions/index.tsx",
      "components/users/wallet/table-actions/index.styled.ts",
      "components/users/transaction-modal/index.tsx",
    ]) {
      expect(exists(rel), `${rel} should stay retired`).toBe(false);
    }

    expect(dashboardLayout).not.toContain('href: "/cashier"');
    expect(dashboardLayout).not.toContain('label: "Cashier"');
    expect(appLayout).toContain("AppRouterProviders");
  });

  it("does not expose prohibited money path segments in office app routes", () => {
    const routeFiles = walkFiles("app").filter((rel) =>
      /\/(?:page|route)\.tsx?$/.test(rel),
    );
    const prohibitedSegment =
      /(^|\/)(cashier|cashout|crypto|deposit|deposits|fiat|payment|payments|prize|prizes|redeem|redemption|withdraw|withdrawal|withdrawals)(\/|$)/i;
    const offenders = routeFiles.filter((rel) =>
      prohibitedSegment.test(rel.replace(/^app\//, "")),
    );

    expect(offenders).toEqual([]);
  });

  it("returns retired money paths as absent before office auth redirects", () => {
    const proxySource = read("proxy.ts");

    expect(proxySource).toContain("RETIRED_MONEY_ROUTE_PATTERN");
    expect(proxySource).toContain("isRetiredMoneyRoute(pathname)");
    expect(proxySource).toContain(
      'new NextResponse("Not found", { status: 404 })',
    );
    expect(proxySource.indexOf("isRetiredMoneyRoute(pathname)")).toBeLessThan(
      proxySource.indexOf('pathname.startsWith("/auth/")'),
    );
  });

  it("does not ship launch admin code that calls cashier or payment operation endpoints", () => {
    const sourceFiles = [
      ...walkFiles("app"),
      ...walkFiles("components"),
      ...walkFiles("containers"),
      ...walkFiles("lib"),
      ...walkFiles("providers"),
      ...walkFiles("translations"),
      ...walkFiles("public/static/locales"),
    ].filter((rel) => /\.(ts|tsx|js|jsx|json)$/.test(rel));

    const banned = [
      'href: "/cashier"',
      "/api/v1/admin/cashier",
      "admin/cashier/alpha",
      "admin/payments/transactions",
      "cashier-review",
    ];

    for (const rel of sourceFiles) {
      const source = read(rel);
      for (const token of banned) {
        expect(source, `${rel} should not contain ${token}`).not.toContain(
          token,
        );
      }
    }
  });

  it("keeps user ledger admin surfaces points-only and inspection-first", () => {
    const usersList = read("app/(dashboard)/users/page.tsx");
    const userDetail = read("app/(dashboard)/users/[id]/page.tsx");
    const profile = read("app/components/users/PunterProfile.tsx");
    const legacyLedger = read("components/users/wallet/index.tsx");
    const legacyExport = read("components/users/wallet/export/index.tsx");
    const header = read("components/users/header/index.tsx");
    const transactionCopy = read("translations/en/page-transactions.js");
    const userDetailsCopy = read("translations/en/page-users-details.js");

    expect(userDetailsCopy).toContain(
      'HEADER_PREDICTION_TRADES_HISTORY: "Prediction Trades"',
    );
    expect(userDetailsCopy).toContain(
      'HEADER_CARD_FINANCIAL_SUMMARY_OPEN_POSITIONS: "Open Positions"',
    );
    expect(userDetailsCopy).toContain('ACTION_CANCEL_ORDER: "Cancel Order"');
    expect(userDetailsCopy).not.toContain("HEADER_BETS_HISTORY");
    expect(userDetailsCopy).not.toContain(
      "HEADER_CARD_FINANCIAL_SUMMARY_OPEN_BETS",
    );
    expect(userDetailsCopy).not.toContain("ACTION_CANCEL_BET");
    expect(transactionCopy).toContain('CELL_TYPE_PREDICTION: "Prediction"');
    expect(transactionCopy).not.toContain("CELL_TYPE_BET");

    expect(profile).toContain("Point Balance");
    expect(profile).toContain("Portfolio Points");
    expect(profile).toContain("Point Ledger");
    expect(profile).toContain('"trades"');
    expect(profile).toContain('setActiveTab("trades")');
    expect(profile).toContain("wholePoints");
    expect(profile).toContain("realizedPoints");
    expect(profile).toContain("settlementPoints");
    expect(profile).toContain("amountPoints");
    expect(profile).toContain("balancePoints");
    expect(profile).not.toContain("Wallet & Transactions");
    expect(profile).not.toContain("Wallet Balance");
    expect(profile).not.toContain("money(");
    expect(profile).not.toContain("signedCents");
    expect(profile).not.toContain("positiveMoneyClassName");
    expect(profile).not.toContain("pnlCents");
    expect(profile).not.toContain("payoutCents");
    expect(profile).not.toContain("amountCents");
    expect(profile).not.toContain("balanceCents");
    expect(profile).not.toContain('activeTab === "bets"');
    expect(profile).not.toContain('setActiveTab("bets")');

    expect(usersList).toContain("pointAccountBalancePoints");
    expect(usersList).toContain("realizedPoints");
    expect(usersList).not.toContain("walletBalanceCents");
    expect(usersList).not.toContain("realizedPnlCents");

    expect(userDetail).toContain("pointAccountBalancePoints");
    expect(userDetail).toContain("portfolioValuePoints");
    expect(userDetail).toContain("realizedPoints");
    expect(userDetail).toContain("unrealizedPoints");
    expect(userDetail).toContain("amountPoints");
    expect(userDetail).toContain("balancePoints");
    expect(userDetail).not.toContain("walletBalanceCents");
    expect(userDetail).not.toContain("realizedPnlCents");
    expect(userDetail).not.toContain("unrealizedPnlCents");
    expect(userDetail).not.toContain("amountCents");
    expect(userDetail).not.toContain("balanceCents");

    expect(legacyLedger).toContain("formatLedgerPoints");
    expect(legacyLedger).toContain("HEADER_POINT_LEDGER_ID");
    expect(legacyLedger).not.toContain("HEADER_TRANSACTION_METHOD");
    expect(legacyLedger).not.toContain("paymentMethod");

    expect(legacyExport).toContain("Point Ledger -");
    expect(header).not.toContain("DollarCircleOutlined");
    expect(header).not.toContain("ACTION_TRANSACTION");

    const retiredBetCancel = read("components/users/bets/cancel/index.tsx");
    expect(retiredBetCancel).toContain("UserPredictionOrderCancel");
    expect(retiredBetCancel).not.toContain("admin/bets");
    expect(retiredBetCancel).not.toContain("page-bets");
    expect(retiredBetCancel).not.toContain("useApi");
    expect(retiredBetCancel).not.toContain("cancellationReason");

    const limitsUpdate = read("components/users/limits/update.tsx");
    const limitsHistory = read("components/users/limits-history/index.tsx");
    const punterTypes = read("types/punters.ts");
    expect(limitsUpdate).toContain('unit="pts"');
    expect(limitsUpdate).toContain("unitAsPrefix={false}");
    expect(limitsUpdate).toContain('"pointAdd"');
    expect(limitsUpdate).toContain('"pointUse"');
    expect(limitsUpdate).toContain("values.pointAdd");
    expect(limitsUpdate).toContain("values.pointUse");
    expect(limitsUpdate).toContain("[OfficePunterLimitsTypesEnum.POINT_ADD]");
    expect(limitsUpdate).toContain("[OfficePunterLimitsTypesEnum.POINT_USE]");
    expect(limitsUpdate).not.toContain('unit="$"');
    expect(limitsUpdate).not.toContain("editables.deposits");
    expect(limitsUpdate).not.toContain("values.deposits");
    expect(limitsUpdate).not.toContain("HEADER_CARD_LIMITS_DEPOSIT");
    expect(limitsUpdate).not.toContain("editables.stake");
    expect(limitsUpdate).not.toContain("values.losses");
    expect(limitsUpdate).not.toContain('field="losses"');
    expect(limitsUpdate).not.toContain("OfficePunterLimitsTypesEnum.STAKE");
    expect(limitsUpdate).not.toContain("HEADER_CARD_LIMITS_STAKE");
    expect(limitsUpdate).not.toContain("HEADER_CARD_LIMITS_LOSS");
    expect(punterTypes).toContain('POINT_ADD = "deposits"');
    expect(punterTypes).toContain('POINT_USE = "stake"');
    expect(punterTypes).toContain('POINT_ADD_AMOUNT = "DEPOSIT_AMOUNT"');
    expect(punterTypes).toContain('PREDICTION_POINT_AMOUNT = "STAKE_AMOUNT"');
    expect(punterTypes).not.toContain("DEPOSITS =");
    expect(punterTypes).not.toContain("STAKE =");
    expect(punterTypes).not.toContain("DEPOSIT_AMOUNT =");
    expect(punterTypes).not.toContain("STAKE_AMOUNT =");
    expect(punterTypes).not.toContain("OfficePunterLimitsTypesEnum.STAKE");
    expect(limitsHistory).toContain("limitTypeTranslationKey");
    expect(limitsHistory).toContain("LIMIT_TYPE_POINT_ADD_AMOUNT");
    expect(limitsHistory).toContain("LIMIT_TYPE_PREDICTION_POINT_AMOUNT");
    expect(limitsHistory).not.toContain("page-users-details:${limitType}");
    expect(userDetailsCopy).toContain(
      'HEADER_CARD_FINANCIAL_SUMMARY_LIFETIME_POINTS_ADDED: "Lifetime Points Added"',
    );
    expect(userDetailsCopy).toContain(
      'HEADER_CARD_FINANCIAL_SUMMARY_LIFETIME_POINTS_USED: "Lifetime Points Used"',
    );
    expect(userDetailsCopy).toContain(
      'HEADER_CARD_FINANCIAL_SUMMARY_PENDING_POINT_USE: "Pending Point Use"',
    );
    expect(userDetailsCopy).toContain(
      "HEADER_CARD_FINANCIAL_SUMMARY_LEGACY_SPORTS_FEED_EXPOSURE",
    );
    expect(userDetailsCopy).toContain("Legacy Sports Feed Open Exposure");
    expect(userDetailsCopy).not.toContain(
      "HEADER_CARD_FINANCIAL_SUMMARY_LIFETIME_DEPOSITS",
    );
    expect(userDetailsCopy).not.toContain(
      "HEADER_CARD_FINANCIAL_SUMMARY_LIFETIME_WITHDRAWALS",
    );
    expect(userDetailsCopy).not.toContain(
      "HEADER_CARD_FINANCIAL_SUMMARY_PENDING_WITHDRAWALS",
    );
    expect(userDetailsCopy).not.toContain(
      "HEADER_CARD_FINANCIAL_SUMMARY_SPORTSBOOK_EXPOSURE",
    );
    expect(userDetailsCopy).not.toContain("Sportsbook Open Exposure");
    expect(userDetailsCopy).toContain(
      'HEADER_CARD_LIMITS_POINT_ADD: "Point Add"',
    );
    expect(userDetailsCopy).not.toContain("HEADER_CARD_LIMITS_DEPOSIT");
    expect(userDetailsCopy).toContain(
      'HEADER_CARD_LIMITS_POINT_USE: "Point Use"',
    );
    expect(userDetailsCopy).not.toContain("HEADER_CARD_LIMITS_LOSS");
    expect(userDetailsCopy).toContain(
      'LIMIT_TYPE_POINT_ADD_AMOUNT: "Point add amount"',
    );
    expect(userDetailsCopy).toContain(
      'LIMIT_TYPE_PREDICTION_POINT_AMOUNT: "Prediction point amount"',
    );
    expect(userDetailsCopy).not.toContain('DEPOSIT_AMOUNT: "Point add amount"');
    expect(userDetailsCopy).not.toContain(
      'STAKE_AMOUNT: "Prediction point amount"',
    );

    expect(transactionCopy).toContain("Legacy sports feed");

    for (const source of [transactionCopy, userDetailsCopy]) {
      expect(source).not.toContain("Payment method");
      expect(source).not.toContain("Deposit");
      expect(source).not.toContain("Withdrawal");
      expect(source).not.toContain("Manual Payment");
      expect(source).not.toContain("Credit Card");
      expect(source).not.toContain("Cash");
      expect(source).not.toContain("Cheque");
    }
  });

  it("keeps rendered office translation values inside the points-only boundary", () => {
    const translationFiles = walkFiles("translations/en")
      .filter((rel) => rel.endsWith(".js"))
      .sort();
    const values: Array<{ source: string; keyPath: string; value: string }> =
      [];

    for (const rel of translationFiles) {
      collectTranslationValues(
        loadTranslationModule(resolve(officeRoot, rel)),
        rel,
        "",
        values,
      );
    }

    const unsafeValues = values.filter(({ value }) =>
      launchUnsafeTranslationValuePattern.test(value),
    );

    expect(unsafeValues).toEqual([]);
  });

  it("keeps audit-log rendered action labels prediction-native", () => {
    const auditLogTranslations = loadTranslationModule(
      resolve(officeRoot, "translations/en/page-audit-logs.js"),
    );

    expect(auditLogTranslations).toMatchObject({
      FILTER_ODDS_BOOST_PLACEHOLDER: "Point boost rule ID",
      HEADER_ODDS_BOOST: "Point boost",
      CELL_ACTION_PREDICTION_ORDER_PLACED: "Prediction placed",
      CELL_ACTION_PREDICTION_ORDER_PRECHECK_FAILED:
        "Prediction precheck failed",
      CELL_PRODUCT_SPORTSBOOK: "Legacy sports feed",
    });
    expect(Object.keys(auditLogTranslations)).not.toContain(
      "CELL_ACTION_BET_PLACED",
    );
    expect(Object.keys(auditLogTranslations)).not.toContain(
      "CELL_ACTION_BET_PRECHECK_FAILED",
    );
    expect(Object.values(auditLogTranslations)).not.toContain("Odds boost ID");
    expect(Object.values(auditLogTranslations)).not.toContain("Odds boost");
    expect(Object.values(auditLogTranslations)).not.toContain("Bet placed");
    expect(Object.values(auditLogTranslations)).not.toContain(
      "Bet precheck failed",
    );
    expect(Object.values(auditLogTranslations)).not.toContain("Sportsbook");
  });

  it("keeps provider-ops intervention labels prediction-native", () => {
    const providerOpsTranslations = loadTranslationModule(
      resolve(officeRoot, "translations/en/page-provider-ops.js"),
    );

    expect(providerOpsTranslations).toMatchObject({
      FIELD_BET_ID: "Prediction ID",
      BET_INTERVENTION_TITLE: "Prediction settlement intervention",
      BET_FIELD_BET_ID: "Prediction ID",
      BET_ACTION_OPEN_AUDIT: "Open prediction intervention audit logs",
      BET_LAST_BET_ID: "Prediction ID",
      BET_LAST_STATUS: "Prediction status",
    });
    expect(Object.values(providerOpsTranslations)).not.toContain("Bet ID");
    expect(Object.values(providerOpsTranslations)).not.toContain(
      "Bet settlement intervention",
    );
    expect(Object.values(providerOpsTranslations)).not.toContain(
      "Open bet intervention audit logs",
    );
    expect(Object.values(providerOpsTranslations)).not.toContain("Bet status");
  });

  it("keeps remaining English office translation values off bet wording", () => {
    const translationFiles = walkFiles("translations/en")
      .filter((rel) => rel.endsWith(".js"))
      .sort();
    const values: Array<{ source: string; keyPath: string; value: string }> =
      [];

    for (const rel of translationFiles) {
      collectTranslationValues(
        loadTranslationModule(resolve(officeRoot, rel)),
        rel,
        "",
        values,
      );
    }

    const retiredBetValues = values.filter(({ value }) =>
      /\bbets?\b|\bbetting\b|\bbettable\b|cashed out/i.test(value),
    );

    expect(retiredBetValues).toEqual([]);
  });

  it("keeps English office translation values off sportsbook odds wording", () => {
    const translationFiles = walkFiles("translations/en")
      .filter((rel) => rel.endsWith(".js"))
      .sort();
    const values: Array<{ source: string; keyPath: string; value: string }> =
      [];

    for (const rel of translationFiles) {
      collectTranslationValues(
        loadTranslationModule(resolve(officeRoot, rel)),
        rel,
        "",
        values,
      );
    }

    const retiredOddsValues = values.filter(({ value }) =>
      /\bodds?\b|\bodd\b/i.test(value),
    );

    expect(retiredOddsValues).toEqual([]);
  });

  it("keeps English office translation values off active sportsbook wording", () => {
    const translationFiles = walkFiles("translations/en")
      .filter((rel) => rel.endsWith(".js"))
      .sort();
    const values: Array<{ source: string; keyPath: string; value: string }> =
      [];

    for (const rel of translationFiles) {
      collectTranslationValues(
        loadTranslationModule(resolve(officeRoot, rel)),
        rel,
        "",
        values,
      );
    }

    const retiredSportsbookValues = values.filter(({ value }) =>
      /\bsportsbook\b/i.test(value),
    );

    expect(retiredSportsbookValues).toEqual([]);
  });

  it("keeps current office admin README surfaces point-native", () => {
    const readme = read("README.md");
    const currentAdminSurfaces = readme.slice(
      readme.indexOf("## Current Admin Surfaces"),
      readme.indexOf("### Dev-mode auth"),
    );

    expect(currentAdminSurfaces).toContain("point-native Tap Trade");
    expect(currentAdminSurfaces).toContain("point-ledger inspection");
    expect(currentAdminSurfaces).not.toMatch(
      /\b(?:sportsbook|cashier|deposit|withdrawals?|cashout|fiat|crypto|redeem(?:able)?|prizes?|wagers?|wagering|stakes?|refunds?|payouts?|payments?)\b|\$/i,
    );
  });

  it("keeps active office navigation and risk comments Tap Trade-native", () => {
    const activeCommentSources = [
      "providers/menu/structure.ts",
      "providers/menu/defaults.ts",
      "app/(dashboard)/prediction-admin/risk/page.tsx",
      "next.config.js",
    ];

    for (const rel of activeCommentSources) {
      const source = read(rel);
      expect(
        source,
        `${rel} should avoid inherited source-comment wording`,
      ).not.toMatch(
        /\bsportsbook\b|freebet|odds-boost|bet\/stake|fixture exposure/i,
      );
    }
  });

  it("keeps social report moderation wired to prediction-native admin APIs", () => {
    const dashboardLayout = read("app/(dashboard)/layout.tsx");
    const moderationPage = read("app/(dashboard)/social-moderation/page.tsx");

    expect(dashboardLayout).toContain('href: "/social-moderation"');
    expect(dashboardLayout).toContain('label: "Social Reports"');
    expect(moderationPage).toContain("/api/v1/admin/social/reports");
    expect(moderationPage).toContain("DownloadOutlined");
    expect(moderationPage).toContain("format=csv");
    expect(moderationPage).toContain("social-reports-${status}.csv");
    expect(moderationPage).toContain("Export CSV");
    expect(moderationPage).toContain("Mark reviewed");
    expect(moderationPage).toContain("Dismiss");
  });

  it("keeps prediction activity export wired to real social activity APIs", () => {
    const dashboardLayout = read("app/(dashboard)/layout.tsx");
    const activityPage = read(
      "app/(dashboard)/prediction-admin/activity/page.tsx",
    );

    expect(dashboardLayout).toContain('href: "/prediction-admin/activity"');
    expect(dashboardLayout).toContain('label: "Activity Export"');
    expect(activityPage).toContain("/api/v1/admin/social/activity");
    expect(activityPage).toContain('format", format');
    expect(activityPage).toContain("prediction-social-activity.csv");
    expect(activityPage).toContain("DownloadOutlined");
    expect(activityPage).toContain("Export CSV");
    expect(activityPage).toContain("comments, follows");
    expect(activityPage).toContain("trades, settlements");
    expect(activityPage).toContain("leaderboard movement");
  });

  it("keeps reward cluster review wired to hashed point-reward evidence", () => {
    const dashboardLayout = read("app/(dashboard)/layout.tsx");
    const rewardClusters = read(
      "app/(dashboard)/prediction-admin/reward-clusters/page.tsx",
    );

    expect(dashboardLayout).toContain(
      'href: "/prediction-admin/reward-clusters"',
    );
    expect(dashboardLayout).toContain('label: "Reward Clusters"');
    expect(rewardClusters).toContain("/api/v1/admin/wallet/reward-clusters");
    expect(rewardClusters).toContain('buildQuery(windowDate, limit, "csv")');
    expect(rewardClusters).toContain("Signal hash");
    expect(rewardClusters).toContain("Affected user IDs");
    expect(rewardClusters).toContain("PTS");
    expect(rewardClusters).toContain("Raw");
    expect(rewardClusters).toContain("device and IP values are not returned");
    expect(rewardClusters).toContain("this evidence is not");
    expect(rewardClusters).toContain("point-ledger movement");
    expect(rewardClusters).not.toContain("Deposit");
    expect(rewardClusters).not.toContain("Withdrawal");
    expect(rewardClusters).not.toContain("cashout");
    expect(rewardClusters).not.toContain("wallet address");
  });

  it("keeps prediction admin lifecycle surfaces launch-facing and points-only", () => {
    const dashboardLayout = read("app/(dashboard)/layout.tsx");
    const dashboard = read("app/(dashboard)/dashboard/page.tsx");
    const disputes = read("app/(dashboard)/disputes/page.tsx");
    const markets = read("containers/prediction-markets/index.tsx");
    const settlements = read("containers/prediction-settlements/index.tsx");
    const taxonomy = read("containers/prediction-taxonomy/index.tsx");
    const risk = read("app/(dashboard)/prediction-admin/risk/page.tsx");

    expect(dashboardLayout).toContain('href: "/prediction-admin/taxonomy"');
    expect(dashboardLayout).toContain('label: "Taxonomy"');

    expect(dashboard).toContain("formatPoints");
    expect(dashboard).toContain("volume.totalVolumePoints");
    expect(dashboard).toContain("mv.yesPricePointsNow");
    expect(dashboard).toContain("mv.yesPricePointsStart");
    expect(dashboard).not.toContain("formatUsd");
    expect(dashboard).not.toContain("totalVolumeCents");
    expect(dashboard).not.toContain("yesPriceCentsStart");
    expect(dashboard).not.toContain("yesPriceCentsNow");
    expect(dashboard).not.toContain("volumeCents");

    expect(disputes).toContain("returns locked points");
    expect(disputes).toContain("return locked points");
    expect(disputes).toContain("locked points are returned");
    expect(disputes).toContain("Uphold, void & return points");
    expect(disputes).toContain("bondPoints");
    expect(disputes).toContain('unit: "PTS"');
    expect(disputes).not.toContain("refunds all stakes");
    expect(disputes).not.toContain("refund all stakes");
    expect(disputes).not.toContain("every stake is refunded");
    expect(disputes).not.toContain("void & refund");
    expect(disputes).not.toContain("bondCents");

    expect(markets).toContain("getAdminMarkets");
    expect(markets).toContain("updateMarket");
    expect(markets).toContain("Edit Market");
    expect(markets).toContain("Save edits");
    expect(markets).toContain("Market edited");
    expect(markets).toContain("dateTimeLocalToApi");
    expect(markets).toContain("return `${raw}:00Z`");
    expect(markets).toContain("describeTapTradeMarketLifecycle");
    expect(markets).toContain("getMarketLifecycleAudit");
    expect(markets).toContain("exportMarketLifecycleAudit");
    expect(markets).toContain("exportAdminMarkets");
    expect(markets).toContain("Prediction Markets.csv");
    expect(markets).toContain("Lifecycle Audit");
    expect(markets).toContain("Export CSV");
    expect(markets).toContain("Pause");
    expect(markets).toContain("Invalidate");
    expect(markets).toContain("formatPoints");
    expect(markets).toContain("maxDriftPoints");
    expect(markets).toContain("ammSubsidyPoints");
    expect(markets).toContain("Locked points are returned at entry cost");
    expect(markets).toContain("returning locked points");
    expect(markets).not.toContain("formatUsd");
    expect(markets).not.toContain("maxDriftCents");
    expect(markets).not.toContain("ammSubsidyCents");
    expect(markets).not.toContain("refunded in gameplay points");
    expect(markets).not.toContain("refunding positions");

    expect(settlements).toContain("describeTapTradeMarketLifecycle");
    expect(settlements).toContain("replayIncompleteSettlements");
    expect(settlements).toContain("Replay Points");
    expect(settlements).toContain("pointDisbursements");
    expect(settlements).toContain("point disbursements");
    expect(settlements).not.toContain("Replay Payouts");
    expect(settlements).toContain("formatPoints");
    expect(settlements).toContain("maxDriftPoints");
    expect(settlements).toContain("Settle");
    expect(settlements).not.toContain("formatUsd");
    expect(settlements).not.toContain("maxDriftCents");
    expect(settlements).not.toContain("$0.");

    expect(taxonomy).toContain("getAdminCategories");
    expect(taxonomy).toContain("createCategory");
    expect(taxonomy).toContain("getAdminSeries");
    expect(taxonomy).toContain("createSeries");
    expect(taxonomy).toContain("getAdminTags");
    expect(taxonomy).toContain("Create Category");
    expect(taxonomy).toContain("Create Series");

    expect(risk).toContain("Point accounting invariants");
    expect(risk).toContain("formatPoints");
    expect(risk).toContain("/api/v1/admin/prediction/risk?format=csv");
    expect(risk).toContain("prediction-risk-snapshot.csv");
    expect(risk).toContain("Export CSV");
    expect(risk).toContain("Reserved points");
    expect(risk).toContain("pointAccounting");
    expect(risk).toContain("openPositionPointCostPoints");
    expect(risk).toContain("maxSettlementPoints");
    expect(risk).toContain("reservedPoints");
    expect(risk).toContain("openPointCostPoints");
    expect(risk).toContain("maxReturnedPoints");
    expect(risk).toContain("Point-cost concentration");
    expect(risk).not.toContain("formatCents");
    expect(risk).not.toContain('style: "currency"');
    expect(risk).not.toContain('currency: "USD"');
    expect(risk).not.toContain("Money invariants");
    expect(risk).not.toContain("moneyInvariants");
    expect(risk).not.toContain("openPositionCostCents");
    expect(risk).not.toContain("maxSettlementLiabilityCents");
    expect(risk).not.toContain("reservedCashCents");
    expect(risk).not.toContain("openCostCents");
    expect(risk).not.toContain("maxPayoutLiabilityCents");
    expect(risk).not.toContain("Reserved (held) cash");
  });

  it("keeps leaderboard and loyalty admin copy point-native", () => {
    const dashboardLayout = read("app/(dashboard)/layout.tsx");
    const leaderboards = read("app/(dashboard)/leaderboards/page.tsx");
    const leaderboardDetail = read(
      "app/(dashboard)/leaderboards/[id]/page.tsx",
    );
    const loyaltySettings = read("app/(dashboard)/loyalty/settings/page.tsx");
    const loyaltyList = read("app/(dashboard)/loyalty/page.tsx");
    const loyaltyDetail = read("app/(dashboard)/loyalty/[id]/page.tsx");

    expect(dashboardLayout).toContain('href: "/leaderboards"');
    expect(dashboardLayout).toContain('href: "/loyalty"');

    for (const source of [leaderboards, leaderboardDetail]) {
      expect(source).toContain("net_points");
      expect(source).toContain("PTS");
      expect(source).toContain("Reward Summary");
      expect(source).toContain("normalizePointUnit");
      expect(source).toContain("rewardSummary");
      expect(source).toContain("unit:");
      expect(source).not.toContain("currency");
      expect(source).not.toContain("prizeSummary");
      expect(source).not.toContain("Prize Summary");
    }

    expect(leaderboards).toContain('placeholder="weekly-points-race"');
    expect(leaderboards).not.toContain("weekly-profit-race");
    expect(leaderboards).toContain("row.pointMetricKey");
    expect(leaderboards).toContain("toLegacyMetricKey(form.metricKey)");
    expect(leaderboardDetail).toContain("nextDefinition.pointMetricKey");
    expect(leaderboardDetail).toContain("nextDefinition.rewardSummary");
    expect(leaderboardDetail).toContain("toLegacyMetricKey(form.metricKey)");

    expect(loyaltySettings).toContain("prediction_settlement");
    expect(loyaltySettings).toContain("toLegacyLoyaltySourceType");
    expect(loyaltySettings).toContain("normalizeLoyaltyRule");
    expect(loyaltySettings).toContain("predictionSourceType");
    expect(loyaltySettings).toContain("minQualifiedPoints");
    expect(loyaltySettings).toContain("eligiblePredictionTypes");
    expect(loyaltySettings).toContain("Min Qualified Points (point units)");
    expect(loyaltySettings).toContain("prediction-settlement accrual rules");
    expect(loyaltySettings).toContain("point_bonus_rate");
    expect(loyaltySettings).not.toContain("cashback_rate");
    expect(loyaltySettings).not.toContain("settled-bet");
    expect(loyaltySettings).not.toContain("Min Qualified Stake (cents)");
    for (const source of [loyaltyList, loyaltyDetail]) {
      expect(source).toContain("rankName");
      expect(source).toContain("xpToNextRank");
      expect(source).not.toContain("currentTier");
      expect(source).not.toContain("nextTier");
      expect(source).not.toContain("pointsToNextTier");
    }
    expect(loyaltyList).toContain('params.set("rankName"');
    expect(loyaltyList).not.toContain('params.set("tierCode"');
    expect(loyaltyDetail).toContain("Settled prediction reward");
    expect(loyaltyDetail).toContain("predictionSourceType");
    expect(loyaltyDetail).toContain("predictionSourceId");
    expect(loyaltyDetail).not.toContain("Settled bet reward");
  });

  it("keeps user recent activity point-native", () => {
    const normalizer = read("lib/utils/recent-activities.ts");
    const item = read("components/users/recent-activity/item/index.tsx");

    expect(normalizer).toContain('const POINT_UNIT = "PTS"');
    expect(normalizer).toContain("normalizePointUnit");
    expect(normalizer).toContain("unit: normalizePointUnit");
    expect(normalizer).toContain("PREDICTION_ORDER");
    expect(normalizer).toContain("PREDICTION_RESULT");
    expect(normalizer).not.toContain("CURRENCY_SYMBOLS");
    expect(normalizer).not.toContain("normalizeCurrency");
    expect(normalizer).not.toContain('USD: "$"');
    expect(normalizer).not.toContain('GBP: "£"');

    expect(item).toContain("formatPointTag");
    expect(item).toContain("PREDICTION_ORDER");
    expect(item).toContain("PREDICTION_RESULT");
    expect(item).not.toContain("BET_PLACEMENT");
    expect(item).not.toContain("BET_WON");
    expect(item).toContain(" pts");
    expect(item).not.toContain("DollarCircleOutlined");
    expect(item).not.toContain("{data.unit}");
  });
});
