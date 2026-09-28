/**
 * Regression test: compliance-client.ts endpoint paths
 * Verifies all compliance functions call the correct Go backend paths
 * after the path alignment fix (was /punters/*, now /compliance/rg/*).
 *
 * Run: npx tsx --test app/__tests__/compliance-paths.test.ts
 *
 * Regression: ISSUE-001 — compliance paths mismatched with Go backend
 * Found during production readiness audit on 2026-04-13
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const clientPath = resolve(__dirname, "../lib/api/compliance-client.ts");
// The limits form moved from the retired /profile page into Settings.
const profilePath = resolve(__dirname, "../components/account/PlayLimitsCard.tsx");
const rgHistoryPath = resolve(__dirname, "../account/rg-history/page.tsx");
const source = readFileSync(clientPath, "utf-8");
const profileSource = readFileSync(profilePath, "utf-8");
const rgHistorySource = readFileSync(rgHistoryPath, "utf-8");
const i18nConfigSource = readFileSync(
  resolve(__dirname, "../lib/i18n/config.ts"),
  "utf-8",
);

describe("compliance-client endpoint paths", () => {
  it("setPointUseLimits calls the launch RG point-use limit endpoint", () => {
    assert.ok(
      source.includes("export async function setPointUseLimits"),
      "compliance-client should expose the point-use limit wrapper",
    );
    assert.ok(
      source.includes("/api/v1/compliance/rg/point-use-limit"),
      "point-use limit wrapper should call the launch point-use endpoint",
    );
    assert.ok(
      !source.includes("/api/v1/compliance/rg/deposit-limit"),
      "launch compliance client should not call the legacy deposit-limit endpoint",
    );
    assert.ok(
      source.includes("dailyLimitPoints") &&
        source.includes("weeklyLimitPoints") &&
        source.includes("monthlyLimitPoints") &&
        source.includes("amountPoints: Math.round"),
      "point-use limit wrapper should send point-native amountPoints",
    );
    assert.ok(
      !source.includes("/api/v1/punters/deposit-limits"),
      "should NOT reference old /punters/deposit-limits path",
    );
  });

  it("setPredictionLimits calls the launch RG prediction-limit endpoint", () => {
    assert.ok(
      source.includes("export async function setPredictionLimits"),
      "compliance-client should expose the prediction-limit wrapper",
    );
    assert.ok(
      source.includes("/api/v1/compliance/rg/prediction-limit"),
      "prediction-limit wrapper should call the launch prediction-limit endpoint",
    );
    assert.ok(
      !source.includes("/api/v1/compliance/rg/bet-limit"),
      "launch compliance client should not call the legacy bet-limit endpoint",
    );
    // Points unit-model (2026-07-07): whole Points on the wire — the old
    // lock pinned a ×100 scale conversion; the ban below keeps it dead.
    assert.ok(
      source.includes("maxOrderPoints") &&
        source.includes(
          "amountPoints: Math.round(request.maxOrderPoints || 0)",
        ),
      "prediction-limit wrapper should send whole-Points amountPoints",
    );
    assert.ok(
      !source.includes("maxOrderPoints || 0) * 100"),
      "prediction-limit wrapper must not rescale Points by 100",
    );
    assert.ok(
      !source.includes("/api/v1/punters/stake-limits"),
      "should NOT reference old /punters/stake-limits path",
    );
  });

  it("coolOff calls /compliance/rg/cool-off", () => {
    assert.ok(
      source.includes("/api/v1/compliance/rg/cool-off"),
      "coolOff should call /api/v1/compliance/rg/cool-off",
    );
  });

  it("setSessionLimits calls /compliance/rg/session-limit (own endpoint)", () => {
    assert.ok(
      source.includes("/api/v1/compliance/rg/session-limit"),
      "setSessionLimits should call /api/v1/compliance/rg/session-limit",
    );
  });

  it("selfExclude calls /compliance/rg/self-exclude", () => {
    assert.ok(
      source.includes("/api/v1/compliance/rg/self-exclude"),
      "selfExclude should call /api/v1/compliance/rg/self-exclude",
    );
  });

  it("uploadKycDocument calls /compliance/kyc/submit-document", () => {
    assert.ok(
      source.includes("/api/v1/compliance/kyc/submit-document"),
      "uploadKycDocument should call /api/v1/compliance/kyc/submit-document",
    );
    assert.ok(
      !source.includes("/api/v1/compliance/documents/upload"),
      "should NOT reference old /compliance/documents/upload path",
    );
  });

  it("getCoolOffStatus calls /compliance/rg/restrictions (already correct)", () => {
    assert.ok(
      source.includes("/api/v1/compliance/rg/restrictions"),
      "getCoolOffStatus should call /api/v1/compliance/rg/restrictions",
    );
  });

  it("getLimitsHistory composes point-use limits + prediction-limits", () => {
    assert.ok(
      source.includes("/api/v1/compliance/rg/point-use-limits"),
      "getLimitsHistory should fetch the current gateway point-use-limit source",
    );
    assert.ok(
      source.includes("/api/v1/compliance/rg/prediction-limits"),
      "getLimitsHistory should fetch prediction-limits",
    );
    assert.ok(
      source.includes('limitType: "point_use_limit"'),
      "getLimitsHistory should normalize the inherited deposit source to point_use_limit",
    );
    assert.ok(
      source.includes("limit.limitPoints"),
      "getLimitsHistory should prefer point-native limitPoints when available",
    );
    assert.ok(
      source.includes('limitType: "prediction_limit"'),
      "getLimitsHistory should normalize inherited bet-limit source to prediction_limit",
    );
    assert.ok(
      !source.includes("/api/v1/punters/limits-history"),
      "should NOT reference old /punters/limits-history path",
    );
  });

  it("profile limits use point-use terminology at the call site", () => {
    assert.ok(
      profileSource.includes("setPointUseLimits"),
      "profile page should call the point-use limit wrapper",
    );
    assert.ok(
      !profileSource.includes("setDepositLimits") &&
        !profileSource.includes("SetDepositLimitsRequest") &&
        !profileSource.includes("depositReq") &&
        !profileSource.includes("daily_limit") &&
        !profileSource.includes("weekly_limit") &&
        !profileSource.includes("monthly_limit"),
      "profile page should not use deposit-limit names for launch limits",
    );
  });

  it("profile prediction limits use launch prediction terminology at the call site", () => {
    assert.ok(
      profileSource.includes("setPredictionLimits"),
      "profile page should call the prediction-limit wrapper",
    );
    assert.ok(
      !profileSource.includes("setStakeLimits") &&
        !profileSource.includes("SetStakeLimitsRequest") &&
        !profileSource.includes("stakeReq") &&
        !profileSource.includes("maxStake") &&
        !profileSource.includes("max_stake"),
      "profile page should not use stake-limit names for launch prediction limits",
    );
  });

  it("does not export legacy deposit/stake compliance aliases from the launch client", () => {
    for (const token of [
      "SetDepositLimitsRequest",
      "SetStakeLimitsRequest",
      "DepositLimits",
      "StakeLimits",
      "setDepositLimits",
      "setStakeLimits",
      "getMonthlyDepositTotal",
      "max_stake",
      "currency?: string",
      "currency: string",
    ]) {
      assert.ok(
        !source.includes(token),
        `compliance-client should not expose ${token}`,
      );
    }
  });

  it("responsible-play history renders point-use limits", () => {
    assert.ok(
      rgHistorySource.includes("point_use_limit"),
      "RG history should consume normalized point-use limit entries",
    );
    assert.ok(
      rgHistorySource.includes("Point-Use Limit"),
      "RG history should render point-use label",
    );
    assert.ok(
      !rgHistorySource.includes("deposit_limit") &&
        !rgHistorySource.includes('includes("deposit")'),
      "RG history should not retain deposit-limit fallbacks",
    );
  });

  it("does not ship the retired deposit-limits i18n namespace", () => {
    assert.ok(
      !i18nConfigSource.includes('"deposit-limits"') &&
        !i18nConfigSource.includes("'deposit-limits'"),
      "i18n config should not register the retired deposit-limits namespace",
    );

    for (const lang of ["de", "en", "id", "ms", "tl", "zh-Hans", "zh-Hant"]) {
      assert.equal(
        existsSync(
          resolve(
            __dirname,
            `../../public/static/locales/${lang}/deposit-limits.json`,
          ),
        ),
        false,
        `${lang}/deposit-limits.json should not ship in the launch app`,
      );
    }
  });

  it("responsible-play history renders prediction limits", () => {
    assert.ok(
      rgHistorySource.includes("prediction_limit"),
      "RG history should consume normalized prediction limit entries",
    );
    assert.ok(
      rgHistorySource.includes("Prediction Limit"),
      "RG history should render prediction limit label",
    );
    assert.ok(
      !rgHistorySource.includes("stake_limit") &&
        !rgHistorySource.includes('includes("stake")'),
      "RG history should not retain stake-limit fallbacks",
    );
  });

  it("no remaining /punters/ paths in compliance client", () => {
    const punterPaths = source.match(/\/api\/v1\/punters\//g);
    assert.equal(
      punterPaths,
      null,
      "compliance-client should have zero /api/v1/punters/ references",
    );
  });
});
