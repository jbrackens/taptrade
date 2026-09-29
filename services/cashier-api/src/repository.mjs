/**
 * Repository contract for the non-custodial cashier schema.
 *
 * This module intentionally starts with an in-memory implementation so local
 * handlers, dashboards, and mock E2E replay can be tested without credentials or
 * a database. A SQL implementation should preserve these method boundaries and
 * table ownership.
 */

import { CashierConflictError, CashierValidationError } from "./errors.mjs";
import { RECOVERY_CASE_FILTER_KEY_SET } from "./recovery-case-filters.mjs";

export function createInMemoryCashierRepository(seed = {}) {
  const wallets = new Map((seed.wallets ?? []).map((wallet) => [wallet.userId, clone(wallet)]));
  const depositIntents = new Map(
    (seed.depositIntents ?? []).map((intent) => [intent.id, clone(intent)]),
  );
  const withdrawalIntents = new Map(
    (seed.withdrawalIntents ?? []).map((intent) => [intent.id, clone(intent)]),
  );
  const runtimeFlags = new Map(
    (seed.runtimeFlags ?? []).map((flag) => [flag.flagKey, clone(flag)]),
  );
  const recoveryCases = new Map(
    (seed.recoveryCases ?? []).map((recoveryCase) => [recoveryCase.id, clone(recoveryCase)]),
  );
  const recoveryApprovals = new Map(
    (seed.recoveryApprovals ?? []).map((approval) => [approval.id, clone(approval)]),
  );
  const auditEvents = new Map(
    (seed.auditEvents ?? []).map((event) => [event.id, clone(event)]),
  );
  const bridgeEvents = new Map(
    (seed.bridgeEvents ?? []).map((event) => [event.idempotencyKey, clone(event)]),
  );
  const bridgeEventsByProviderRawBody = new Map(
    (seed.bridgeEvents ?? [])
      .map((event) => [providerRawBodyKey(event), event])
      .filter(([key]) => key !== undefined)
      .map(([key, event]) => [key, clone(event)]),
  );
  const reconciliationReports = new Map(
    (seed.reconciliationReports ?? []).map((report) => [report.businessDate, clone(report)]),
  );

  return {
    async getWalletByUserId(userId) {
      return clone(wallets.get(userId));
    },

    async upsertWallet(wallet) {
      wallets.set(wallet.userId, clone(wallet));
      return clone(wallet);
    },

    async getRuntimeFlag(flagKey) {
      return clone(runtimeFlags.get(flagKey));
    },

    async listRuntimeFlags() {
      return [...runtimeFlags.values()].map(clone);
    },

    async setRuntimeFlag(flag) {
      runtimeFlags.set(flag.flagKey, clone(flag));
      return clone(flag);
    },

    async getDepositIntent(id) {
      return clone(depositIntents.get(id));
    },

    async findDepositIntentByIdempotencyKey(userId, idempotencyKey) {
      return clone(
        [...depositIntents.values()].find(
          (intent) => intent.userId === userId && intent.idempotencyKey === idempotencyKey,
        ),
      );
    },

    async saveDepositIntent(intent, options = {}) {
      assertExpectedStatus(depositIntents, intent.id, options.expectedStatus, "deposit_intent");
      depositIntents.set(intent.id, clone(intent));
      return clone(intent);
    },

    async listDepositIntentsByUser(userId) {
      return [...depositIntents.values()]
        .filter((intent) => intent.userId === userId)
        .sort(descCreatedAt)
        .map(clone);
    },

    async listDepositIntentsForReconciliation(businessDate) {
      return [...depositIntents.values()]
        .filter((intent) => toBusinessDate(intent.createdAt) === businessDate)
        .sort(descCreatedAt)
        .map(clone);
    },

    async getWithdrawalIntent(id) {
      return clone(withdrawalIntents.get(id));
    },

    async findWithdrawalIntentByIdempotencyKey(userId, idempotencyKey) {
      return clone(
        [...withdrawalIntents.values()].find(
          (intent) => intent.userId === userId && intent.idempotencyKey === idempotencyKey,
        ),
      );
    },

    async saveWithdrawalIntent(intent, options = {}) {
      assertExpectedStatus(withdrawalIntents, intent.id, options.expectedStatus, "withdrawal_intent");
      withdrawalIntents.set(intent.id, clone(intent));
      return clone(intent);
    },

    async listWithdrawalIntentsByUser(userId) {
      return [...withdrawalIntents.values()]
        .filter((intent) => intent.userId === userId)
        .sort(descCreatedAt)
        .map(clone);
    },

    async insertBridgeEvent(event) {
      if (bridgeEvents.has(event.idempotencyKey)) {
        return { inserted: false, event: clone(bridgeEvents.get(event.idempotencyKey)) };
      }
      const rawBodyKey = providerRawBodyKey(event);
      if (rawBodyKey && bridgeEventsByProviderRawBody.has(rawBodyKey)) {
        return { inserted: false, event: clone(bridgeEventsByProviderRawBody.get(rawBodyKey)) };
      }
      bridgeEvents.set(event.idempotencyKey, clone(event));
      if (rawBodyKey) {
        bridgeEventsByProviderRawBody.set(rawBodyKey, clone(event));
      }
      return { inserted: true, event: clone(event) };
    },

    async listBridgeEvents() {
      return [...bridgeEvents.values()].map(clone);
    },

    async listRecoveryCases(filter = {}) {
      const entries = Object.entries(filter).filter(([, value]) => value !== undefined);
      const unknownKey = entries.find(([key]) => !RECOVERY_CASE_FILTER_KEY_SET.has(key));
      if (unknownKey) {
        throw new CashierValidationError(`unsupported recovery case filter key: ${unknownKey[0]}`, {
          field: unknownKey[0],
        });
      }
      return [...recoveryCases.values()]
        .filter((recoveryCase) => entries.every(([key, value]) => recoveryCase[key] === value))
        .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
        .map(clone);
    },

    async getRecoveryCase(id) {
      return clone(recoveryCases.get(id));
    },

    async saveRecoveryCase(recoveryCase, options = {}) {
      assertExpectedStatus(recoveryCases, recoveryCase.id, options.expectedStatus, "recovery_case");
      recoveryCases.set(recoveryCase.id, clone(recoveryCase));
      return clone(recoveryCase);
    },

    async recordRecoveryApproval(approval) {
      recoveryApprovals.set(approval.id, clone(approval));
      return clone(approval);
    },

    async listRecoveryApprovals(recoveryCaseId) {
      return [...recoveryApprovals.values()]
        .filter((approval) => approval.recoveryCaseId === recoveryCaseId)
        .map(clone);
    },

    async recordAuditEvent(event) {
      auditEvents.set(event.id, clone(event));
      return clone(event);
    },

    async listAuditEventsBySubject(subjectType, subjectId) {
      return [...auditEvents.values()]
        .filter((event) => event.subjectType === subjectType && event.subjectId === subjectId)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .map(clone);
    },

    async getReconciliationReportByBusinessDate(businessDate) {
      return clone(reconciliationReports.get(businessDate));
    },

    async saveReconciliationReport(report) {
      reconciliationReports.set(report.businessDate, clone(report));
      return clone(report);
    },
  };
}

function toBusinessDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function providerRawBodyKey(event) {
  const rawBodySha256 = event?.rawBodySha256 ?? event?.callbackVerification?.envelope?.rawBodySha256;
  if (!event?.provider || !rawBodySha256) {
    return undefined;
  }
  return `${event.provider}:${rawBodySha256}`;
}

/**
 * Optimistic-concurrency guard mirroring the SQL repository's
 * `... DO UPDATE ... WHERE <table>.status = $expectedStatus` pattern: when the
 * caller passes an expected current status and the stored row doesn't match
 * it (or doesn't exist), surface a typed conflict instead of silently
 * overwriting a concurrent change.
 */
function assertExpectedStatus(map, id, expectedStatus, kind) {
  if (expectedStatus === undefined) {
    return;
  }
  const existing = map.get(id);
  if (!existing || existing.status !== expectedStatus) {
    throw new CashierConflictError(
      `${kind} ${id} conflict: expected status ${expectedStatus}, found ${existing ? existing.status : "no existing row"}`,
    );
  }
}

function descCreatedAt(a, b) {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}
