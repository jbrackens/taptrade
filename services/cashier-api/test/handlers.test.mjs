import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCashierHandlers } from "../src/handlers.mjs";
import { createInMemoryCashierRepository } from "../src/repository.mjs";

const fixtures = {
  wallet: readJson("../fixtures/wallet.resolved.json"),
  runtimeFlags: readJson("../fixtures/runtime-flags.default.json"),
  recoveryCase: readJson("../fixtures/recovery-case.destination-mismatch.json"),
};

test("mutating cashier handlers write immutable audit events", async () => {
  const repo = createInMemoryCashierRepository({
    wallets: [fixtures.wallet],
    runtimeFlags: fixtures.runtimeFlags,
  });
  const handlers = createCashierHandlers({
    repo,
    providerAdapter: {
      async createDepositRoute() {
        return {
          depositIntentId: "dep_audit_001",
          sourceChain: "tron",
          sourceAsset: "USDT",
          sourceDecimals: 6,
          settlementAsset: "hUSD",
          provider: "relay",
          providerRequestId: "relay_req_audit_001",
          depositAddress: "TMockDepositAddressForAudit111111111111",
          createdAt: "2026-05-25T00:25:00.000Z",
        };
      },
    },
    now: () => "2026-05-25T00:25:00.000Z",
  });

  await repo.setRuntimeFlag({
    flagKey: "tron_deposits_enabled",
    enabled: true,
    reason: "audit test",
    updatedBy: "test",
    updatedAt: "2026-05-25T00:24:00.000Z",
  });
  const response = await handlers.createDepositIntent(
    {
      userId: fixtures.wallet.userId,
      idempotencyKey: "deposit-intent:audit:001",
    },
    { rail: "tron-usdt-deposit-address", settlementChain: "polygon" },
  );
  assert.equal(response.status, 201);

  const auditEvents = await repo.listAuditEventsBySubject("deposit", response.body.id);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].eventType, "cashier.deposit_intent.created");
  assert.equal(auditEvents[0].actorType, "user");
  assert.equal(auditEvents[0].actorId, fixtures.wallet.userId);
  assert.match(auditEvents[0].payloadSha256, /^[a-f0-9]{64}$/);
});

test("recovery approval status requires two distinct approving operators", async () => {
  const repo = createInMemoryCashierRepository({
    recoveryCases: [fixtures.recoveryCase],
  });
  const handlers = createCashierHandlers({
    repo,
    providerAdapter: {},
    now: () => "2026-05-25T00:25:00.000Z",
  });
  const approvalType = "release_above_beta_cap";

  const first = await handlers.recordRecoveryApproval(
    { operatorId: "ops_ana", roles: ["cashier_operator"] },
    fixtures.recoveryCase.id,
    {
      approvalType,
      decision: "approve",
      evidenceSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      note: "first approval",
    },
  );
  assert.equal(first.status, 201);

  const afterFirst = await handlers.getRecoveryApprovalStatus(
    { operatorId: "ops_ana", roles: ["cashier_operator"] },
    fixtures.recoveryCase.id,
    approvalType,
  );
  assert.equal(afterFirst.body.approvalCount, 1);
  assert.equal(afterFirst.body.twoPersonApproved, false);

  await handlers.recordRecoveryApproval(
    { operatorId: "ops_bea", roles: ["cashier_operator"] },
    fixtures.recoveryCase.id,
    {
      approvalType,
      decision: "approve",
      evidenceSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      note: "second approval",
    },
  );

  const afterSecond = await handlers.getRecoveryApprovalStatus(
    { operatorId: "ops_ana", roles: ["cashier_operator"] },
    fixtures.recoveryCase.id,
    approvalType,
  );
  assert.equal(afterSecond.body.approvalCount, 2);
  assert.equal(afterSecond.body.twoPersonApproved, true);

  const auditEvents = await repo.listAuditEventsBySubject(
    "recovery_case",
    fixtures.recoveryCase.id,
  );
  assert.equal(auditEvents.length, 2);
  assert.ok(auditEvents.every((event) => event.actorType === "operator"));
});

test("operator can generate a daily reconciliation report from persisted observations", async () => {
  const depositIntent = {
    id: "dep_recon_001",
    userId: fixtures.wallet.userId,
    rail: "tron-usdt-deposit-address",
    status: "settled",
    sourceChain: "tron",
    sourceAsset: "USDT",
    sourceDecimals: 6,
    settlementChain: "polygon",
    settlementAsset: "hUSD",
    destinationWalletAddress: fixtures.wallet.smartWalletAddress,
    provider: "relay",
    providerRequestId: "relay_req_recon_001",
    depositAddress: "TMockDepositAddressForRecon111111111111",
    settledAmount: {
      asset: "hUSD",
      chain: "settlement",
      decimals: 6,
      units: "24900000",
    },
    idempotencyKey: "deposit-intent:recon:001",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:08:00.000Z",
  };
  const repo = createInMemoryCashierRepository({
    depositIntents: [depositIntent],
    bridgeEvents: [
      {
        id: "bridge_evt_recon_001",
        provider: "relay",
        providerRequestId: "relay_req_recon_001",
        depositIntentId: depositIntent.id,
        status: "destination_confirmed",
        idempotencyKey: "relay:recon:001",
        sourceChain: "tron",
        sourceTxHash: "tron_tx_recon_001",
        destinationChain: "polygon",
        destinationTxHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        destinationWalletAddress: fixtures.wallet.smartWalletAddress,
        amount: {
          asset: "hUSD",
          chain: "settlement",
          decimals: 6,
          units: "24900000",
        },
        observedAt: "2026-05-25T00:08:00.000Z",
        createdAt: "2026-05-25T00:08:01.000Z",
      },
    ],
  });
  const handlers = createCashierHandlers({
    repo,
    providerAdapter: {},
    now: () => "2026-05-25T23:59:00.000Z",
  });

  const response = await handlers.generateReconciliationReport(
    { operatorId: "ops_ana", roles: ["cashier_operator"] },
    "2026-05-25",
  );
  assert.equal(response.status, 201);
  assert.equal(response.body.items.length, 1);
  assert.equal(response.body.items[0].status, "matched");

  const saved = await handlers.getReconciliationReport(
    { operatorId: "ops_ana", roles: ["cashier_operator"] },
    "2026-05-25",
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.body.id, response.body.id);

  const auditEvents = await repo.listAuditEventsBySubject(
    "reconciliation_report",
    response.body.id,
  );
  assert.equal(auditEvents[0].eventType, "cashier.reconciliation.completed");
  assert.equal(auditEvents[0].eventPayload.mismatchCount, 0);
});

test("operator runtime flag changes are allowlisted and audited", async () => {
  const repo = createInMemoryCashierRepository({
    runtimeFlags: fixtures.runtimeFlags,
  });
  const handlers = createCashierHandlers({
    repo,
    providerAdapter: {},
    now: () => "2026-05-25T00:30:00.000Z",
  });
  const operatorCtx = { operatorId: "ops_ana", roles: ["cashier_operator"] };

  assert.equal((await handlers.setRuntimeFlag({}, "withdrawals_enabled", {})).status, 403);
  assert.equal(
    (await handlers.setRuntimeFlag(operatorCtx, "unsupported_flag", {
      enabled: true,
      reason: "test",
    })).status,
    400,
  );
  assert.equal(
    (await handlers.setRuntimeFlag(operatorCtx, "withdrawals_enabled", {
      enabled: true,
    })).status,
    400,
  );

  const response = await handlers.setRuntimeFlag(
    operatorCtx,
    "withdrawals_enabled",
    {
      enabled: true,
      reason: "incident drill",
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.enabled, true);
  assert.equal(response.body.updatedBy, "ops_ana");

  const listed = await handlers.listRuntimeFlags(operatorCtx);
  assert.equal(listed.status, 200);
  assert.ok(
    listed.body.runtimeFlags.some(
      (flag) => flag.flagKey === "withdrawals_enabled" && flag.enabled === true,
    ),
  );

  const auditEvents = await repo.listAuditEventsBySubject(
    "runtime_flag",
    "withdrawals_enabled",
  );
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].eventType, "cashier.runtime_flag.changed");
  assert.equal(auditEvents[0].actorId, "ops_ana");
});

test("createWithdrawalIntent validates the request before it ever reaches the repository", async () => {
  const repo = createInMemoryCashierRepository({
    wallets: [fixtures.wallet],
    runtimeFlags: fixtures.runtimeFlags,
  });
  const handlers = createCashierHandlers({
    repo,
    providerAdapter: {},
    now: () => "2026-05-25T00:25:00.000Z",
  });
  const userCtx = { userId: fixtures.wallet.userId, idempotencyKey: "withdrawal:user_maria_001:validate:001" };
  const validBody = {
    destinationAddress: "0x7777777777777777777777777777777777777777",
    amountUnits: "10000000",
    asset: "hUSD",
    settlementChain: "polygon",
    userAuthorizationHash: "0x8888888888888888888888888888888888888888888888888888888888888888",
    userAuthorizationNonce: "withdrawal:user_maria_001:000001",
    userAuthorizationExpiresAt: "2026-05-25T00:30:00.000Z",
  };

  const unauth = await handlers.createWithdrawalIntent({}, validBody);
  assert.equal(unauth.status, 401);

  const noIdempotency = await handlers.createWithdrawalIntent({ userId: fixtures.wallet.userId }, validBody);
  assert.equal(noIdempotency.status, 400);

  const badAddress = await handlers.createWithdrawalIntent(userCtx, {
    ...validBody,
    destinationAddress: "not-an-address",
  });
  assert.equal(badAddress.status, 400);
  assert.equal(badAddress.body.field, "destinationAddress");

  const badAsset = await handlers.createWithdrawalIntent(userCtx, { ...validBody, asset: "BTC" });
  assert.equal(badAsset.status, 400);
  assert.equal(badAsset.body.field, "asset");

  const zeroAmount = await handlers.createWithdrawalIntent(userCtx, { ...validBody, amountUnits: "0" });
  assert.equal(zeroAmount.status, 400);
  assert.equal(zeroAmount.body.field, "amountUnits");

  const nonNumericAmount = await handlers.createWithdrawalIntent(userCtx, {
    ...validBody,
    amountUnits: "12.5",
  });
  assert.equal(nonNumericAmount.status, 400);
  assert.equal(nonNumericAmount.body.field, "amountUnits");

  const badChain = await handlers.createWithdrawalIntent(userCtx, {
    ...validBody,
    settlementChain: "ethereum",
  });
  assert.equal(badChain.status, 400);
  assert.equal(badChain.body.field, "settlementChain");

  // None of the invalid requests above should have reached the repository.
  assert.deepEqual(await repo.listWithdrawalIntentsByUser(fixtures.wallet.userId), []);
});

test("createWithdrawalIntent enforces withdrawals_enabled and is idempotent on replay", async () => {
  const repo = createInMemoryCashierRepository({
    wallets: [fixtures.wallet],
    runtimeFlags: fixtures.runtimeFlags,
  });
  const handlers = createCashierHandlers({
    repo,
    providerAdapter: {},
    now: () => "2026-05-25T00:25:00.000Z",
  });
  const userCtx = { userId: fixtures.wallet.userId, idempotencyKey: "withdrawal:user_maria_001:create:001" };
  const body = {
    destinationAddress: "0x7777777777777777777777777777777777777777",
    amountUnits: "10000000",
    asset: "hUSD",
    settlementChain: "polygon",
    userAuthorizationHash: "0x8888888888888888888888888888888888888888888888888888888888888888",
    userAuthorizationNonce: "withdrawal:user_maria_001:000001",
    userAuthorizationExpiresAt: "2026-05-25T00:30:00.000Z",
  };

  const disabled = await handlers.createWithdrawalIntent(userCtx, body);
  assert.equal(disabled.status, 423);
  assert.equal(disabled.body.flagKey, "withdrawals_enabled");

  await repo.setRuntimeFlag({
    flagKey: "withdrawals_enabled",
    enabled: true,
    reason: "handler test",
    updatedBy: "test",
    updatedAt: "2026-05-25T00:24:00.000Z",
  });

  const created = await handlers.createWithdrawalIntent(userCtx, body);
  assert.equal(created.status, 201);
  assert.equal(created.body.status, "user_authorized");
  assert.equal(created.body.amount.units, "10000000");

  const auditEvents = await repo.listAuditEventsBySubject("withdrawal", created.body.id);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].eventType, "cashier.withdrawal_intent.created");

  const replayed = await handlers.createWithdrawalIntent(userCtx, body);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.id, created.body.id);
});

test("ingestProviderCallback enforces the provider_callbacks_enabled flag, rejects bad signatures, and dedupes duplicates", async () => {
  const repo = createInMemoryCashierRepository({
    runtimeFlags: fixtures.runtimeFlags,
  });
  const handlers = createCashierHandlers({
    repo,
    providerAdapter: {},
    now: () => "2026-05-25T00:25:00.000Z",
  });
  const event = {
    id: "evt_handler_test_001",
    providerRequestId: "relay_req_handler_001",
    status: "source_confirmed",
    idempotencyKey: "deposit:relay:tron:tron_tx_handler_001:0",
    sourceChain: "tron",
    sourceTxHash: "tron_tx_handler_001",
    amount: { asset: "USDT", chain: "tron", decimals: 6, units: "25000000" },
    observedAt: "2026-05-25T00:05:00.000Z",
  };

  // disabled-flag branch
  const disabled = await handlers.ingestProviderCallback(
    { providerSignatureVerified: true },
    "relay",
    event,
  );
  assert.equal(disabled.status, 423);
  assert.equal(disabled.body.error, "provider_callbacks_disabled");

  await repo.setRuntimeFlag({
    flagKey: "provider_callbacks_enabled",
    enabled: true,
    reason: "handler test",
    updatedBy: "test",
    updatedAt: "2026-05-25T00:24:00.000Z",
  });

  // signature-failure branch
  const badSignature = await handlers.ingestProviderCallback(
    { providerSignatureVerified: false },
    "relay",
    event,
  );
  assert.equal(badSignature.status, 401);
  assert.equal(badSignature.body.error, "invalid_provider_signature");
  assert.deepEqual(await repo.listBridgeEvents(), []);

  // first accepted delivery
  const accepted = await handlers.ingestProviderCallback(
    { providerSignatureVerified: true },
    "relay",
    event,
  );
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.accepted, true);
  assert.equal(accepted.body.duplicate, false);

  // duplicate branch: same idempotency key delivered again
  const duplicate = await handlers.ingestProviderCallback(
    { providerSignatureVerified: true },
    "relay",
    event,
  );
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.bridgeEventId, accepted.body.bridgeEventId);

  assert.equal((await repo.listBridgeEvents()).length, 1);
});

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}
