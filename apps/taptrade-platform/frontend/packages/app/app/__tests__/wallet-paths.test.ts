/**
 * Regression test: wallet-client.ts endpoint paths
 * Verifies the points-only wallet client does not expose payment helpers.
 *
 * Run: npx tsx --test app/__tests__/wallet-paths.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const clientPath = resolve(__dirname, "../lib/api/wallet-client.ts");
const bonusClientPath = resolve(__dirname, "../lib/api/bonus-client.ts");
// bonusSlice + WalletBreakdown were deleted in the P12 dead-code sweep
// (2026-07-12): zero importers. The paths stay so the suite can assert the
// retired files do not come back.
const bonusSlicePath = resolve(__dirname, "../lib/store/bonusSlice.ts");
const rewardsPagePath = resolve(__dirname, "../rewards/page.tsx");
const activeBonusesControlPath = resolve(
  __dirname,
  "../rewards/ActiveBonusesControl.tsx",
);
const walletBreakdownPath = resolve(
  __dirname,
  "../components/WalletBreakdown.tsx",
);
const wageringProgressPath = resolve(
  __dirname,
  "../components/WageringProgress.tsx",
);
const apiIndexPath = resolve(__dirname, "../lib/api/index.ts");
const sharedApiTypesPath = resolve(
  __dirname,
  "../../../api-client/src/types.ts",
);
const sharedApiClientPath = resolve(
  __dirname,
  "../../../api-client/src/client.ts",
);
const sharedApiPredictionTypesPath = resolve(
  __dirname,
  "../../../api-client/src/prediction-types.ts",
);
const sharedApiIndexPath = resolve(
  __dirname,
  "../../../api-client/src/index.ts",
);
const source = readFileSync(clientPath, "utf-8");
const bonusSource = readFileSync(bonusClientPath, "utf-8");
const rewardsPageSource = readFileSync(rewardsPagePath, "utf-8");
const activeBonusesControlSource = readFileSync(
  activeBonusesControlPath,
  "utf-8",
);
const wageringProgressSource = readFileSync(wageringProgressPath, "utf-8");
const apiIndexSource = readFileSync(apiIndexPath, "utf-8");
const sharedApiTypesSource = readFileSync(sharedApiTypesPath, "utf-8");
const sharedApiClientSource = readFileSync(sharedApiClientPath, "utf-8");
const sharedApiPredictionTypesSource = readFileSync(
  sharedApiPredictionTypesPath,
  "utf-8",
);
const sharedApiIndexSource = readFileSync(sharedApiIndexPath, "utf-8");

function sliceBetween(
  sourceText: string,
  startToken: string,
  endToken: string,
): string {
  const start = sourceText.indexOf(startToken);
  const end = sourceText.indexOf(endToken, start + startToken.length);
  assert.notEqual(start, -1, `missing start token ${startToken}`);
  assert.notEqual(end, -1, `missing end token ${endToken}`);
  return sourceText.slice(start, end);
}

describe("wallet-client endpoint paths", () => {
  it("does not expose payment helpers from the points-only wallet client", () => {
    assert.ok(
      !/export async function (deposit|withdraw|getTransactionStatus)\b/.test(
        source,
      ),
      "wallet-client should not expose payment mutation helpers",
    );
    assert.ok(
      !source.includes("/api/v1/payments/deposit") &&
        !source.includes("/api/v1/payments/withdraw") &&
        !source.includes("/api/v1/payments/status"),
      "wallet-client should not reference payment endpoints",
    );
    assert.ok(
      !/\b(deposit|withdraw)\b/.test(
        apiIndexSource.match(
          /\/\/ Wallet client[\s\S]*?from "\.\/wallet-client";/,
        )?.[0] || "",
      ),
      "API barrel should not re-export payment helpers from wallet-client",
    );
  });

  it("getBalance still calls /wallet/{userId} (correct primary path)", () => {
    assert.ok(
      source.includes("/api/v1/wallet/"),
      "getBalance should use /api/v1/wallet/ primary path",
    );
  });

  it("getTransactions still calls /wallet/{userId}/ledger (correct primary path)", () => {
    assert.ok(
      source.includes("/ledger"),
      "getTransactions should use /wallet/{userId}/ledger path",
    );
  });

  it("claimDailyPoints calls the ledger-backed daily claim endpoint", () => {
    assert.ok(
      source.includes("export async function claimDailyPoints"),
      "wallet-client should expose the daily gameplay point claim helper",
    );
    assert.ok(
      source.includes("/api/v1/wallet/daily-claim"),
      "daily claim should use the gateway wallet daily-claim endpoint",
    );
  });

  it("point pack helpers call the ledger-backed point-pack endpoints", () => {
    assert.ok(
      source.includes("export async function getPointPacks"),
      "wallet-client should expose point pack listing",
    );
    assert.ok(
      source.includes("export async function claimPointPack"),
      "wallet-client should expose point pack claiming",
    );
    assert.ok(
      source.includes("/api/v1/wallet/point-packs") &&
        source.includes("/api/v1/wallet/point-packs/claim"),
      "point packs should use the gateway wallet point-pack endpoints",
    );
  });

  it("mission helpers call the ledger-backed mission endpoints", () => {
    assert.ok(
      source.includes("export async function getMissions"),
      "wallet-client should expose mission listing",
    );
    assert.ok(
      source.includes("export async function claimMission"),
      "wallet-client should expose mission claiming",
    );
    assert.ok(
      source.includes("/api/v1/wallet/missions") &&
        source.includes("/api/v1/wallet/missions/claim"),
      "missions should use the gateway wallet mission endpoints",
    );
  });

  it("streak helpers call the ledger-backed streak endpoints", () => {
    assert.ok(
      source.includes("export async function getStreaks"),
      "wallet-client should expose streak listing",
    );
    assert.ok(
      source.includes("export async function claimStreak"),
      "wallet-client should expose streak claiming",
    );
    assert.ok(
      source.includes("/api/v1/wallet/streaks") &&
        source.includes("/api/v1/wallet/streaks/claim"),
      "streaks should use the gateway wallet streak endpoints",
    );
  });

  it("badge helpers call the ledger-backed badge endpoint", () => {
    assert.ok(
      source.includes("export async function getBadges"),
      "wallet-client should expose badge listing",
    );
    assert.ok(
      source.includes("/api/v1/wallet/badges"),
      "badges should use the gateway wallet badge endpoint",
    );
  });

  it("reward limit helper calls the ledger-backed reward-limit endpoint", () => {
    assert.ok(
      source.includes("export async function getRewardLimitStatus"),
      "wallet-client should expose reward limit status",
    );
    assert.ok(
      source.includes("/api/v1/wallet/reward-limits"),
      "reward limits should use the gateway wallet reward-limit endpoint",
    );
  });

  it("getTransactions preserves gateway ledger movement types", () => {
    assert.ok(
      !source.includes('return "deposit"') &&
        !source.includes("return 'deposit'") &&
        !source.includes('return "withdrawal"') &&
        !source.includes("return 'withdrawal'"),
      "wallet ledger credit/debit values should not be remapped to deposit/withdrawal",
    );
    assert.ok(
      source.includes("type: item.type"),
      "normalized transactions should preserve the gateway ledger type",
    );
  });

  it("getTransactions preserves ledger idempotency metadata for order review", () => {
    assert.ok(
      source.includes("idempotencyKey?: string"),
      "normalized transactions should expose optional idempotencyKey",
    );
    assert.ok(
      source.includes("idempotencyKey: item.idempotencyKey"),
      "wallet-client should preserve gateway ledger idempotency keys",
    );
  });

  it("normalizes wallet amounts as gameplay points, not USD currency", () => {
    const balanceType = sliceBetween(
      source,
      "export interface Balance {",
      "export interface Transaction",
    );
    const transactionType = sliceBetween(
      source,
      "export interface Transaction {",
      "export interface GetTransactionsPaginatedResponse",
    );
    assert.ok(
      source.includes('const POINT_UNIT = "PTS"'),
      "wallet-client should expose a point unit for normalized balances",
    );
    assert.ok(
      source.includes("unit: raw.unit || POINT_UNIT") &&
        source.includes("unit: POINT_UNIT") &&
        source.includes("unit: item.unit || POINT_UNIT"),
      "wallet balance and ledger transactions should normalize to the point unit",
    );
    assert.ok(
      !balanceType.includes("currency: string") &&
        !transactionType.includes("currency: string"),
      "wallet balance and ledger exports should expose unit instead of currency",
    );
    assert.ok(
      !source.includes('currency: "USD"') &&
        !source.includes("currency: 'USD'") &&
        !source.includes("centsToDollars"),
      "wallet-client should not label point balances as USD or dollars",
    );
  });

  it("prefers point-native wallet response aliases over legacy cents fields", () => {
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    const balanceType = sliceBetween(
      source,
      "interface WalletBalanceRaw",
      "interface WalletLedgerEntryRaw",
    );
    const ledgerType = sliceBetween(
      source,
      "interface WalletLedgerEntryRaw",
      "interface WalletLedgerResponseRaw",
    );
    const balanceNormalizer = sliceBetween(
      source,
      "export async function getBalance",
      "/**\n * Get transaction history",
    );
    const transactionNormalizer = sliceBetween(
      source,
      "export async function getTransactions",
      "interface StarterGrantResult",
    );
    for (const token of [
      "balancePoints",
      "availablePoints",
      "reservedPoints",
      "amountPoints",
      "raw.unit || POINT_UNIT",
      "item.unit || POINT_UNIT",
    ]) {
      assert.ok(
        source.includes(token),
        `wallet-client should read point-native response field ${token}`,
      );
    }
    assert.ok(
      balanceType.includes("balancePoints") &&
        balanceType.includes("availablePoints") &&
        balanceType.includes("reservedPoints"),
      "WalletBalanceRaw should model the canonical *Points balance keys",
    );
    assert.ok(
      ledgerType.includes("amountPoints") &&
        ledgerType.includes("balancePoints"),
      "WalletLedgerEntryRaw should model the canonical *Points ledger keys",
    );
    for (const retired of [
      "PointsCents",
      "balanceCents",
      "availableCents",
      "reservedCents",
      "amountCents",
    ]) {
      assert.ok(
        !source.includes(retired),
        `wallet-client should not read retired wire key spelling ${retired}`,
      );
    }
    assert.ok(
      balanceNormalizer.includes("raw.balancePoints") &&
        transactionNormalizer.includes("item.amountPoints") &&
        transactionNormalizer.includes("item.balancePoints"),
      "wallet normalizers should read the canonical *Points wire keys",
    );
  });

  it("keeps shared API-client wallet exports point-native", () => {
    const sharedWalletBalanceType = sliceBetween(
      sharedApiTypesSource,
      "export interface WalletBalance {",
      "export interface WalletLedgerEntry",
    );
    const sharedWalletLedgerType = sliceBetween(
      sharedApiTypesSource,
      "export interface WalletLedgerEntry {",
      "export interface WalletMutationResponse",
    );
    const sharedWalletMutationResponseType = sliceBetween(
      sharedApiTypesSource,
      "export interface WalletMutationResponse {",
      "export interface AuditLogEntry",
    );
    const sharedWalletMutationRequestType = sliceBetween(
      sharedApiTypesSource,
      "export interface WalletMutationRequest {",
      "// Pagination options",
    );

    // Points unit-model (2026-07-07): single canonical *Points wire key.
    for (const [label, exportedType, expected] of [
      [
        "WalletBalance",
        sharedWalletBalanceType,
        ["balancePoints", "availablePoints", "reservedPoints"],
      ],
      [
        "WalletLedgerEntry",
        sharedWalletLedgerType,
        ["amountPoints", "balancePoints"],
      ],
      [
        "WalletMutationResponse",
        sharedWalletMutationResponseType,
        ["balancePoints"],
      ],
      [
        "WalletMutationRequest",
        sharedWalletMutationRequestType,
        ["amountPoints"],
      ],
    ] as const) {
      for (const token of expected) {
        assert.ok(
          exportedType.includes(token),
          `shared ${label} should expose canonical *Points key ${token}`,
        );
      }
      assert.ok(
        !exportedType.includes("PointsCents") &&
          !exportedType.includes("amountCents") &&
          !exportedType.includes("balanceCents") &&
          !exportedType.includes("availableCents") &&
          !exportedType.includes("reservedCents"),
        `shared ${label} should not expose retired cent aliases`,
      );
    }
    assert.ok(
      /unit:\s*["']PTS["']/.test(sharedApiTypesSource),
      "shared API-client wallet types should expose unit: 'PTS'",
    );
    assert.ok(
      sharedApiClientSource.includes("payload.balancePoints") &&
        sharedApiClientSource.includes("payload.amountPoints") &&
        !sharedApiClientSource.includes("PointsCents") &&
        !sharedApiClientSource.includes("payload.balanceCents") &&
        !sharedApiClientSource.includes("payload.amountCents"),
      "shared API client should normalize wallet payloads from the canonical *Points wire keys",
    );
  });

  it("keeps shared API-client audit-log exports point-native", () => {
    const sharedAuditLogType = sliceBetween(
      sharedApiTypesSource,
      "export interface AuditLogEntry {",
      "// Request types",
    );

    for (const retired of [
      "freebetId",
      "oddsBoostId",
      "freebetAppliedPoints",
    ]) {
      assert.ok(
        !sharedAuditLogType.includes(retired),
        `shared AuditLogEntry should not export retired promo field ${retired}`,
      );
    }
    for (const token of [
      "pointGrantId",
      "pointRuleId",
      "pointGrantAppliedPoints",
    ]) {
      assert.ok(
        sharedAuditLogType.includes(token),
        `shared AuditLogEntry should expose ${token}`,
      );
    }
    assert.ok(
      sharedApiClientSource.includes("interface LegacyAuditLogEntryPayload") &&
        sharedApiClientSource.includes("payload.freebetId") &&
        sharedApiClientSource.includes("payload.oddsBoostId") &&
        sharedApiClientSource.includes("payload.freebetAppliedPoints") &&
        sharedApiClientSource.includes("normalizeAuditLogEntry"),
      "shared API client should keep retired promo fields only as private audit-log compatibility reads",
    );
  });

  it("keeps shared API-client order-book hints point-native", () => {
    const orderBookHintType = sliceBetween(
      sharedApiPredictionTypesSource,
      "export interface OrderBookHint {",
      "export interface PlaceOrderResponse",
    );

    // Points unit-model (2026-07-07): single canonical *Points wire key.
    for (const retired of [
      "PointsCents",
      "bestYesBidCents",
      "bestYesAskCents",
      "bestNoBidCents",
      "bestNoAskCents",
    ]) {
      assert.ok(
        !orderBookHintType.includes(retired),
        `OrderBookHint should not export retired best-quote alias ${retired}`,
      );
    }
    for (const token of [
      "bestYesBidPoints",
      "bestYesAskPoints",
      "bestNoBidPoints",
      "bestNoAskPoints",
      'unit?: "PTS" | string',
    ]) {
      assert.ok(
        orderBookHintType.includes(token),
        `OrderBookHint should expose ${token}`,
      );
    }
    assert.ok(
      !sharedApiIndexSource.includes("sportsbook"),
      "shared API-client entrypoint docs should not describe launch exports as sportsbook contracts",
    );
  });

  it("names the shared API-client class for Tap Trade and drops the retired compatibility alias", () => {
    assert.ok(
      sharedApiClientSource.includes("export class TapTradeApiClient") &&
        sharedApiIndexSource.includes(
          'export { TapTradeApiClient } from "./client"',
        ),
      "shared API client should be exported as TapTradeApiClient",
    );
    assert.ok(
      !sharedApiClientSource.includes("PhoenixApiClient") &&
        !sharedApiIndexSource.includes("PhoenixApiClient"),
      "shared API client should no longer export the retired compatibility alias",
    );
  });

  it("prefers point-native reward response aliases over legacy cents fields", () => {
    const starterGrantType = sliceBetween(
      source,
      "interface StarterGrantResult",
      "interface StarterGrantResultRaw",
    );
    const dailyClaimType = sliceBetween(
      source,
      "export interface DailyClaimResult",
      "interface DailyClaimResultRaw",
    );
    const pointPackType = sliceBetween(
      source,
      "export interface PointPack",
      "interface PointPackRaw",
    );
    const pointPackClaimType = sliceBetween(
      source,
      "export interface PointPackClaimResult",
      "interface PointPackClaimResultRaw",
    );
    const missionType = sliceBetween(
      source,
      "export interface Mission",
      "interface MissionRaw",
    );
    const missionClaimType = sliceBetween(
      source,
      "export interface MissionClaimResult",
      "interface MissionClaimResultRaw",
    );
    const streakType = sliceBetween(
      source,
      "export interface Streak",
      "interface StreakRaw",
    );
    const streakClaimType = sliceBetween(
      source,
      "export interface StreakClaimResult",
      "interface StreakClaimResultRaw",
    );
    const rewardLimitType = sliceBetween(
      source,
      "export interface RewardLimitStatus",
      "interface RewardLimitStatusRaw",
    );
    for (const token of [
      "grantPoints",
      "claimPoints",
      "balancePoints",
      "amountPoints",
      "rewardPoints",
      "limitPoints",
      "grantedPoints",
      "remainingPoints",
      "normalizeRewardLimit",
      "normalizeRewardClaim",
      "normalizePointPack",
      "normalizeMission",
      "normalizeStreak",
    ]) {
      assert.ok(
        source.includes(token),
        `wallet-client should read point-native reward field ${token}`,
      );
    }
    // Points unit-model (2026-07-07): single canonical *Points wire key.
    for (const [label, typeSource, expected] of [
      [
        "StarterGrantResult",
        starterGrantType,
        ["grantPoints", "balancePoints"],
      ],
      ["DailyClaimResult", dailyClaimType, ["claimPoints", "balancePoints"]],
      ["PointPack", pointPackType, ["amountPoints"]],
      [
        "PointPackClaimResult",
        pointPackClaimType,
        ["claimPoints", "balancePoints"],
      ],
      ["Mission", missionType, ["rewardPoints"]],
      [
        "MissionClaimResult",
        missionClaimType,
        ["claimPoints", "balancePoints"],
      ],
      ["Streak", streakType, ["rewardPoints"]],
      ["StreakClaimResult", streakClaimType, ["claimPoints", "balancePoints"]],
      [
        "RewardLimitStatus",
        rewardLimitType,
        ["limitPoints", "grantedPoints", "remainingPoints"],
      ],
    ] as const) {
      for (const token of expected) {
        assert.ok(
          typeSource.includes(token),
          `${label} should expose canonical reward key ${token}`,
        );
      }
    }
    for (const retired of [
      "PointsCents",
      "grantCents",
      "claimCents",
      "balanceCents",
      "amountCents",
      "rewardCents",
      "limitCents",
      "grantedCents",
      "remainingCents",
    ]) {
      assert.ok(
        !source.includes(retired),
        `wallet-client should not read retired reward wire key spelling ${retired}`,
      );
    }
    assert.ok(
      source.includes("interface StarterGrantResultRaw") &&
        source.includes("interface DailyClaimResultRaw") &&
        source.includes("interface PointPackRaw") &&
        source.includes("interface MissionRaw") &&
        source.includes("interface StreakRaw") &&
        source.includes("interface RewardLimitStatusRaw") &&
        source.includes("result.claimPoints") &&
        source.includes("pack.amountPoints") &&
        source.includes("mission.rewardPoints") &&
        source.includes("status.limitPoints"),
      "reward normalizers should read the canonical *Points wire keys",
    );
  });

  it("normalizes wallet breakdown as points, not USD or real-money display fields", () => {
    const breakdownType = sliceBetween(
      bonusSource,
      "export interface WalletBreakdown",
      "export interface PlayContribution",
    );
    const breakdownNormalizer = sliceBetween(
      bonusSource,
      "export async function getWalletBreakdown",
      "export function invalidateBonusCaches",
    );
    for (const token of [
      "basePoints",
      "bonusPoints",
      "totalPoints",
      'unit: res.unit || res.currency || "PTS"',
    ]) {
      assert.ok(
        bonusSource.includes(token),
        `bonus-client should read point-native breakdown field ${token}`,
      );
    }
    assert.ok(
      !bonusSource.includes('currency: res.currency || "USD"'),
      "bonus-client should not fall back to USD for wallet breakdowns",
    );
    assert.ok(
      !breakdownType.includes("currency: string"),
      "WalletBreakdown should expose unit instead of currency",
    );
    // Points unit-model (2026-07-07): single canonical *Points wire key
    // (totalPoints IS the canonical breakdown key now; retired spellings stay banned).
    assert.ok(
      breakdownType.includes("totalPoints") &&
        !breakdownType.includes("realMoneyPoints") &&
        !breakdownType.includes("bonusFundPoints") &&
        !breakdownType.includes("totalPointsCents") &&
        !breakdownType.includes("totalCents"),
      "WalletBreakdown should not export retired breakdown aliases",
    );
    assert.ok(
      bonusSource.includes("interface LegacyBreakdownResponse") &&
        breakdownNormalizer.includes("legacyRes.realMoneyPoints") &&
        breakdownNormalizer.includes("legacyRes.bonusFundPoints") &&
        breakdownNormalizer.includes("legacyRes.totalPoints") &&
        !breakdownNormalizer.includes("realMoneyPoints: basePoints") &&
        !breakdownNormalizer.includes("bonusFundPoints: bonusPoints") &&
        !breakdownNormalizer.includes("totalPoints: totalPoints"),
      "legacy breakdown fields should be read privately but not reattached",
    );
    // The WalletBreakdown component and bonusSlice store were removed in the
    // P12 dead-code sweep — the render-side breakdown surface must not
    // silently return (rewards/ActiveBonusesControl is the live bonus UI).
    assert.equal(
      existsSync(walletBreakdownPath),
      false,
      "WalletBreakdown.tsx was deleted (zero importers) and should not return",
    );
    assert.equal(
      existsSync(bonusSlicePath),
      false,
      "bonusSlice.ts was deleted (zero importers) and should not return",
    );
  });

  it("normalizes active bonus payloads from point-native aliases first", () => {
    const playerBonusType = sliceBetween(
      bonusSource,
      "export interface PlayerBonus {",
      "export interface WalletBreakdown",
    );

    for (const token of [
      "normalizePlayerBonus",
      "grantedPoints",
      "remainingPoints",
      "playRequiredPoints",
      "playCompletedPoints",
      "playProgressPct",
      'raw.unit || "PTS"',
      "raw.bonusId ?? raw.bonus_id",
      "raw.campaignName ?? raw.campaign_name",
    ]) {
      assert.ok(
        bonusSource.includes(token),
        `bonus-client should normalize bonus payload token ${token}`,
      );
    }
    for (const retired of [
      "grantedAmountPoints",
      "remainingAmountPoints",
      "wageringRequiredPoints",
      "wageringCompletedPoints",
      "wageringProgressPct",
    ]) {
      assert.ok(
        !playerBonusType.includes(retired),
        `PlayerBonus should not export retired bonus field ${retired}`,
      );
    }
  });

  it("normalizes bonus progress and visible progress copy as point play", () => {
    const playContributionType = sliceBetween(
      bonusSource,
      "export interface PlayContribution",
      "export interface BonusProgress",
    );
    const bonusProgressType = sliceBetween(
      bonusSource,
      "export interface BonusProgress {",
      "interface BonusListResponse",
    );

    for (const token of [
      "normalizeBonusProgress",
      "playRequiredPoints",
      "playCompletedPoints",
      "playProgressPct",
      'raw.unit || "PTS"',
      "playAmountPoints",
    ]) {
      assert.ok(
        bonusSource.includes(token),
        `bonus-client should normalize bonus progress token ${token}`,
      );
    }
    for (const retired of [
      "wageringRequiredPoints",
      "wageringCompletedPoints",
      "progressPct",
    ]) {
      assert.ok(
        !bonusProgressType.includes(retired),
        `BonusProgress should not export retired progress field ${retired}`,
      );
    }
    assert.ok(
      playContributionType.includes("playAmountPoints: number") &&
        playContributionType.includes("contributionPoints: number") &&
        !playContributionType.includes("stakePoints") &&
        bonusSource.includes(
          "playAmountPoints: raw.stakePoints ?? raw.stakePoints ?? 0",
        ),
      "PlayContribution should export point-play amount fields while keeping stake aliases private",
    );
    assert.ok(
      wageringProgressSource.includes('aria-label="Play progress"'),
      "progress component should use point-play assistive text",
    );
    assert.ok(
      wageringProgressSource.includes('t("playProgressRequired"'),
      "progress component should use point-play translation key",
    );
    assert.ok(
      !wageringProgressSource.includes('aria-label="Wagering progress"') &&
        !wageringProgressSource.includes('t("wageringRequired"'),
      "progress component should not render wagering copy",
    );
  });

  it("renders active bonus progress on the rewards page with point-play fields", () => {
    // The local ÷100 formatPoints helper is retired (Points render whole via
    // app/lib/points), so the retired-field scan covers the whole component
    // source instead of slicing up to that helper.
    const activeBonusPanel = activeBonusesControlSource;

    for (const token of [
      "getActiveBonuses",
      "const [activeBonuses, setActiveBonuses] = useState<PlayerBonus[]>([]);",
      "<ActiveBonusesControl bonuses={activeBonuses} />",
      "activeBonusesResult",
    ]) {
      assert.ok(
        rewardsPageSource.includes(token),
        `rewards page should include active bonus wiring token ${token}`,
      );
    }
    for (const token of [
      "WageringProgress",
      "requiredPoints={bonus.playRequiredPoints}",
      "completedPoints={bonus.playCompletedPoints}",
      "progressPct={bonus.playProgressPct}",
      "formatPointsAmount(bonus.remainingPoints)",
      't("activeBonuses.title", "Active point-play bonuses")',
    ]) {
      assert.ok(
        activeBonusesControlSource.includes(token),
        `active bonus component should include active bonus UI token ${token}`,
      );
    }
    for (const retired of [
      "bonus.wageringRequiredPoints",
      "bonus.wageringCompletedPoints",
      "bonus.wageringProgressPct",
      "bonus.grantedAmountPoints",
      "bonus.remainingAmountPoints",
    ]) {
      assert.ok(
        !activeBonusPanel.includes(retired),
        `active bonus panel should not consume retired bonus field ${retired}`,
      );
    }
  });
});
