import { createHash } from "node:crypto";
import { buildDailyReconciliationReport } from "./reconciliation.mjs";
import { CashierConflictError, CashierValidationError } from "./errors.mjs";
import {
  validateCreateDepositIntentRequest,
  validateCreateWithdrawalIntentRequest,
} from "./validation.mjs";

const RUNTIME_FLAG_KEYS = new Set([
  "tron_deposits_enabled",
  "evm_deposits_enabled",
  "withdrawals_enabled",
  "relayer_enabled",
  "provider_callbacks_enabled",
]);

export function createCashierHandlers({ repo, providerAdapter, now = () => new Date().toISOString() }) {
  const handlers = {
    async getWallet(ctx) {
      const auth = requireUser(ctx);
      if (!auth.ok) return auth;
      const wallet = await repo.getWalletByUserId(ctx.userId);
      if (!wallet) return json(503, { error: "wallet_unavailable" });
      return json(200, wallet);
    },

    async createDepositIntent(ctx, request) {
      const auth = requireUser(ctx);
      if (!auth.ok) return auth;
      const idempotency = requireIdempotencyKey(ctx);
      if (!idempotency.ok) return idempotency;
      validateCreateDepositIntentRequest(request);

      const flagKey =
        request.rail === "tron-usdt-deposit-address"
          ? "tron_deposits_enabled"
          : "evm_deposits_enabled";
      const enabled = await isFlagEnabled(repo, flagKey);
      if (!enabled) return json(423, { error: "rail_disabled", flagKey });

      const existing = await repo.findDepositIntentByIdempotencyKey(ctx.userId, ctx.idempotencyKey);
      if (existing) return json(200, existing);

      const wallet = await repo.getWalletByUserId(ctx.userId);
      if (!wallet) return json(503, { error: "wallet_unavailable" });

      const route = await providerAdapter.createDepositRoute({
        userId: ctx.userId,
        wallet,
        rail: request.rail,
        settlementChain: request.settlementChain,
        idempotencyKey: ctx.idempotencyKey,
        now: now(),
      });
      const intent = {
        id: route.depositIntentId,
        userId: ctx.userId,
        rail: request.rail,
        status: route.depositAddress ? "address_issued" : "created",
        sourceChain: route.sourceChain,
        sourceAsset: route.sourceAsset,
        sourceDecimals: route.sourceDecimals,
        settlementChain: request.settlementChain,
        settlementAsset: route.settlementAsset,
        destinationWalletAddress: wallet.smartWalletAddress,
        provider: route.provider,
        providerRequestId: route.providerRequestId,
        ...(route.depositAddress ? { depositAddress: route.depositAddress } : {}),
        idempotencyKey: ctx.idempotencyKey,
        createdAt: route.createdAt,
        updatedAt: route.createdAt,
      };
      const saved = await repo.saveDepositIntent(intent);
      await recordAudit(repo, {
        subjectType: "deposit",
        subjectId: saved.id,
        eventType: "cashier.deposit_intent.created",
        eventPayload: {
          userId: ctx.userId,
          rail: request.rail,
          settlementChain: request.settlementChain,
          provider: saved.provider,
          providerRequestId: saved.providerRequestId,
        },
        actorType: "user",
        actorId: ctx.userId,
        createdAt: saved.createdAt ?? now(),
      });
      return json(201, saved);
    },

    async getDepositIntent(ctx, id) {
      const auth = requireUser(ctx);
      if (!auth.ok) return auth;
      const intent = await repo.getDepositIntent(id);
      if (!intent || intent.userId !== ctx.userId) return json(404, { error: "deposit_intent_not_found" });
      return json(200, intent);
    },

    async createWithdrawalIntent(ctx, request) {
      const auth = requireUser(ctx);
      if (!auth.ok) return auth;
      const idempotency = requireIdempotencyKey(ctx);
      if (!idempotency.ok) return idempotency;
      validateCreateWithdrawalIntentRequest(request);
      if (!(await isFlagEnabled(repo, "withdrawals_enabled"))) {
        return json(423, { error: "rail_disabled", flagKey: "withdrawals_enabled" });
      }

      const existing = await repo.findWithdrawalIntentByIdempotencyKey(ctx.userId, ctx.idempotencyKey);
      if (existing) return json(200, existing);
      const wallet = await repo.getWalletByUserId(ctx.userId);
      if (!wallet) return json(503, { error: "wallet_unavailable" });

      const createdAt = now();
      const intent = {
        id: `wd_local_${stableSuffix(ctx.idempotencyKey)}`,
        userId: ctx.userId,
        status: "user_authorized",
        settlementChain: request.settlementChain,
        sourceWalletAddress: wallet.smartWalletAddress,
        destinationAddress: request.destinationAddress,
        amount: {
          asset: request.asset,
          chain: request.asset === "hUSD" ? "settlement" : request.settlementChain,
          decimals: request.asset === "USDT" && request.settlementChain === "bsc" ? 18 : 6,
          units: request.amountUnits,
        },
        idempotencyKey: ctx.idempotencyKey,
        userAuthorizationHash: request.userAuthorizationHash,
        userAuthorizationNonce: request.userAuthorizationNonce,
        userAuthorizationExpiresAt: request.userAuthorizationExpiresAt,
        createdAt,
        updatedAt: createdAt,
      };
      const saved = await repo.saveWithdrawalIntent(intent);
      await recordAudit(repo, {
        subjectType: "withdrawal",
        subjectId: saved.id,
        eventType: "cashier.withdrawal_intent.created",
        eventPayload: {
          userId: ctx.userId,
          settlementChain: request.settlementChain,
          destinationAddress: request.destinationAddress,
          asset: request.asset,
          amountUnits: request.amountUnits,
          userAuthorizationHash: request.userAuthorizationHash,
        },
        actorType: "user",
        actorId: ctx.userId,
        createdAt: saved.createdAt ?? createdAt,
      });
      return json(201, saved);
    },

    async ingestProviderCallback(ctx, provider, event) {
      if (!(await isFlagEnabled(repo, "provider_callbacks_enabled"))) {
        return json(423, { error: "provider_callbacks_disabled" });
      }
      if (!ctx.providerSignatureVerified) {
        return json(401, { error: "invalid_provider_signature" });
      }
      const inserted = await repo.insertBridgeEvent({ ...event, provider });
      if (inserted.inserted) {
        await recordAudit(repo, {
          subjectType: "bridge_event",
          subjectId: inserted.event.id,
          eventType: "cashier.bridge_event.inserted",
          eventPayload: {
            provider,
            providerRequestId: inserted.event.providerRequestId,
            depositIntentId: inserted.event.depositIntentId,
            status: inserted.event.status,
            idempotencyKey: inserted.event.idempotencyKey,
            rawBodySha256: inserted.event.rawBodySha256,
          },
          actorType: "provider",
          actorId: provider,
          createdAt: inserted.event.createdAt ?? now(),
        });
      }
      return json(inserted.inserted ? 202 : 200, {
        accepted: true,
        duplicate: !inserted.inserted,
        bridgeEventId: inserted.event.id,
      });
    },

    async listRecoveryCases(ctx, filter = {}) {
      const auth = requireOperator(ctx);
      if (!auth.ok) return auth;
      return json(200, { recoveryCases: await repo.listRecoveryCases(filter) });
    },

    async listRuntimeFlags(ctx) {
      const auth = requireOperator(ctx);
      if (!auth.ok) return auth;
      return json(200, { runtimeFlags: await repo.listRuntimeFlags() });
    },

    async setRuntimeFlag(ctx, flagKey, request) {
      const auth = requireOperator(ctx);
      if (!auth.ok) return auth;
      if (!RUNTIME_FLAG_KEYS.has(flagKey)) {
        return json(400, { error: "unsupported_runtime_flag", flagKey });
      }
      if (typeof request?.enabled !== "boolean") {
        return json(400, { error: "runtime_flag_enabled_required" });
      }
      if (!request.reason) {
        return json(400, { error: "runtime_flag_reason_required" });
      }

      const saved = await repo.setRuntimeFlag({
        flagKey,
        enabled: request.enabled,
        reason: request.reason,
        updatedBy: ctx.operatorId,
        updatedAt: now(),
      });
      await recordAudit(repo, {
        subjectType: "runtime_flag",
        subjectId: flagKey,
        eventType: "cashier.runtime_flag.changed",
        eventPayload: {
          enabled: saved.enabled,
          reason: saved.reason,
          updatedBy: saved.updatedBy,
        },
        actorType: "operator",
        actorId: ctx.operatorId,
        createdAt: saved.updatedAt,
      });
      return json(200, saved);
    },

    async getRecoveryCase(ctx, id) {
      const auth = requireOperator(ctx);
      if (!auth.ok) return auth;
      const recoveryCase = await repo.getRecoveryCase(id);
      if (!recoveryCase) return json(404, { error: "recovery_case_not_found" });
      return json(200, recoveryCase);
    },

    async recordRecoveryApproval(ctx, recoveryCaseId, request) {
      const auth = requireOperator(ctx);
      if (!auth.ok) return auth;
      const recoveryCase = await repo.getRecoveryCase(recoveryCaseId);
      if (!recoveryCase) return json(404, { error: "recovery_case_not_found" });
      const createdAt = now();
      const approval = {
        id: `approval_local_${stableSuffix(`${recoveryCaseId}:${ctx.operatorId}:${request.approvalType}`)}`,
        recoveryCaseId,
        operatorId: ctx.operatorId,
        approvalType: request.approvalType,
        decision: request.decision,
        evidenceSha256: request.evidenceSha256,
        note: request.note,
        createdAt,
      };
      const saved = await repo.recordRecoveryApproval(approval);
      await recordAudit(repo, {
        subjectType: "recovery_case",
        subjectId: recoveryCaseId,
        eventType: "cashier.recovery_case.approval_recorded",
        eventPayload: {
          approvalId: saved.id,
          approvalType: saved.approvalType,
          decision: saved.decision,
          evidenceSha256: saved.evidenceSha256,
        },
        actorType: "operator",
        actorId: ctx.operatorId,
        createdAt: saved.createdAt ?? createdAt,
      });
      return json(201, saved);
    },

    async getRecoveryApprovalStatus(ctx, recoveryCaseId, approvalType) {
      const auth = requireOperator(ctx);
      if (!auth.ok) return auth;
      const recoveryCase = await repo.getRecoveryCase(recoveryCaseId);
      if (!recoveryCase) return json(404, { error: "recovery_case_not_found" });
      const approvals = await repo.listRecoveryApprovals(recoveryCaseId);
      return json(200, {
        recoveryCaseId,
        approvalType,
        approvalCount: countApprovingOperators(approvals, approvalType),
        twoPersonApproved: hasTwoPersonApproval(approvals, approvalType),
      });
    },

    async getReconciliationReport(ctx, businessDate) {
      const auth = requireOperator(ctx);
      if (!auth.ok) return auth;
      const report = await repo.getReconciliationReportByBusinessDate(businessDate);
      if (!report) return json(404, { error: "reconciliation_report_not_found" });
      return json(200, report);
    },

    async generateReconciliationReport(ctx, businessDate) {
      const auth = requireOperator(ctx);
      if (!auth.ok) return auth;
      const generatedAt = now();
      const report = buildDailyReconciliationReport({
        businessDate,
        generatedAt,
        generatedBy: ctx.operatorId,
        depositIntents: await repo.listDepositIntentsForReconciliation(businessDate),
        bridgeEvents: await repo.listBridgeEvents(),
      });
      const saved = await repo.saveReconciliationReport(report);
      await recordAudit(repo, {
        subjectType: "reconciliation_report",
        subjectId: saved.id,
        eventType: "cashier.reconciliation.completed",
        eventPayload: {
          businessDate,
          itemCount: saved.items.length,
          mismatchCount: saved.items.filter((item) => item.status !== "matched").length,
        },
        actorType: "operator",
        actorId: ctx.operatorId,
        createdAt: generatedAt,
      });
      return json(201, saved);
    },
  };

  return mapHandlerErrors(handlers);
}

/**
 * Wraps every handler so a thrown CashierValidationError / CashierConflictError
 * (raised by request validation or a repository backend — including translated
 * Postgres constraint violations) becomes a clean 400/409 response instead of
 * propagating as an unhandled 500.
 */
function mapHandlerErrors(handlers) {
  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      async (...args) => {
        try {
          return await handler(...args);
        } catch (err) {
          if (err instanceof CashierValidationError) {
            return json(400, { error: err.code, field: err.field, message: err.message });
          }
          if (err instanceof CashierConflictError) {
            return json(409, { error: err.code, message: err.message });
          }
          throw err;
        }
      },
    ]),
  );
}

export async function isFlagEnabled(repo, flagKey) {
  const flag = await repo.getRuntimeFlag(flagKey);
  return Boolean(flag?.enabled);
}

function requireUser(ctx) {
  if (!ctx?.userId) return json(401, { error: "user_auth_required" });
  return { ok: true };
}

function requireOperator(ctx) {
  if (!ctx?.operatorId || !ctx.roles?.includes("cashier_operator")) {
    return json(403, { error: "operator_auth_required" });
  }
  return { ok: true };
}

function requireIdempotencyKey(ctx) {
  if (!ctx?.idempotencyKey) return json(400, { error: "idempotency_key_required" });
  return { ok: true };
}

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, body };
}

async function recordAudit(repo, event) {
  const eventPayload = event.eventPayload ?? {};
  const payloadSha256 = sha256(canonicalJson(eventPayload));
  return repo.recordAuditEvent({
    id:
      event.id ??
      `audit_local_${stableSuffix(
        `${event.subjectType}:${event.subjectId}:${event.eventType}:${event.actorType}:${event.actorId ?? ""}:${payloadSha256}`,
      )}`,
    ...event,
    eventPayload,
    payloadSha256,
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function countApprovingOperators(approvals, approvalType) {
  return approvingOperators(approvals, approvalType).size;
}

function hasTwoPersonApproval(approvals, approvalType) {
  return countApprovingOperators(approvals, approvalType) >= 2;
}

function approvingOperators(approvals, approvalType) {
  const operators = new Set();
  for (const approval of approvals) {
    if (approval.approvalType === approvalType && approval.decision === "approve") {
      operators.add(approval.operatorId);
    }
  }
  return operators;
}

function stableSuffix(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
