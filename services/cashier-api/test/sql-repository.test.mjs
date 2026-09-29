import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createInMemoryCashierRepository } from "../src/repository.mjs";
import {
  createSqlCashierRepository,
  decimalForAssetOnChain,
} from "../src/sql-repository.mjs";
import { CashierConflictError, CashierValidationError } from "../src/errors.mjs";

const fixtures = {
  wallet: readJson("../fixtures/wallet.resolved.json"),
  deposit: readJson("../fixtures/deposit-intent.created.json"),
  withdrawal: readJson("../fixtures/withdrawal-intent.created.json"),
  runtimeFlags: readJson("../fixtures/runtime-flags.default.json"),
  recoveryCase: readJson("../fixtures/recovery-case.destination-mismatch.json"),
  recoveryApproval: readJson("../fixtures/recovery-approval.operator-a.json"),
  auditEvent: readJson("../fixtures/audit-event.recovery-created.json"),
  reconciliationReport: readJson("../fixtures/reconciliation-report.daily-ok.json"),
};

test("SQL repository exposes the same public methods as the in-memory repository", () => {
  const sqlMethods = Object.keys(createSqlCashierRepository(new ScriptedClient())).sort();
  const memoryMethods = Object.keys(createInMemoryCashierRepository()).sort();

  assert.deepEqual(sqlMethods, memoryMethods);
  assert.throws(() => createSqlCashierRepository(), /query client/);
});

test("wallets, runtime flags, deposits, and withdrawals are parameterized and normalized", async () => {
  const depositWithAmounts = {
    ...fixtures.deposit,
    expectedSourceAmount: {
      asset: fixtures.deposit.sourceAsset,
      chain: fixtures.deposit.sourceChain,
      decimals: fixtures.deposit.sourceDecimals,
      units: "24900000",
    },
    actualSourceAmount: {
      asset: fixtures.deposit.sourceAsset,
      chain: fixtures.deposit.sourceChain,
      decimals: fixtures.deposit.sourceDecimals,
      units: "25000000",
    },
    settledAmount: {
      asset: fixtures.deposit.settlementAsset,
      chain: "settlement",
      decimals: 6,
      units: "24900000",
    },
  };
  const client = new ScriptedClient([
    {
      name: "upsert wallet",
      match: /insert into cashier_wallets/i,
      assertParams(params) {
        assert.equal(params[1], fixtures.wallet.userId);
        assert.equal(params[2], fixtures.wallet.embeddedWalletAddress);
      },
      rows: [walletRow()],
    },
    {
      name: "set runtime flag",
      match: /insert into cashier_runtime_flags/i,
      assertParams(params) {
        assert.deepEqual(params, [
          "withdrawals_enabled",
          true,
          "test enablement",
          "ops_test",
          "2026-05-25T01:00:00.000Z",
        ]);
      },
      rows: [
        runtimeFlagRow({
          flag_key: "withdrawals_enabled",
          enabled: true,
          reason: "test enablement",
          updated_by: "ops_test",
          updated_at: "2026-05-25T01:00:00.000Z",
        }),
      ],
    },
    {
      name: "save deposit",
      match: /insert into deposit_intents/i,
      assertParams(params) {
        assert.equal(params[13], "24900000");
        assert.equal(params[14], "25000000");
        assert.equal(params[15], "24900000");
        assert.equal(params[19], fixtures.deposit.idempotencyKey);
      },
      rows: [depositRow({ expected_source_units: "24900000", actual_source_units: "25000000", settled_units: "24900000" })],
    },
    {
      name: "find deposit idempotently",
      match: /from deposit_intents\s+where user_id = \$1\s+and idempotency_key = \$2/i,
      assertParams(params) {
        assert.deepEqual(params, [fixtures.deposit.userId, fixtures.deposit.idempotencyKey]);
      },
      rows: [depositRow()],
    },
    {
      name: "save withdrawal",
      match: /insert into withdrawal_intents/i,
      assertParams(params) {
        assert.equal(params[6], fixtures.withdrawal.amount.asset);
        assert.equal(params[7], fixtures.withdrawal.amount.decimals);
        assert.equal(params[8], fixtures.withdrawal.amount.units);
        assert.equal(params[9], fixtures.withdrawal.idempotencyKey);
      },
      rows: [withdrawalRow()],
    },
    {
      name: "find withdrawal idempotently",
      match: /from withdrawal_intents\s+where user_id = \$1\s+and idempotency_key = \$2/i,
      assertParams(params) {
        assert.deepEqual(params, [fixtures.withdrawal.userId, fixtures.withdrawal.idempotencyKey]);
      },
      rows: [withdrawalRow()],
    },
  ]);
  const repo = createSqlCashierRepository(client);

  assert.deepEqual(await repo.upsertWallet(fixtures.wallet), fixtures.wallet);

  const flag = await repo.setRuntimeFlag({
    flagKey: "withdrawals_enabled",
    enabled: true,
    reason: "test enablement",
    updatedBy: "ops_test",
    updatedAt: "2026-05-25T01:00:00.000Z",
  });
  assert.equal(flag.enabled, true);

  const savedDeposit = await repo.saveDepositIntent(depositWithAmounts);
  assert.equal(savedDeposit.expectedSourceAmount.units, "24900000");
  assert.equal(savedDeposit.actualSourceAmount.units, "25000000");
  assert.equal(savedDeposit.settledAmount.chain, "settlement");

  const foundDeposit = await repo.findDepositIntentByIdempotencyKey(
    fixtures.deposit.userId,
    fixtures.deposit.idempotencyKey,
  );
  assert.equal(foundDeposit.id, fixtures.deposit.id);

  const savedWithdrawal = await repo.saveWithdrawalIntent(fixtures.withdrawal);
  assert.deepEqual(savedWithdrawal.amount, fixtures.withdrawal.amount);

  const foundWithdrawal = await repo.findWithdrawalIntentByIdempotencyKey(
    fixtures.withdrawal.userId,
    fixtures.withdrawal.idempotencyKey,
  );
  assert.equal(foundWithdrawal.id, fixtures.withdrawal.id);

  assertNoDynamicValuesInSql(client.calls, [
    fixtures.deposit.idempotencyKey,
    fixtures.withdrawal.idempotencyKey,
    fixtures.wallet.smartWalletAddress,
  ]);
});

test("bridge events are deduped by idempotency key and flattened at the SQL boundary", async () => {
  const bridgeEvent = {
    id: "evt_test_011",
    provider: "relay",
    providerRequestId: "relay_req_test_001",
    depositIntentId: fixtures.deposit.id,
    status: "source_confirmed",
    idempotencyKey: "deposit:relay:tron:tron_tx_test_001:0",
    sourceChain: "tron",
    sourceTxHash: "tron_tx_test_001",
    sourceAddress: "TMockMariaSourceAddress111111111111111",
    depositAddress: fixtures.deposit.depositAddress,
    destinationChain: "polygon",
    destinationWalletAddress: fixtures.deposit.destinationWalletAddress,
    amount: {
      asset: "USDT",
      chain: "tron",
      decimals: 6,
      units: "25000000",
    },
    callbackVerification: {
      envelope: {
        provider: "relay",
        receivedAt: "2026-05-25T00:05:00.000Z",
        signatureHeader: "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        rawBodySha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      signatureVersion: "hmac-sha256-v1",
      verifiedAt: "2026-05-25T00:05:01.000Z",
      verifierKeyId: "relay-key-1",
    },
    observedAt: "2026-05-25T00:05:00.000Z",
  };
  const client = new ScriptedClient([
    {
      name: "insert bridge event",
      match: /insert into bridge_events/i,
      assertParams(params) {
        assert.equal(params[5], bridgeEvent.idempotencyKey);
        assert.equal(params[13], bridgeEvent.amount.units);
        assert.equal(params[14], bridgeEvent.amount.asset);
        assert.equal(params[17], bridgeEvent.callbackVerification.envelope.rawBodySha256);
        assert.equal(params[18], bridgeEvent.callbackVerification.signatureVersion);
        assert.equal(params[19], bridgeEvent.callbackVerification.verifierKeyId);
      },
      rows: [bridgeEventRow()],
    },
    {
      name: "duplicate insert",
      match: /insert into bridge_events/i,
      rows: [],
    },
    {
      name: "reload duplicate",
      match: /from bridge_events\s+where idempotency_key = \$1/i,
      assertParams(params) {
        assert.deepEqual(params, [bridgeEvent.idempotencyKey]);
      },
      rows: [bridgeEventRow()],
    },
  ]);
  const repo = createSqlCashierRepository(client);

  const inserted = await repo.insertBridgeEvent(bridgeEvent);
  assert.equal(inserted.inserted, true);
  assert.equal(inserted.event.amount.units, "25000000");

  const duplicate = await repo.insertBridgeEvent(bridgeEvent);
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.event.id, bridgeEvent.id);
  assert.equal(duplicate.event.idempotencyKey, bridgeEvent.idempotencyKey);

  assertNoDynamicValuesInSql(client.calls, [bridgeEvent.idempotencyKey, bridgeEvent.amount.units]);
});

test("recovery cases, approvals, and reconciliation reports use SQL rows with JS contract names", async () => {
  const client = new ScriptedClient([
    {
      name: "list recovery cases",
      match: /from recovery_cases\s+where status = \$1/i,
      assertParams(params) {
        assert.deepEqual(params, ["triage"]);
      },
      rows: [recoveryCaseRow()],
    },
    {
      name: "save recovery case",
      match: /insert into recovery_cases/i,
      rows: [recoveryCaseRow({ assigned_operator_id: "ops_ana" })],
    },
    {
      name: "record recovery approval",
      match: /insert into recovery_approvals/i,
      rows: [recoveryApprovalRow()],
    },
    {
      name: "list recovery approvals",
      match: /from recovery_approvals\s+where recovery_case_id = \$1/i,
      assertParams(params) {
        assert.deepEqual(params, [fixtures.recoveryCase.id]);
      },
      rows: [recoveryApprovalRow()],
    },
    {
      name: "get reconciliation report",
      match: /from reconciliation_reports\s+where business_date = \$1::date/i,
      assertParams(params) {
        assert.deepEqual(params, [fixtures.reconciliationReport.businessDate]);
      },
      rows: [reconciliationReportRow()],
    },
    {
      name: "get reconciliation items",
      match: /from reconciliation_items\s+where report_id = \$1/i,
      assertParams(params) {
        assert.deepEqual(params, [fixtures.reconciliationReport.id]);
      },
      rows: fixtures.reconciliationReport.items.map(reconciliationItemRow),
    },
  ]);
  const repo = createSqlCashierRepository(client);

  const cases = await repo.listRecoveryCases({ status: "triage" });
  assert.equal(cases[0].subjectType, "deposit");
  assert.equal(cases[0].recoveryReason, "ambiguous_source");

  await assert.rejects(
    () => repo.listRecoveryCases({ unsupported: "value" }),
    (err) => {
      assert.ok(err instanceof CashierValidationError);
      assert.equal(err.field, "unsupported");
      return true;
    },
  );

  const savedCase = await repo.saveRecoveryCase({
    ...fixtures.recoveryCase,
    assignedOperatorId: "ops_ana",
  });
  assert.equal(savedCase.assignedOperatorId, "ops_ana");

  const approval = await repo.recordRecoveryApproval(fixtures.recoveryApproval);
  assert.equal(approval.recoveryCaseId, fixtures.recoveryCase.id);

  const approvals = await repo.listRecoveryApprovals(fixtures.recoveryCase.id);
  assert.equal(approvals[0].operatorId, fixtures.recoveryApproval.operatorId);

  const report = await repo.getReconciliationReportByBusinessDate(
    fixtures.reconciliationReport.businessDate,
  );
  assert.deepEqual(report, fixtures.reconciliationReport);
});

test("audit events are persisted immutably and loaded by subject", async () => {
  const client = new ScriptedClient([
    {
      name: "record audit event",
      match: /insert into cashier_audit_events/i,
      assertParams(params) {
        assert.equal(params[0], fixtures.auditEvent.id);
        assert.equal(params[1], fixtures.auditEvent.subjectType);
        assert.equal(params[2], fixtures.auditEvent.subjectId);
        assert.equal(params[4], JSON.stringify(fixtures.auditEvent.eventPayload));
        assert.equal(params[5], fixtures.auditEvent.payloadSha256);
      },
      rows: [auditEventRow()],
    },
    {
      name: "list audit events",
      match: /from cashier_audit_events\s+where subject_type = \$1\s+and subject_id = \$2/i,
      assertParams(params) {
        assert.deepEqual(params, [fixtures.auditEvent.subjectType, fixtures.auditEvent.subjectId]);
      },
      rows: [auditEventRow()],
    },
  ]);
  const repo = createSqlCashierRepository(client);

  assert.deepEqual(await repo.recordAuditEvent(fixtures.auditEvent), fixtures.auditEvent);
  assert.deepEqual(await repo.listAuditEventsBySubject("deposit", fixtures.deposit.id), [
    fixtures.auditEvent,
  ]);
});

test("reconciliation generation repository methods persist reports and items", async () => {
  const generated = {
    ...fixtures.reconciliationReport,
    id: "recon_generated_2026_05_25",
    generatedBy: "ops_ana",
  };
  const client = new ScriptedClient([
    {
      name: "list deposits for reconciliation",
      match: /from deposit_intents\s+where created_at >= \$1::date\s+and created_at < \(\$1::date \+ interval '1 day'\)/i,
      assertParams(params) {
        assert.deepEqual(params, [fixtures.reconciliationReport.businessDate]);
      },
      rows: [depositRow()],
    },
    {
      name: "save reconciliation report",
      match: /insert into reconciliation_reports/i,
      assertParams(params) {
        assert.deepEqual(params, [
          generated.id,
          generated.businessDate,
          generated.generatedAt,
          generated.generatedBy,
        ]);
      },
      rows: [reconciliationReportRow({
        id: generated.id,
        generated_by: generated.generatedBy,
      })],
    },
    {
      name: "save reconciliation item",
      match: /insert into reconciliation_items/i,
      assertParams(params) {
        assert.equal(params[1], generated.id);
        assert.equal(params[2], generated.items[0].subjectType);
        assert.equal(params[3], generated.items[0].subjectId);
      },
      rows: [reconciliationItemRow(generated.items[0], generated.id)],
    },
  ]);
  const repo = createSqlCashierRepository(client);

  const deposits = await repo.listDepositIntentsForReconciliation(
    fixtures.reconciliationReport.businessDate,
  );
  assert.equal(deposits[0].id, fixtures.deposit.id);

  assert.deepEqual(await repo.saveReconciliationReport(generated), generated);
});

test("saveReconciliationReport writes the report and its items in one transaction on a checked-out client", async () => {
  const generated = {
    ...fixtures.reconciliationReport,
    id: "recon_txn_2026_05_25",
    generatedBy: "ops_ana",
  };
  const client = new ScriptedClient([
    {
      name: "save reconciliation report",
      match: /insert into reconciliation_reports/i,
      rows: [reconciliationReportRow({ id: generated.id, generated_by: generated.generatedBy })],
    },
    {
      name: "save reconciliation item",
      match: /insert into reconciliation_items/i,
      rows: [reconciliationItemRow(generated.items[0], generated.id)],
    },
  ]);
  const repo = createSqlCashierRepository(client);

  await repo.saveReconciliationReport(generated);

  const verbs = client.calls.map((call) => squash(call.text).toUpperCase());
  assert.equal(verbs[0], "BEGIN");
  assert.equal(verbs.at(-1), "COMMIT");
  assert.ok(verbs.some((text) => text.startsWith("INSERT INTO RECONCILIATION_REPORTS")));
  assert.ok(verbs.some((text) => text.startsWith("INSERT INTO RECONCILIATION_ITEMS")));
  assert.equal(client.released, 1, "the checked-out client must be released");

  // A client without connect() (e.g. a bare non-pooled query client) cannot
  // safely run a transaction, so this must fail loudly rather than silently
  // writing the report and items non-atomically.
  const bareClient = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    () => createSqlCashierRepository(bareClient).saveReconciliationReport(generated),
    /requires a pool with connect\(\)/,
  );
});

test("saveReconciliationReport rolls back and releases the client when an item write fails", async () => {
  const generated = {
    ...fixtures.reconciliationReport,
    id: "recon_txn_fail_2026_05_25",
    generatedBy: "ops_ana",
  };
  const client = new ScriptedClient([
    {
      name: "save reconciliation report",
      match: /insert into reconciliation_reports/i,
      rows: [reconciliationReportRow({ id: generated.id, generated_by: generated.generatedBy })],
    },
    {
      name: "save reconciliation item (fails)",
      match: /insert into reconciliation_items/i,
      rows() {
        throw new Error("simulated item write failure");
      },
    },
  ]);
  const repo = createSqlCashierRepository(client);

  await assert.rejects(
    () => repo.saveReconciliationReport(generated),
    /simulated item write failure/,
  );

  const verbs = client.calls.map((call) => squash(call.text).toUpperCase());
  assert.equal(verbs[0], "BEGIN");
  assert.equal(verbs.at(-1), "ROLLBACK");
  assert.equal(client.released, 1, "the checked-out client must still be released on failure");
});

test("saveDepositIntent, saveWithdrawalIntent, and saveRecoveryCase reject a concurrent status change", async () => {
  // --- deposit intent ---
  {
    const client = new ScriptedClient([
      { name: "conflicting update", match: /insert into deposit_intents/i, rows: [] },
      {
        name: "matching update",
        match: /insert into deposit_intents/i,
        assertParams(params, text) {
          assert.match(squash(text), /where deposit_intents\.status = \$23/i);
          assert.equal(params[22], "created");
        },
        rows: [depositRow({ status: "address_issued" })],
      },
      {
        name: "blind upsert (no expectedStatus)",
        match: /insert into deposit_intents/i,
        assertParams(params, text) {
          assert.doesNotMatch(squash(text), /where deposit_intents\.status/i);
        },
        rows: [depositRow()],
      },
    ]);
    const repo = createSqlCashierRepository(client);

    await assert.rejects(
      () =>
        repo.saveDepositIntent(
          { ...fixtures.deposit, status: "address_issued" },
          { expectedStatus: "created" },
        ),
      (err) => err instanceof CashierConflictError,
    );

    const updated = await repo.saveDepositIntent(
      { ...fixtures.deposit, status: "address_issued" },
      { expectedStatus: "created" },
    );
    assert.equal(updated.status, "address_issued");

    const blind = await repo.saveDepositIntent(fixtures.deposit);
    assert.equal(blind.id, fixtures.deposit.id);
  }

  // --- withdrawal intent ---
  {
    const client = new ScriptedClient([
      { name: "conflicting update", match: /insert into withdrawal_intents/i, rows: [] },
      {
        name: "matching update",
        match: /insert into withdrawal_intents/i,
        assertParams(params, text) {
          assert.match(squash(text), /where withdrawal_intents\.status = \$19/i);
          assert.equal(params[18], "user_authorized");
        },
        rows: [withdrawalRow({ status: "policy_approved" })],
      },
    ]);
    const repo = createSqlCashierRepository(client);

    await assert.rejects(
      () =>
        repo.saveWithdrawalIntent(
          { ...fixtures.withdrawal, status: "policy_approved" },
          { expectedStatus: "user_authorized" },
        ),
      (err) => err instanceof CashierConflictError,
    );

    const updated = await repo.saveWithdrawalIntent(
      { ...fixtures.withdrawal, status: "policy_approved" },
      { expectedStatus: "user_authorized" },
    );
    assert.equal(updated.status, "policy_approved");
  }

  // --- recovery case ---
  {
    const client = new ScriptedClient([
      { name: "conflicting update", match: /insert into recovery_cases/i, rows: [] },
      {
        name: "matching update",
        match: /insert into recovery_cases/i,
        assertParams(params, text) {
          assert.match(squash(text), /where recovery_cases\.status = \$15/i);
          assert.equal(params[14], "triage");
        },
        rows: [recoveryCaseRow({ status: "waiting_on_provider" })],
      },
    ]);
    const repo = createSqlCashierRepository(client);

    await assert.rejects(
      () =>
        repo.saveRecoveryCase(
          { ...fixtures.recoveryCase, status: "waiting_on_provider" },
          { expectedStatus: "triage" },
        ),
      (err) => err instanceof CashierConflictError,
    );

    const updated = await repo.saveRecoveryCase(
      { ...fixtures.recoveryCase, status: "waiting_on_provider" },
      { expectedStatus: "triage" },
    );
    assert.equal(updated.status, "waiting_on_provider");
  }
});

test("decimalForAssetOnChain resolves an explicit table and throws for an unknown pair", () => {
  assert.equal(decimalForAssetOnChain("USDT", "tron"), 6);
  assert.equal(decimalForAssetOnChain("USDT", "bsc"), 18);
  assert.equal(decimalForAssetOnChain("USDC", "polygon"), 6);
  assert.equal(decimalForAssetOnChain("USDC", "base"), 6);
  assert.equal(decimalForAssetOnChain("USDC", "arbitrum"), 6);
  assert.equal(decimalForAssetOnChain("hUSD", "settlement"), 6);

  assert.throws(
    () => decimalForAssetOnChain("USDT", "polygon"),
    /unknown_asset_chain_decimals:USDT:polygon/,
  );
});

test("saveDepositIntent reconstructs settledAmount decimals for hUSD using the settlement chain, not the wallet's EVM chain", async () => {
  const client = new ScriptedClient([
    {
      name: "save deposit with hUSD settlement",
      match: /insert into deposit_intents/i,
      rows: [
        depositRow({
          settlement_asset: "hUSD",
          settlement_chain: "polygon",
          settled_units: "24900000",
        }),
      ],
    },
  ]);
  const repo = createSqlCashierRepository(client);

  const saved = await repo.saveDepositIntent({
    ...fixtures.deposit,
    settlementAsset: "hUSD",
    settledAmount: { asset: "hUSD", chain: "settlement", decimals: 6, units: "24900000" },
  });

  assert.equal(saved.settledAmount.chain, "settlement");
  assert.equal(saved.settledAmount.decimals, 6);
  assert.equal(saved.settledAmount.units, "24900000");
});

test("insertBridgeEvent treats a UNIQUE(provider, raw_body_sha256) conflict as a duplicate, like the idempotency_key conflict", async () => {
  const bridgeEvent = {
    id: "evt_test_dup_001",
    provider: "relay",
    providerRequestId: "relay_req_test_001",
    depositIntentId: fixtures.deposit.id,
    status: "source_confirmed",
    idempotencyKey: "deposit:relay:tron:tron_tx_test_002:0",
    sourceChain: "tron",
    sourceTxHash: "tron_tx_test_002",
    amount: { asset: "USDT", chain: "tron", decimals: 6, units: "25000000" },
    callbackVerification: {
      envelope: {
        provider: "relay",
        receivedAt: "2026-05-25T00:05:00.000Z",
        signatureHeader: "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        rawBodySha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      },
      signatureVersion: "hmac-sha256-v1",
      verifiedAt: "2026-05-25T00:05:01.000Z",
      verifierKeyId: "relay-key-1",
    },
    observedAt: "2026-05-25T00:05:00.000Z",
  };
  const pgUniqueViolation = () => {
    const err = new Error(
      'duplicate key value violates unique constraint "bridge_events_provider_raw_body_sha256_key"',
    );
    err.code = "23505";
    err.constraint = "bridge_events_provider_raw_body_sha256_key";
    throw err;
  };
  const client = new ScriptedClient([
    {
      // A different idempotency_key but the same (provider, raw_body_sha256)
      // still raises a unique_violation, which is NOT suppressed by
      // ON CONFLICT (idempotency_key) DO NOTHING.
      name: "insert bridge event conflicts on raw_body_sha256",
      match: /insert into bridge_events/i,
      rows: pgUniqueViolation,
    },
    {
      name: "lookup by idempotency_key finds nothing",
      match: /from bridge_events\s+where idempotency_key = \$1/i,
      rows: [],
    },
    {
      name: "lookup by (provider, raw_body_sha256) finds the existing row",
      match: /from bridge_events\s+where provider = \$1\s+and raw_body_sha256 = \$2/i,
      assertParams(params) {
        assert.deepEqual(params, ["relay", bridgeEvent.callbackVerification.envelope.rawBodySha256]);
      },
      rows: [bridgeEventRow({ id: "evt_test_011", idempotency_key: "deposit:relay:tron:tron_tx_test_001:0" })],
    },
  ]);
  const repo = createSqlCashierRepository(client);

  const result = await repo.insertBridgeEvent(bridgeEvent);
  assert.equal(result.inserted, false);
  assert.equal(result.event.id, "evt_test_011");
});

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}

class ScriptedClient {
  constructor(steps = []) {
    this.steps = [...steps];
    this.calls = [];
    this.released = 0;
  }

  // Mimics a node-postgres Pool: connect() checks out a client that shares
  // this same scripted step queue and call log.
  async connect() {
    return this;
  }

  release() {
    this.released += 1;
  }

  async query(text, params = []) {
    this.calls.push({ text, params });
    const squashed = squash(text);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(squashed)) {
      return { rows: [] };
    }
    const step = this.steps.shift();
    if (!step) {
      return { rows: [] };
    }
    assert.match(squashed, step.match, step.name);
    step.assertParams?.(params, text);
    return { rows: typeof step.rows === "function" ? step.rows(params, text) : step.rows };
  }
}

function walletRow(overrides = {}) {
  return {
    user_id: fixtures.wallet.userId,
    embedded_wallet_address: fixtures.wallet.embeddedWalletAddress,
    smart_wallet_address: fixtures.wallet.smartWalletAddress,
    settlement_chain: fixtures.wallet.settlementChain,
    smart_wallet_provider: fixtures.wallet.smartWalletProvider,
    created_at: fixtures.wallet.createdAt,
    ...overrides,
  };
}

function runtimeFlagRow(overrides = {}) {
  const base = fixtures.runtimeFlags[0];
  return {
    flag_key: base.flagKey,
    enabled: base.enabled,
    reason: base.reason,
    updated_by: base.updatedBy,
    updated_at: base.updatedAt,
    ...overrides,
  };
}

function depositRow(overrides = {}) {
  return {
    id: fixtures.deposit.id,
    user_id: fixtures.deposit.userId,
    rail: fixtures.deposit.rail,
    status: fixtures.deposit.status,
    source_chain: fixtures.deposit.sourceChain,
    source_asset: fixtures.deposit.sourceAsset,
    source_decimals: fixtures.deposit.sourceDecimals,
    settlement_chain: fixtures.deposit.settlementChain,
    settlement_asset: fixtures.deposit.settlementAsset,
    destination_wallet_address: fixtures.deposit.destinationWalletAddress,
    provider: fixtures.deposit.provider,
    provider_request_id: fixtures.deposit.providerRequestId,
    deposit_address: fixtures.deposit.depositAddress,
    expected_source_units: null,
    actual_source_units: null,
    settled_units: null,
    source_tx_hash: null,
    destination_tx_hash: null,
    recovery_reason: null,
    idempotency_key: fixtures.deposit.idempotencyKey,
    created_at: fixtures.deposit.createdAt,
    updated_at: fixtures.deposit.updatedAt,
    ...overrides,
  };
}

function withdrawalRow(overrides = {}) {
  return {
    id: fixtures.withdrawal.id,
    user_id: fixtures.withdrawal.userId,
    status: fixtures.withdrawal.status,
    settlement_chain: fixtures.withdrawal.settlementChain,
    source_wallet_address: fixtures.withdrawal.sourceWalletAddress,
    destination_address: fixtures.withdrawal.destinationAddress,
    asset: fixtures.withdrawal.amount.asset,
    decimals: fixtures.withdrawal.amount.decimals,
    amount_units: fixtures.withdrawal.amount.units,
    idempotency_key: fixtures.withdrawal.idempotencyKey,
    user_authorization_hash: fixtures.withdrawal.userAuthorizationHash,
    user_authorization_nonce: fixtures.withdrawal.userAuthorizationNonce,
    user_authorization_expires_at: fixtures.withdrawal.userAuthorizationExpiresAt,
    policy_decision_id: null,
    relayer_submission_id: null,
    recovery_reason: null,
    created_at: fixtures.withdrawal.createdAt,
    updated_at: fixtures.withdrawal.updatedAt,
    ...overrides,
  };
}

function bridgeEventRow(overrides = {}) {
  return {
    id: "evt_test_011",
    provider: "relay",
    provider_request_id: "relay_req_test_001",
    deposit_intent_id: fixtures.deposit.id,
    status: "source_confirmed",
    idempotency_key: "deposit:relay:tron:tron_tx_test_001:0",
    source_chain: "tron",
    source_tx_hash: "tron_tx_test_001",
    source_address: "TMockMariaSourceAddress111111111111111",
    deposit_address: fixtures.deposit.depositAddress,
    destination_chain: "polygon",
    destination_tx_hash: null,
    destination_wallet_address: fixtures.deposit.destinationWalletAddress,
    amount_units: "25000000",
    asset: "USDT",
    decimals: 6,
    recovery_reason: null,
    raw_body_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    signature_version: "hmac-sha256-v1",
    verifier_key_id: "relay-key-1",
    observed_at: "2026-05-25T00:05:00.000Z",
    created_at: "2026-05-25T00:05:02.000Z",
    ...overrides,
  };
}

function recoveryCaseRow(overrides = {}) {
  return {
    id: fixtures.recoveryCase.id,
    subject_type: fixtures.recoveryCase.subjectType,
    subject_id: fixtures.recoveryCase.subjectId,
    status: fixtures.recoveryCase.status,
    recovery_reason: fixtures.recoveryCase.recoveryReason,
    user_id: fixtures.recoveryCase.userId,
    provider: fixtures.recoveryCase.provider,
    provider_request_id: fixtures.recoveryCase.providerRequestId,
    source_tx_hash: fixtures.recoveryCase.sourceTxHash,
    destination_tx_hash: fixtures.recoveryCase.destinationTxHash,
    assigned_operator_id: null,
    opened_at: fixtures.recoveryCase.openedAt,
    updated_at: fixtures.recoveryCase.updatedAt,
    closed_at: null,
    ...overrides,
  };
}

function recoveryApprovalRow(overrides = {}) {
  return {
    id: fixtures.recoveryApproval.id,
    recovery_case_id: fixtures.recoveryApproval.recoveryCaseId,
    operator_id: fixtures.recoveryApproval.operatorId,
    approval_type: fixtures.recoveryApproval.approvalType,
    decision: fixtures.recoveryApproval.decision,
    evidence_sha256: fixtures.recoveryApproval.evidenceSha256,
    note: fixtures.recoveryApproval.note,
    created_at: fixtures.recoveryApproval.createdAt,
    ...overrides,
  };
}

function auditEventRow(overrides = {}) {
  return {
    id: fixtures.auditEvent.id,
    subject_type: fixtures.auditEvent.subjectType,
    subject_id: fixtures.auditEvent.subjectId,
    event_type: fixtures.auditEvent.eventType,
    event_payload: fixtures.auditEvent.eventPayload,
    payload_sha256: fixtures.auditEvent.payloadSha256,
    actor_type: fixtures.auditEvent.actorType,
    actor_id: fixtures.auditEvent.actorId,
    created_at: fixtures.auditEvent.createdAt,
    ...overrides,
  };
}

function reconciliationReportRow(overrides = {}) {
  return {
    id: fixtures.reconciliationReport.id,
    business_date: fixtures.reconciliationReport.businessDate,
    generated_at: fixtures.reconciliationReport.generatedAt,
    generated_by: fixtures.reconciliationReport.generatedBy,
    ...overrides,
  };
}

function reconciliationItemRow(item, reportId = fixtures.reconciliationReport.id) {
  return {
    id: item.id,
    report_id: reportId,
    subject_type: item.subjectType,
    subject_id: item.subjectId,
    expected_units: item.expectedUnits,
    observed_units: item.observedUnits,
    asset: item.asset,
    chain: item.chain,
    status: item.status,
    provider_request_id: item.providerRequestId,
    source_tx_hash: item.sourceTxHash,
    destination_tx_hash: item.destinationTxHash,
    notes: item.notes,
  };
}

function assertNoDynamicValuesInSql(calls, values) {
  for (const call of calls) {
    for (const value of values) {
      assert.equal(call.text.includes(value), false, `SQL text includes dynamic value ${value}`);
    }
    assert.ok(Array.isArray(call.params), "query params should be an array");
  }
}

function squash(value) {
  return value.replace(/\s+/g, " ").trim();
}
