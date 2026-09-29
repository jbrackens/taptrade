import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

import {
  assertBaseUnits,
  assertValidBridgeEvent,
  assertValidAuditEvent,
  assertValidCanaryResult,
  assertValidCashierUserWallet,
  assertValidComplianceDecision,
  assertValidDepositIntent,
  assertValidRelayerSubmission,
  assertValidRecoveryCase,
  assertValidRecoveryApproval,
  assertValidReconciliationReport,
  assertValidRuntimeFlag,
  assertValidWithdrawalIntent,
  applyBridgeEventToDepositIntent,
  canTransitionDepositStatus,
  canTransitionRelayerStatus,
  canTransitionRecoveryCaseStatus,
  canTransitionWithdrawalStatus,
  evaluateCashierCompliancePolicy,
  evaluateRelayerPolicy,
  hasTwoPersonApproval,
  isRuntimeFlagEnabled,
  isTerminalDepositStatus,
  isTerminalRelayerStatus,
  isTerminalRecoveryCaseStatus,
  isTerminalWithdrawalStatus,
  makeDepositIdempotencyKey,
  makeRelayerIdempotencyKey,
  makeWithdrawalIdempotencyKey,
  nextDepositStatusForBridgeEvent,
  createRecoveryCaseFromBridgeEvent,
  summarizeReconciliationReport,
  verifyProviderCallbackSignature,
} from "../.tmp-test-dist/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
}

test("deposit state machine rejects terminal mutations", () => {
  assert.equal(canTransitionDepositStatus("created", "address_issued"), true);
  assert.equal(canTransitionDepositStatus("bridging", "settled"), true);
  assert.equal(canTransitionDepositStatus("settled", "bridging"), false);
  assert.equal(isTerminalDepositStatus("settled"), true);
});

test("withdrawal state machine requires authorization before submission", () => {
  assert.equal(canTransitionWithdrawalStatus("created", "submitted"), false);
  assert.equal(canTransitionWithdrawalStatus("created", "user_authorized"), true);
  assert.equal(canTransitionWithdrawalStatus("policy_approved", "submitted"), true);
  assert.equal(isTerminalWithdrawalStatus("confirmed"), true);
});

test("relayer state machine allows replacement but not mutation after inclusion", () => {
  assert.equal(canTransitionRelayerStatus("submitted", "replaced"), true);
  assert.equal(canTransitionRelayerStatus("replaced", "submitted"), true);
  assert.equal(canTransitionRelayerStatus("included", "submitted"), false);
  assert.equal(isTerminalRelayerStatus("included"), true);
});

test("recovery case state machine closes terminally", () => {
  assert.equal(
    canTransitionRecoveryCaseStatus("triage", "waiting_on_provider"),
    true,
  );
  assert.equal(
    canTransitionRecoveryCaseStatus("compliance_hold", "ready_for_release"),
    true,
  );
  assert.equal(canTransitionRecoveryCaseStatus("ready_for_release", "closed"), true);
  assert.equal(canTransitionRecoveryCaseStatus("closed", "triage"), false);
  assert.equal(isTerminalRecoveryCaseStatus("closed"), true);
});

test("idempotency keys are deterministic and scoped", () => {
  assert.equal(
    makeDepositIdempotencyKey({
      provider: "relay",
      chain: "tron",
      txHashOrRequestId: "tx1",
      logIndexOrEvent: 0,
    }),
    "deposit:relay:tron:tx1:0",
  );

  assert.equal(
    makeWithdrawalIdempotencyKey({
      userId: "user1",
      destinationAddress: "0xABC",
      amountUnits: "1000",
      userAuthorizationHash: "0xDEF",
    }),
    "withdrawal:user1:0xabc:1000:0xdef",
  );

  assert.equal(
    makeRelayerIdempotencyKey({
      chain: "polygon",
      smartWalletAddress: "0x1111111111111111111111111111111111111111",
      targetContract: "0x2222222222222222222222222222222222222222",
      calldataSha256: "ABC",
      userAuthorizationHash:
        "0x3333333333333333333333333333333333333333333333333333333333333333",
    }),
    "relayer:polygon:0x1111111111111111111111111111111111111111:0x2222222222222222222222222222222222222222:abc:0x3333333333333333333333333333333333333333333333333333333333333333",
  );
});

test("base-unit validation accepts known decimals and rejects ambiguous units", () => {
  assert.doesNotThrow(() =>
    assertBaseUnits({
      asset: "USDT",
      chain: "tron",
      decimals: 6,
      units: "25000000",
    }),
  );

  assert.throws(() =>
    assertBaseUnits({
      asset: "USDT",
      chain: "tron",
      decimals: 6,
      units: "25.0",
    }),
  );

  assert.throws(() =>
    assertBaseUnits({
      asset: "USDT",
      chain: "bsc",
      decimals: 6,
      units: "25000000",
    }),
  );
});

test("bridge events advance deposits conservatively", () => {
  assert.equal(
    nextDepositStatusForBridgeEvent("address_issued", {
      status: "source_confirmed",
    }),
    "source_detected",
  );

  assert.equal(
    nextDepositStatusForBridgeEvent("source_detected", {
      status: "destination_confirmed",
    }),
    "bridging",
  );

  assert.equal(
    nextDepositStatusForBridgeEvent("bridging", {
      status: "destination_confirmed",
    }),
    "settled",
  );

  assert.equal(
    nextDepositStatusForBridgeEvent("settled", {
      status: "quarantined",
    }),
    "settled",
  );
});

test("service fixtures satisfy the SDK runtime contract", () => {
  assert.doesNotThrow(() =>
    assertValidCashierUserWallet(
      readJson("services/cashier-api/fixtures/wallet.resolved.json"),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidDepositIntent(
      readJson("services/cashier-api/fixtures/deposit-intent.created.json"),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidDepositIntent(
      readJson("services/cashier-api/fixtures/deposit-intent.evm-direct.created.json"),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidBridgeEvent(
      readJson("services/bridge-watcher/fixtures/relay-source-detected.json"),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidBridgeEvent(
      readJson(
        "services/bridge-watcher/fixtures/relay-destination-confirmed.json",
      ),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidBridgeEvent(
      readJson(
        "services/bridge-watcher/fixtures/relay-quarantined-destination-mismatch.json",
      ),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidBridgeEvent(
      readJson("services/bridge-watcher/fixtures/relay-failed-expired-quote.json"),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidRelayerSubmission(
      readJson("services/relayer/fixtures/policy-approved-withdrawal.json"),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidWithdrawalIntent(
      readJson("services/cashier-api/fixtures/withdrawal-intent.created.json"),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidComplianceDecision(
      readJson("services/cashier-api/fixtures/compliance-decision.quarantine.json"),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidAuditEvent(
      readJson("services/cashier-api/fixtures/audit-event.recovery-created.json"),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidRecoveryCase(
      readJson("services/cashier-api/fixtures/recovery-case.destination-mismatch.json"),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidRecoveryApproval(
      readJson("services/cashier-api/fixtures/recovery-approval.operator-a.json"),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidCanaryResult(
      readJson("services/cashier-api/fixtures/canary-result.ok.json"),
    ),
  );

  assert.doesNotThrow(() =>
    assertValidReconciliationReport(
      readJson("services/cashier-api/fixtures/reconciliation-report.daily-ok.json"),
    ),
  );

  const runtimeFlags = readJson("services/cashier-api/fixtures/runtime-flags.default.json");
  for (const flag of runtimeFlags) {
    assert.doesNotThrow(() => assertValidRuntimeFlag(flag));
  }

  const bridgeFixturesDir = resolve(repoRoot, "services/bridge-watcher/fixtures");
  for (const file of readdirSync(bridgeFixturesDir)) {
    if (!file.endsWith(".json") || file === "provider-scenarios.manifest.json") {
      continue;
    }
    assert.doesNotThrow(() =>
      assertValidBridgeEvent(readJson(`services/bridge-watcher/fixtures/${file}`)),
    );
  }

  const relayerFixturesDir = resolve(repoRoot, "services/relayer/fixtures");
  for (const file of readdirSync(relayerFixturesDir)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    assert.doesNotThrow(() =>
      assertValidRelayerSubmission(readJson(`services/relayer/fixtures/${file}`)),
    );
  }
});

test("runtime validators reject unsafe fixture shapes", () => {
  assert.throws(() =>
    assertValidBridgeEvent({
      ...readJson("services/bridge-watcher/fixtures/relay-destination-confirmed.json"),
      destinationTxHash: undefined,
    }),
  );

  assert.throws(() =>
    assertValidDepositIntent({
      ...readJson("services/cashier-api/fixtures/deposit-intent.created.json"),
      sourceDecimals: 18,
    }),
  );

  assert.throws(() =>
    assertValidWithdrawalIntent({
      ...readJson("services/cashier-api/fixtures/withdrawal-intent.created.json"),
      userAuthorizationHash: undefined,
    }),
  );

  assert.throws(
    () =>
      assertValidDepositIntent({
        ...readJson("services/cashier-api/fixtures/deposit-intent.created.json"),
        id: undefined,
      }),
    /DepositIntent.id must be non-empty/,
  );
});

test("runtime validators reject unsupported enum values after JSON parsing", () => {
  assert.throws(() =>
    assertValidDepositIntent({
      ...readJson("services/cashier-api/fixtures/deposit-intent.created.json"),
      status: "credited_to_internal_ledger",
    }),
  );

  assert.throws(() =>
    assertValidBridgeEvent({
      ...readJson("services/bridge-watcher/fixtures/relay-source-detected.json"),
      provider: "unsigned-provider",
    }),
  );

  assert.throws(() =>
    assertValidRuntimeFlag({
      flagKey: "legacy_crypto_deposits_enabled",
      enabled: true,
      reason: "unsafe",
      updatedBy: "test",
      updatedAt: "2026-05-25T00:00:00.000Z",
    }),
  );

  const report = readJson("services/cashier-api/fixtures/reconciliation-report.daily-ok.json");
  assert.throws(() =>
    assertValidReconciliationReport({
      ...report,
      items: [{ ...report.items[0], status: "operator_eyeballed_it" }],
    }),
  );

  assert.throws(() =>
    assertValidComplianceDecision({
      ...readJson("services/cashier-api/fixtures/compliance-decision.quarantine.json"),
      decidedBy: "chat_room_vote",
    }),
  );

  assert.throws(() =>
    assertValidAuditEvent({
      ...readJson("services/cashier-api/fixtures/audit-event.recovery-created.json"),
      actorType: "spreadsheet",
    }),
  );

  assert.throws(() =>
    assertValidCashierUserWallet({
      ...readJson("services/cashier-api/fixtures/wallet.resolved.json"),
      smartWalletAddress: "not-an-address",
    }),
  );
});

test("canary result status must match worst check", () => {
  const canary = readJson("services/cashier-api/fixtures/canary-result.ok.json");
  assert.throws(() =>
    assertValidCanaryResult({
      ...canary,
      checks: [...canary.checks, { name: "provider", status: "fail", durationMs: 1 }],
    }),
  );
});

test("reconciliation matched items require equal units", () => {
  const report = readJson("services/cashier-api/fixtures/reconciliation-report.daily-ok.json");
  assert.throws(() =>
    assertValidReconciliationReport({
      ...report,
      items: [
        {
          ...report.items[0],
          observedUnits: "1",
        },
      ],
    }),
  );
});

test("reconciliation summary counts mismatches by status", () => {
  const report = readJson("services/cashier-api/fixtures/reconciliation-report.daily-ok.json");
  const summary = summarizeReconciliationReport({
    ...report,
    items: [
      ...report.items,
      {
        ...report.items[0],
        id: "recon_item_missing_chain",
        subjectId: "dep_missing_chain",
        observedUnits: "0",
        status: "missing_chain",
      },
      {
        ...report.items[0],
        id: "recon_item_quarantined",
        subjectId: "dep_quarantined",
        status: "quarantined",
      },
    ],
  });

  assert.equal(summary.itemCount, 3);
  assert.equal(summary.matchedCount, 1);
  assert.equal(summary.mismatchCount, 2);
  assert.equal(summary.byStatus.missing_chain, 1);
  assert.equal(summary.byStatus.quarantined, 1);
});

test("runtime flags default fail closed", () => {
  const runtimeFlags = readJson("services/cashier-api/fixtures/runtime-flags.default.json");
  assert.equal(isRuntimeFlagEnabled(runtimeFlags, "tron_deposits_enabled"), false);
  assert.equal(isRuntimeFlagEnabled(runtimeFlags, "withdrawals_enabled"), false);
  assert.equal(isRuntimeFlagEnabled([], "relayer_enabled"), false);
  assert.equal(
    isRuntimeFlagEnabled(
      [
        {
          flagKey: "relayer_enabled",
          enabled: true,
          reason: "test",
          updatedBy: "ops",
          updatedAt: "2026-05-25T00:00:00.000Z",
        },
      ],
      "relayer_enabled",
    ),
    true,
  );
});

test("relayer policy allows only constrained submissions", () => {
  const submission = readJson("services/relayer/fixtures/policy-approved-withdrawal.json");
  const allowed = evaluateRelayerPolicy({
    submission,
    complianceDecision: { decision: "allow" },
    allowedTargets: [submission.targetContract],
    allowedSelectors: ["0xa9059cbb"],
    calldataSelector: "0xa9059cbb",
    amount: {
      asset: "hUSD",
      chain: "settlement",
      decimals: 6,
      units: "10000000",
    },
    maxAmountUnits: "10000000",
    paymasterRunwaySeconds: 3600,
    minPaymasterRunwaySeconds: 600,
    alreadySubmittedOrIncluded: false,
    now: "2026-05-25T00:20:00.000Z",
  });

  assert.deepEqual(allowed, { decision: "allow", reasons: [] });

  const denied = evaluateRelayerPolicy({
    submission,
    complianceDecision: { decision: "manual_review" },
    allowedTargets: ["0x9999999999999999999999999999999999999999"],
    allowedSelectors: ["0xdeadbeef"],
    calldataSelector: "0xa9059cbb",
    amount: {
      asset: "hUSD",
      chain: "settlement",
      decimals: 6,
      units: "10000001",
    },
    maxAmountUnits: "10000000",
    paymasterRunwaySeconds: 10,
    minPaymasterRunwaySeconds: 600,
    alreadySubmittedOrIncluded: true,
    now: "2026-05-25T00:31:00.000Z",
    paused: true,
  });

  assert.equal(denied.decision, "deny");
  assert.ok(denied.reasons.includes("relayer_paused"));
  assert.ok(denied.reasons.includes("compliance_manual_review"));
  assert.ok(denied.reasons.includes("target_not_allowlisted"));
  assert.ok(denied.reasons.includes("selector_not_allowlisted"));
  assert.ok(denied.reasons.includes("amount_above_cap"));
  assert.ok(denied.reasons.includes("paymaster_runway_too_low"));
  assert.ok(denied.reasons.includes("idempotency_key_already_submitted"));
  assert.ok(denied.reasons.includes("authorization_expired"));
});

test("cashier compliance policy maps caps, geo, and screening to stable decisions", () => {
  assert.deepEqual(
    evaluateCashierCompliancePolicy({
      subjectType: "deposit",
      amount: { asset: "USDT", chain: "tron", decimals: 6, units: "25000000" },
      perTransactionCapUnits: "100000000",
      dailyAggregateUnits: "100000000",
      dailyCapUnits: "500000000",
      geoAllowed: true,
      addressScreening: "clear",
    }),
    { decision: "allow", reasons: [] },
  );

  const review = evaluateCashierCompliancePolicy({
    subjectType: "deposit",
    amount: { asset: "USDT", chain: "tron", decimals: 6, units: "125000000" },
    perTransactionCapUnits: "100000000",
    dailyAggregateUnits: "490000000",
    dailyCapUnits: "500000000",
    geoAllowed: true,
    addressScreening: "unavailable",
    paused: true,
  });
  assert.equal(review.decision, "manual_review");
  assert.ok(review.reasons.includes("per_transaction_cap_exceeded"));
  assert.ok(review.reasons.includes("daily_cap_exceeded"));
  assert.ok(review.reasons.includes("address_screening_unavailable"));
  assert.ok(review.reasons.includes("cashier_paused"));

  const quarantine = evaluateCashierCompliancePolicy({
    subjectType: "withdrawal",
    geoAllowed: true,
    addressScreening: "sanctions_hit",
  });
  assert.equal(quarantine.decision, "quarantine");

  const denyBeatsQuarantine = evaluateCashierCompliancePolicy({
    subjectType: "withdrawal",
    geoAllowed: false,
    addressScreening: "sanctions_hit",
  });
  assert.equal(denyBeatsQuarantine.decision, "deny");

  // There is no compliance bypass: geo_blocked and address_screening_unavailable
  // are always evaluated and always escalate, regardless of any beta/staging
  // context the caller might be in.
  const strictGeoBlockDeniesEvenWithUnavailableScreening = evaluateCashierCompliancePolicy({
    subjectType: "deposit",
    geoAllowed: false,
    addressScreening: "unavailable",
  });
  assert.equal(strictGeoBlockDeniesEvenWithUnavailableScreening.decision, "deny");
  assert.ok(strictGeoBlockDeniesEvenWithUnavailableScreening.reasons.includes("geo_blocked"));
  assert.ok(
    strictGeoBlockDeniesEvenWithUnavailableScreening.reasons.includes("address_screening_unavailable"),
  );

  const unavailableScreeningAloneEscalatesToManualReview = evaluateCashierCompliancePolicy({
    subjectType: "withdrawal",
    geoAllowed: true,
    addressScreening: "unavailable",
  });
  assert.equal(unavailableScreeningAloneEscalatesToManualReview.decision, "manual_review");
  assert.ok(
    unavailableScreeningAloneEscalatesToManualReview.reasons.includes("address_screening_unavailable"),
  );
});

test("provider callback signatures verify raw body before parsing", () => {
  const rawBody = '{"providerRequestId":"relay_req_test_001","status":"source"}';
  const secret = "test-secret";
  const computeHmacSha256 = (key, body) =>
    createHmac("sha256", key).update(body).digest("hex");
  const signatureHeader = `sha256=${computeHmacSha256(secret, rawBody)}`;

  assert.equal(
    verifyProviderCallbackSignature({
      rawBody,
      signatureHeader,
      secret,
      computeHmacSha256,
    }),
    true,
  );

  assert.equal(
    verifyProviderCallbackSignature({
      rawBody: JSON.stringify(JSON.parse(rawBody), null, 2),
      signatureHeader,
      secret,
      computeHmacSha256,
    }),
    false,
  );

  assert.throws(() =>
    assertValidBridgeEvent({
      ...readJson("services/bridge-watcher/fixtures/relay-source-detected.json"),
      callbackVerification: {
        envelope: {
          provider: "relay",
          receivedAt: "2026-05-25T00:05:00.000Z",
          signatureHeader,
          rawBodySha256: "not-a-sha256",
        },
        signatureVersion: "hmac-sha256-v1",
        verifiedAt: "2026-05-25T00:05:01.000Z",
        verifierKeyId: "relay-key-1",
      },
    }),
  );
});

test("bridge event reducer updates deposit intents without terminal mutation", () => {
  const intent = readJson("services/cashier-api/fixtures/deposit-intent.created.json");
  const sourceEvent = readJson("services/bridge-watcher/fixtures/relay-source-detected.json");
  const destinationEvent = readJson(
    "services/bridge-watcher/fixtures/relay-destination-confirmed.json",
  );

  const detected = applyBridgeEventToDepositIntent(
    intent,
    sourceEvent,
    "2026-05-25T00:05:01.000Z",
  );
  assert.equal(detected.status, "source_detected");
  assert.equal(detected.actualSourceAmount.units, "25000000");

  const bridging = applyBridgeEventToDepositIntent(
    detected,
    destinationEvent,
    "2026-05-25T00:08:01.000Z",
  );
  assert.equal(bridging.status, "bridging");

  const settled = applyBridgeEventToDepositIntent(
    bridging,
    destinationEvent,
    "2026-05-25T00:08:02.000Z",
  );
  assert.equal(settled.status, "settled");
  assert.equal(settled.settledAmount.units, "24900000");

  const quarantined = readJson(
    "services/bridge-watcher/fixtures/relay-quarantined-destination-mismatch.json",
  );
  const unchanged = applyBridgeEventToDepositIntent(
    settled,
    quarantined,
    "2026-05-25T00:09:01.000Z",
  );
  assert.deepEqual(unchanged, settled);
});

test("recovery case reducer creates triage case from quarantined event", () => {
  const intent = readJson("services/cashier-api/fixtures/deposit-intent.created.json");
  const event = readJson(
    "services/bridge-watcher/fixtures/relay-quarantined-destination-mismatch.json",
  );
  const recoveryCase = createRecoveryCaseFromBridgeEvent({
    id: "rec_generated_001",
    intent,
    event,
    openedAt: "2026-05-25T00:09:31.000Z",
  });

  assert.equal(recoveryCase.subjectId, intent.id);
  assert.equal(recoveryCase.status, "triage");
  assert.equal(recoveryCase.recoveryReason, "ambiguous_source");
  assert.equal(recoveryCase.destinationTxHash, event.destinationTxHash);
});

test("two-person approval requires distinct approving operators", () => {
  const approval = readJson("services/cashier-api/fixtures/recovery-approval.operator-a.json");

  assert.equal(
    hasTwoPersonApproval([approval, { ...approval, id: "approval_test_002" }], "release_above_beta_cap"),
    false,
  );

  assert.equal(
    hasTwoPersonApproval(
      [
        approval,
        {
          ...approval,
          id: "approval_test_002",
          operatorId: "ops_bea",
        },
      ],
      "release_above_beta_cap",
    ),
    true,
  );

  assert.equal(
    hasTwoPersonApproval(
      [
        approval,
        {
          ...approval,
          id: "approval_test_003",
          operatorId: "ops_bea",
          decision: "deny",
        },
      ],
      "release_above_beta_cap",
    ),
    false,
  );
});
