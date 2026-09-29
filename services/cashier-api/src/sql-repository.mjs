import { createHash } from "node:crypto";
import { CashierConflictError, CashierValidationError, translatePostgresError } from "./errors.mjs";

const WALLET_COLUMNS = `
  user_id,
  embedded_wallet_address,
  smart_wallet_address,
  settlement_chain,
  smart_wallet_provider,
  created_at
`;

const RUNTIME_FLAG_COLUMNS = `
  flag_key,
  enabled,
  reason,
  updated_by,
  updated_at
`;

const DEPOSIT_INTENT_COLUMNS = `
  id,
  user_id,
  rail,
  status,
  source_chain,
  source_asset,
  source_decimals,
  settlement_chain,
  settlement_asset,
  destination_wallet_address,
  provider,
  provider_request_id,
  deposit_address,
  expected_source_units,
  actual_source_units,
  settled_units,
  source_tx_hash,
  destination_tx_hash,
  recovery_reason,
  idempotency_key,
  created_at,
  updated_at
`;

const WITHDRAWAL_INTENT_COLUMNS = `
  id,
  user_id,
  status,
  settlement_chain,
  source_wallet_address,
  destination_address,
  asset,
  decimals,
  amount_units,
  idempotency_key,
  user_authorization_hash,
  user_authorization_nonce,
  user_authorization_expires_at,
  policy_decision_id,
  relayer_submission_id,
  recovery_reason,
  created_at,
  updated_at
`;

const BRIDGE_EVENT_COLUMNS = `
  id,
  provider,
  provider_request_id,
  deposit_intent_id,
  status,
  idempotency_key,
  source_chain,
  source_tx_hash,
  source_address,
  deposit_address,
  destination_chain,
  destination_tx_hash,
  destination_wallet_address,
  amount_units,
  asset,
  decimals,
  recovery_reason,
  raw_body_sha256,
  signature_version,
  verifier_key_id,
  observed_at,
  created_at
`;

const RECOVERY_CASE_COLUMNS = `
  id,
  subject_type,
  subject_id,
  status,
  recovery_reason,
  user_id,
  provider,
  provider_request_id,
  source_tx_hash,
  destination_tx_hash,
  assigned_operator_id,
  opened_at,
  updated_at,
  closed_at
`;

const RECOVERY_APPROVAL_COLUMNS = `
  id,
  recovery_case_id,
  operator_id,
  approval_type,
  decision,
  evidence_sha256,
  note,
  created_at
`;

const AUDIT_EVENT_COLUMNS = `
  id,
  subject_type,
  subject_id,
  event_type,
  event_payload,
  payload_sha256,
  actor_type,
  actor_id,
  created_at
`;

const RECONCILIATION_REPORT_COLUMNS = `
  id,
  business_date,
  generated_at,
  generated_by
`;

const RECONCILIATION_ITEM_COLUMNS = `
  id,
  report_id,
  subject_type,
  subject_id,
  expected_units,
  observed_units,
  asset,
  chain,
  status,
  provider_request_id,
  source_tx_hash,
  destination_tx_hash,
  notes
`;

const RECOVERY_CASE_FILTER_COLUMNS = new Map([
  ["id", "id"],
  ["subjectType", "subject_type"],
  ["subjectId", "subject_id"],
  ["status", "status"],
  ["recoveryReason", "recovery_reason"],
  ["userId", "user_id"],
  ["provider", "provider"],
  ["providerRequestId", "provider_request_id"],
  ["sourceTxHash", "source_tx_hash"],
  ["destinationTxHash", "destination_tx_hash"],
  ["assignedOperatorId", "assigned_operator_id"],
]);

/**
 * SQL repository for the cashier schema in migrations/001_cashier_core.sql.
 *
 * Pass a node-postgres compatible client or pool: `{ query(text, params) }`.
 * This module owns only repository mapping; connection lifecycle and production
 * wiring intentionally stay with the caller.
 */
export function createSqlCashierRepository(clientOrOptions) {
  const client = resolveQueryClient(clientOrOptions);

  return {
    async getWalletByUserId(userId) {
      const row = await queryOne(
        client,
        `SELECT ${WALLET_COLUMNS}
         FROM cashier_wallets
         WHERE user_id = $1`,
        [userId],
      );
      return row ? rowToWallet(row) : undefined;
    },

    async upsertWallet(wallet) {
      const row = walletToRow(wallet);
      const saved = await queryOne(
        client,
        `INSERT INTO cashier_wallets (
           id,
           user_id,
           embedded_wallet_address,
           smart_wallet_address,
           settlement_chain,
           smart_wallet_provider,
           created_at,
           updated_at
         )
         VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           COALESCE($7, NOW()),
           COALESCE($8, COALESCE($7, NOW()))
         )
         ON CONFLICT (user_id) DO UPDATE
         SET embedded_wallet_address = EXCLUDED.embedded_wallet_address,
             smart_wallet_address = EXCLUDED.smart_wallet_address,
             settlement_chain = EXCLUDED.settlement_chain,
             smart_wallet_provider = EXCLUDED.smart_wallet_provider,
             updated_at = COALESCE(EXCLUDED.updated_at, cashier_wallets.updated_at)
         RETURNING ${WALLET_COLUMNS}`,
        [
          row.id,
          row.user_id,
          row.embedded_wallet_address,
          row.smart_wallet_address,
          row.settlement_chain,
          row.smart_wallet_provider,
          row.created_at,
          row.updated_at,
        ],
      );
      return rowToWallet(saved);
    },

    async getRuntimeFlag(flagKey) {
      const row = await queryOne(
        client,
        `SELECT ${RUNTIME_FLAG_COLUMNS}
         FROM cashier_runtime_flags
         WHERE flag_key = $1`,
        [flagKey],
      );
      return row ? rowToRuntimeFlag(row) : undefined;
    },

    async listRuntimeFlags() {
      const rows = await queryRows(
        client,
        `SELECT ${RUNTIME_FLAG_COLUMNS}
         FROM cashier_runtime_flags
         ORDER BY CASE flag_key
                    WHEN 'tron_deposits_enabled' THEN 1
                    WHEN 'evm_deposits_enabled' THEN 2
                    WHEN 'withdrawals_enabled' THEN 3
                    WHEN 'relayer_enabled' THEN 4
                    WHEN 'provider_callbacks_enabled' THEN 5
                    ELSE 99
                  END,
                  flag_key ASC`,
      );
      return rows.map(rowToRuntimeFlag);
    },

    async setRuntimeFlag(flag) {
      const row = flagToRow(flag);
      const saved = await queryOne(
        client,
        `INSERT INTO cashier_runtime_flags (
           flag_key,
           enabled,
           reason,
           updated_by,
           updated_at
         )
         VALUES ($1, $2, $3, $4, COALESCE($5, NOW()))
         ON CONFLICT (flag_key) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             reason = EXCLUDED.reason,
             updated_by = EXCLUDED.updated_by,
             updated_at = COALESCE(EXCLUDED.updated_at, cashier_runtime_flags.updated_at)
         RETURNING ${RUNTIME_FLAG_COLUMNS}`,
        [row.flag_key, row.enabled, row.reason, row.updated_by, row.updated_at],
      );
      return rowToRuntimeFlag(saved);
    },

    async getDepositIntent(id) {
      const row = await queryOne(
        client,
        `SELECT ${DEPOSIT_INTENT_COLUMNS}
         FROM deposit_intents
         WHERE id = $1`,
        [id],
      );
      return row ? rowToDepositIntent(row) : undefined;
    },

    async findDepositIntentByIdempotencyKey(userId, idempotencyKey) {
      const row = await queryOne(
        client,
        `SELECT ${DEPOSIT_INTENT_COLUMNS}
         FROM deposit_intents
         WHERE user_id = $1
           AND idempotency_key = $2`,
        [userId, idempotencyKey],
      );
      return row ? rowToDepositIntent(row) : undefined;
    },

    async saveDepositIntent(intent, options = {}) {
      const { expectedStatus } = options;
      const row = depositIntentToRow(intent);
      const params = [
        row.id,
        row.user_id,
        row.rail,
        row.status,
        row.source_chain,
        row.source_asset,
        row.source_decimals,
        row.settlement_chain,
        row.settlement_asset,
        row.destination_wallet_address,
        row.provider,
        row.provider_request_id,
        row.deposit_address,
        row.expected_source_units,
        row.actual_source_units,
        row.settled_units,
        row.source_tx_hash,
        row.destination_tx_hash,
        row.recovery_reason,
        row.idempotency_key,
        row.created_at,
        row.updated_at,
      ];
      // Optimistic concurrency: when the caller supplies expectedStatus, only
      // update a row that is still in that status. A concurrent writer that
      // already moved the row on will cause this UPDATE to match zero rows
      // instead of blindly clobbering the newer state.
      const expectedStatusGuard =
        expectedStatus !== undefined ? ` WHERE deposit_intents.status = $${params.length + 1}` : "";
      if (expectedStatus !== undefined) {
        params.push(expectedStatus);
      }
      const saved = await queryOne(
        client,
        `INSERT INTO deposit_intents (
           id,
           user_id,
           rail,
           status,
           source_chain,
           source_asset,
           source_decimals,
           settlement_chain,
           settlement_asset,
           destination_wallet_address,
           provider,
           provider_request_id,
           deposit_address,
           expected_source_units,
           actual_source_units,
           settled_units,
           source_tx_hash,
           destination_tx_hash,
           recovery_reason,
           idempotency_key,
           created_at,
           updated_at
         )
         VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           $9,
           $10,
           $11,
           $12,
           $13,
           $14,
           $15,
           $16,
           $17,
           $18,
           $19,
           $20,
           COALESCE($21, NOW()),
           COALESCE($22, COALESCE($21, NOW()))
         )
         ON CONFLICT (id) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             rail = EXCLUDED.rail,
             status = EXCLUDED.status,
             source_chain = EXCLUDED.source_chain,
             source_asset = EXCLUDED.source_asset,
             source_decimals = EXCLUDED.source_decimals,
             settlement_chain = EXCLUDED.settlement_chain,
             settlement_asset = EXCLUDED.settlement_asset,
             destination_wallet_address = EXCLUDED.destination_wallet_address,
             provider = EXCLUDED.provider,
             provider_request_id = EXCLUDED.provider_request_id,
             deposit_address = EXCLUDED.deposit_address,
             expected_source_units = EXCLUDED.expected_source_units,
             actual_source_units = EXCLUDED.actual_source_units,
             settled_units = EXCLUDED.settled_units,
             source_tx_hash = EXCLUDED.source_tx_hash,
             destination_tx_hash = EXCLUDED.destination_tx_hash,
             recovery_reason = EXCLUDED.recovery_reason,
             idempotency_key = EXCLUDED.idempotency_key,
             updated_at = COALESCE(EXCLUDED.updated_at, deposit_intents.updated_at)${expectedStatusGuard}
         RETURNING ${DEPOSIT_INTENT_COLUMNS}`,
        params,
      );
      if (!saved) {
        throw new CashierConflictError(
          `deposit_intent ${row.id} conflict: expected status ${expectedStatus}`,
        );
      }
      return rowToDepositIntent(saved);
    },

    async listDepositIntentsByUser(userId) {
      const rows = await queryRows(
        client,
        `SELECT ${DEPOSIT_INTENT_COLUMNS}
         FROM deposit_intents
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId],
      );
      return rows.map(rowToDepositIntent);
    },

    async listDepositIntentsForReconciliation(businessDate) {
      const rows = await queryRows(
        client,
        `SELECT ${DEPOSIT_INTENT_COLUMNS}
         FROM deposit_intents
         WHERE created_at >= $1::date
           AND created_at < ($1::date + INTERVAL '1 day')
         ORDER BY created_at ASC`,
        [businessDate],
      );
      return rows.map(rowToDepositIntent);
    },

    async getWithdrawalIntent(id) {
      const row = await queryOne(
        client,
        `SELECT ${WITHDRAWAL_INTENT_COLUMNS}
         FROM withdrawal_intents
         WHERE id = $1`,
        [id],
      );
      return row ? rowToWithdrawalIntent(row) : undefined;
    },

    async findWithdrawalIntentByIdempotencyKey(userId, idempotencyKey) {
      const row = await queryOne(
        client,
        `SELECT ${WITHDRAWAL_INTENT_COLUMNS}
         FROM withdrawal_intents
         WHERE user_id = $1
           AND idempotency_key = $2`,
        [userId, idempotencyKey],
      );
      return row ? rowToWithdrawalIntent(row) : undefined;
    },

    async saveWithdrawalIntent(intent, options = {}) {
      const { expectedStatus } = options;
      const row = withdrawalIntentToRow(intent);
      const params = [
        row.id,
        row.user_id,
        row.status,
        row.settlement_chain,
        row.source_wallet_address,
        row.destination_address,
        row.asset,
        row.decimals,
        row.amount_units,
        row.idempotency_key,
        row.user_authorization_hash,
        row.user_authorization_nonce,
        row.user_authorization_expires_at,
        row.policy_decision_id,
        row.relayer_submission_id,
        row.recovery_reason,
        row.created_at,
        row.updated_at,
      ];
      const expectedStatusGuard =
        expectedStatus !== undefined ? ` WHERE withdrawal_intents.status = $${params.length + 1}` : "";
      if (expectedStatus !== undefined) {
        params.push(expectedStatus);
      }
      const saved = await queryOne(
        client,
        `INSERT INTO withdrawal_intents (
           id,
           user_id,
           status,
           settlement_chain,
           source_wallet_address,
           destination_address,
           asset,
           decimals,
           amount_units,
           idempotency_key,
           user_authorization_hash,
           user_authorization_nonce,
           user_authorization_expires_at,
           policy_decision_id,
           relayer_submission_id,
           recovery_reason,
           created_at,
           updated_at
         )
         VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           $9,
           $10,
           $11,
           $12,
           $13,
           $14,
           $15,
           $16,
           COALESCE($17, NOW()),
           COALESCE($18, COALESCE($17, NOW()))
         )
         ON CONFLICT (id) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             status = EXCLUDED.status,
             settlement_chain = EXCLUDED.settlement_chain,
             source_wallet_address = EXCLUDED.source_wallet_address,
             destination_address = EXCLUDED.destination_address,
             asset = EXCLUDED.asset,
             decimals = EXCLUDED.decimals,
             amount_units = EXCLUDED.amount_units,
             idempotency_key = EXCLUDED.idempotency_key,
             user_authorization_hash = EXCLUDED.user_authorization_hash,
             user_authorization_nonce = EXCLUDED.user_authorization_nonce,
             user_authorization_expires_at = EXCLUDED.user_authorization_expires_at,
             policy_decision_id = EXCLUDED.policy_decision_id,
             relayer_submission_id = EXCLUDED.relayer_submission_id,
             recovery_reason = EXCLUDED.recovery_reason,
             updated_at = COALESCE(EXCLUDED.updated_at, withdrawal_intents.updated_at)${expectedStatusGuard}
         RETURNING ${WITHDRAWAL_INTENT_COLUMNS}`,
        params,
      );
      if (!saved) {
        throw new CashierConflictError(
          `withdrawal_intent ${row.id} conflict: expected status ${expectedStatus}`,
        );
      }
      return rowToWithdrawalIntent(saved);
    },

    async listWithdrawalIntentsByUser(userId) {
      const rows = await queryRows(
        client,
        `SELECT ${WITHDRAWAL_INTENT_COLUMNS}
         FROM withdrawal_intents
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId],
      );
      return rows.map(rowToWithdrawalIntent);
    },

    async insertBridgeEvent(event) {
      const row = bridgeEventToRow(event);
      // bridge_events has two independent UNIQUE constraints: idempotency_key
      // and (provider, raw_body_sha256). ON CONFLICT (idempotency_key) DO
      // NOTHING only suppresses the first; a conflict on the second still
      // raises a unique_violation, which queryOne() translates into a
      // CashierConflictError. Treat either conflict as the same "duplicate
      // delivery" case rather than letting the second one surface as an
      // unhandled error.
      let inserted;
      try {
        inserted = await queryOne(
          client,
          `INSERT INTO bridge_events (
           id,
           provider,
           provider_request_id,
           deposit_intent_id,
           status,
           idempotency_key,
           source_chain,
           source_tx_hash,
           source_address,
           deposit_address,
           destination_chain,
           destination_tx_hash,
           destination_wallet_address,
           amount_units,
           asset,
           decimals,
           recovery_reason,
           raw_body_sha256,
           signature_version,
           verifier_key_id,
           observed_at,
           created_at
         )
         VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           $9,
           $10,
           $11,
           $12,
           $13,
           $14,
           $15,
           $16,
           $17,
           $18,
           $19,
           $20,
           COALESCE($21, NOW()),
           COALESCE($22, NOW())
         )
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING ${BRIDGE_EVENT_COLUMNS}`,
        [
          row.id,
          row.provider,
          row.provider_request_id,
          row.deposit_intent_id,
          row.status,
          row.idempotency_key,
          row.source_chain,
          row.source_tx_hash,
          row.source_address,
          row.deposit_address,
          row.destination_chain,
          row.destination_tx_hash,
          row.destination_wallet_address,
          row.amount_units,
          row.asset,
          row.decimals,
          row.recovery_reason,
          row.raw_body_sha256,
          row.signature_version,
          row.verifier_key_id,
          row.observed_at,
          row.created_at,
        ],
        );
      } catch (err) {
        if (err instanceof CashierConflictError) {
          // Conflict on (provider, raw_body_sha256); fall through to the
          // duplicate lookup below instead of propagating.
          inserted = undefined;
        } else {
          throw err;
        }
      }
      if (inserted) {
        return { inserted: true, event: rowToBridgeEvent(inserted) };
      }

      const existingByIdempotencyKey = await queryOne(
        client,
        `SELECT ${BRIDGE_EVENT_COLUMNS}
         FROM bridge_events
         WHERE idempotency_key = $1`,
        [event.idempotencyKey],
      );
      const existing =
        existingByIdempotencyKey ??
        (row.provider && row.raw_body_sha256
          ? await queryOne(
              client,
              `SELECT ${BRIDGE_EVENT_COLUMNS}
               FROM bridge_events
               WHERE provider = $1
                 AND raw_body_sha256 = $2`,
              [row.provider, row.raw_body_sha256],
            )
          : undefined);
      if (!existing) {
        throw new Error("bridge_event_idempotency_conflict_not_found");
      }
      return { inserted: false, event: rowToBridgeEvent(existing) };
    },

    async listBridgeEvents() {
      const rows = await queryRows(
        client,
        `SELECT ${BRIDGE_EVENT_COLUMNS}
         FROM bridge_events
         ORDER BY created_at ASC`,
      );
      return rows.map(rowToBridgeEvent);
    },

    async listRecoveryCases(filter = {}) {
      const normalizedFilter = Object.entries(filter).filter(([, value]) => value !== undefined);
      const unknownFilter = normalizedFilter.find(([key]) => !RECOVERY_CASE_FILTER_COLUMNS.has(key));
      if (unknownFilter) {
        throw new CashierValidationError(`unsupported recovery case filter key: ${unknownFilter[0]}`, {
          field: unknownFilter[0],
        });
      }

      const where = normalizedFilter.map(([key], index) => {
        const column = RECOVERY_CASE_FILTER_COLUMNS.get(key);
        return `${column} = $${index + 1}`;
      });
      const params = normalizedFilter.map(([, value]) => value);
      const rows = await queryRows(
        client,
        `SELECT ${RECOVERY_CASE_COLUMNS}
         FROM recovery_cases
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY updated_at ASC`,
        params,
      );
      return rows.map(rowToRecoveryCase);
    },

    async getRecoveryCase(id) {
      const row = await queryOne(
        client,
        `SELECT ${RECOVERY_CASE_COLUMNS}
         FROM recovery_cases
         WHERE id = $1`,
        [id],
      );
      return row ? rowToRecoveryCase(row) : undefined;
    },

    async saveRecoveryCase(recoveryCase, options = {}) {
      const { expectedStatus } = options;
      const row = recoveryCaseToRow(recoveryCase);
      const params = [
        row.id,
        row.subject_type,
        row.subject_id,
        row.status,
        row.recovery_reason,
        row.user_id,
        row.provider,
        row.provider_request_id,
        row.source_tx_hash,
        row.destination_tx_hash,
        row.assigned_operator_id,
        row.opened_at,
        row.updated_at,
        row.closed_at,
      ];
      const expectedStatusGuard =
        expectedStatus !== undefined ? ` WHERE recovery_cases.status = $${params.length + 1}` : "";
      if (expectedStatus !== undefined) {
        params.push(expectedStatus);
      }
      const saved = await queryOne(
        client,
        `INSERT INTO recovery_cases (
           id,
           subject_type,
           subject_id,
           status,
           recovery_reason,
           user_id,
           provider,
           provider_request_id,
           source_tx_hash,
           destination_tx_hash,
           assigned_operator_id,
           opened_at,
           updated_at,
           closed_at
         )
         VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           $9,
           $10,
           $11,
           COALESCE($12, NOW()),
           COALESCE($13, COALESCE($12, NOW())),
           $14
         )
         ON CONFLICT (id) DO UPDATE
         SET subject_type = EXCLUDED.subject_type,
             subject_id = EXCLUDED.subject_id,
             status = EXCLUDED.status,
             recovery_reason = EXCLUDED.recovery_reason,
             user_id = EXCLUDED.user_id,
             provider = EXCLUDED.provider,
             provider_request_id = EXCLUDED.provider_request_id,
             source_tx_hash = EXCLUDED.source_tx_hash,
             destination_tx_hash = EXCLUDED.destination_tx_hash,
             assigned_operator_id = EXCLUDED.assigned_operator_id,
             updated_at = COALESCE(EXCLUDED.updated_at, recovery_cases.updated_at),
             closed_at = EXCLUDED.closed_at${expectedStatusGuard}
         RETURNING ${RECOVERY_CASE_COLUMNS}`,
        params,
      );
      if (!saved) {
        throw new CashierConflictError(
          `recovery_case ${row.id} conflict: expected status ${expectedStatus}`,
        );
      }
      return rowToRecoveryCase(saved);
    },

    async recordRecoveryApproval(approval) {
      const row = recoveryApprovalToRow(approval);
      const saved = await queryOne(
        client,
        `INSERT INTO recovery_approvals (
           id,
           recovery_case_id,
           operator_id,
           approval_type,
           decision,
           evidence_sha256,
           note,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
         ON CONFLICT (id) DO UPDATE
         SET recovery_case_id = EXCLUDED.recovery_case_id,
             operator_id = EXCLUDED.operator_id,
             approval_type = EXCLUDED.approval_type,
             decision = EXCLUDED.decision,
             evidence_sha256 = EXCLUDED.evidence_sha256,
             note = EXCLUDED.note
         RETURNING ${RECOVERY_APPROVAL_COLUMNS}`,
        [
          row.id,
          row.recovery_case_id,
          row.operator_id,
          row.approval_type,
          row.decision,
          row.evidence_sha256,
          row.note,
          row.created_at,
        ],
      );
      return rowToRecoveryApproval(saved);
    },

    async listRecoveryApprovals(recoveryCaseId) {
      const rows = await queryRows(
        client,
        `SELECT ${RECOVERY_APPROVAL_COLUMNS}
         FROM recovery_approvals
         WHERE recovery_case_id = $1
         ORDER BY created_at ASC`,
        [recoveryCaseId],
      );
      return rows.map(rowToRecoveryApproval);
    },

    async recordAuditEvent(event) {
      const row = auditEventToRow(event);
      const saved = await queryOne(
        client,
        `INSERT INTO cashier_audit_events (
           id,
           subject_type,
           subject_id,
           event_type,
           event_payload,
           payload_sha256,
           actor_type,
           actor_id,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, COALESCE($9, NOW()))
         ON CONFLICT (id) DO NOTHING
         RETURNING ${AUDIT_EVENT_COLUMNS}`,
        [
          row.id,
          row.subject_type,
          row.subject_id,
          row.event_type,
          row.event_payload,
          row.payload_sha256,
          row.actor_type,
          row.actor_id,
          row.created_at,
        ],
      );
      if (saved) {
        return rowToAuditEvent(saved);
      }

      const existing = await queryOne(
        client,
        `SELECT ${AUDIT_EVENT_COLUMNS}
         FROM cashier_audit_events
         WHERE id = $1`,
        [event.id],
      );
      if (!existing) {
        throw new Error("audit_event_idempotency_conflict_not_found");
      }
      return rowToAuditEvent(existing);
    },

    async listAuditEventsBySubject(subjectType, subjectId) {
      const rows = await queryRows(
        client,
        `SELECT ${AUDIT_EVENT_COLUMNS}
         FROM cashier_audit_events
         WHERE subject_type = $1
           AND subject_id = $2
         ORDER BY created_at ASC`,
        [subjectType, subjectId],
      );
      return rows.map(rowToAuditEvent);
    },

    async getReconciliationReportByBusinessDate(businessDate) {
      const reportRow = await queryOne(
        client,
        `SELECT ${RECONCILIATION_REPORT_COLUMNS}
         FROM reconciliation_reports
         WHERE business_date = $1::date
         ORDER BY generated_at DESC, created_at DESC
         LIMIT 1`,
        [businessDate],
      );
      if (!reportRow) {
        return undefined;
      }

      const itemRows = await queryRows(
        client,
        `SELECT ${RECONCILIATION_ITEM_COLUMNS}
         FROM reconciliation_items
         WHERE report_id = $1
         ORDER BY id ASC`,
        [reportRow.id],
      );
      return rowToReconciliationReport(reportRow, itemRows);
    },

    async saveReconciliationReport(report) {
      // The report row and all of its items must land atomically: a crash or
      // error partway through previously left a report with a partial item
      // set. Check out a dedicated client and wrap the writes in one
      // transaction.
      if (typeof client.connect !== "function") {
        throw new TypeError(
          "saveReconciliationReport requires a pool with connect() for transactional writes",
        );
      }
      const conn = await client.connect();
      try {
        await conn.query("BEGIN");

        const reportRow = reconciliationReportToRow(report);
        const savedReport = await queryOne(
          conn,
          `INSERT INTO reconciliation_reports (
             id,
             business_date,
             generated_at,
             generated_by
           )
           VALUES ($1, $2::date, $3, $4)
           ON CONFLICT (id) DO UPDATE
           SET business_date = EXCLUDED.business_date,
               generated_at = EXCLUDED.generated_at,
               generated_by = EXCLUDED.generated_by
           RETURNING ${RECONCILIATION_REPORT_COLUMNS}`,
          [
            reportRow.id,
            reportRow.business_date,
            reportRow.generated_at,
            reportRow.generated_by,
          ],
        );

        const savedItems = [];
        for (const item of report.items ?? []) {
          const row = reconciliationItemToRow(item, report.id);
          const savedItem = await queryOne(
            conn,
            `INSERT INTO reconciliation_items (
               id,
               report_id,
               subject_type,
               subject_id,
               expected_units,
               observed_units,
               asset,
               chain,
               status,
               provider_request_id,
               source_tx_hash,
               destination_tx_hash,
               notes
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (report_id, subject_type, subject_id) DO UPDATE
             SET expected_units = EXCLUDED.expected_units,
                 observed_units = EXCLUDED.observed_units,
                 asset = EXCLUDED.asset,
                 chain = EXCLUDED.chain,
                 status = EXCLUDED.status,
                 provider_request_id = EXCLUDED.provider_request_id,
                 source_tx_hash = EXCLUDED.source_tx_hash,
                 destination_tx_hash = EXCLUDED.destination_tx_hash,
                 notes = EXCLUDED.notes
             RETURNING ${RECONCILIATION_ITEM_COLUMNS}`,
            [
              row.id,
              row.report_id,
              row.subject_type,
              row.subject_id,
              row.expected_units,
              row.observed_units,
              row.asset,
              row.chain,
              row.status,
              row.provider_request_id,
              row.source_tx_hash,
              row.destination_tx_hash,
              row.notes,
            ],
          );
          savedItems.push(savedItem);
        }

        await conn.query("COMMIT");
        return rowToReconciliationReport(savedReport, savedItems);
      } catch (err) {
        await conn.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    },
  };
}

function resolveQueryClient(clientOrOptions) {
  const client = clientOrOptions?.client ?? clientOrOptions;
  if (!client || typeof client.query !== "function") {
    throw new TypeError("createSqlCashierRepository requires a query client");
  }
  return client;
}

async function queryRows(client, text, params = []) {
  try {
    const result = await client.query(text, params);
    return result?.rows ?? [];
  } catch (err) {
    // Postgres constraint violations (SQLSTATE class 23) become typed cashier
    // errors here so the handlers layer can map them to 400/409 instead of an
    // unhandled 500.
    throw translatePostgresError(err);
  }
}

async function queryOne(client, text, params = []) {
  const rows = await queryRows(client, text, params);
  return rows[0];
}

function walletToRow(wallet) {
  return {
    id: wallet.id ?? stableId("wallet", wallet.userId),
    user_id: wallet.userId,
    embedded_wallet_address: wallet.embeddedWalletAddress,
    smart_wallet_address: wallet.smartWalletAddress,
    settlement_chain: wallet.settlementChain,
    smart_wallet_provider: wallet.smartWalletProvider,
    created_at: wallet.createdAt,
    updated_at: wallet.updatedAt,
  };
}

function rowToWallet(row) {
  return compact({
    userId: row.user_id,
    embeddedWalletAddress: row.embedded_wallet_address,
    smartWalletAddress: row.smart_wallet_address,
    settlementChain: row.settlement_chain,
    smartWalletProvider: row.smart_wallet_provider,
    createdAt: toIsoString(row.created_at),
  });
}

function flagToRow(flag) {
  return {
    flag_key: flag.flagKey,
    enabled: flag.enabled,
    reason: flag.reason,
    updated_by: flag.updatedBy,
    updated_at: flag.updatedAt,
  };
}

function rowToRuntimeFlag(row) {
  return compact({
    flagKey: row.flag_key,
    enabled: row.enabled,
    reason: row.reason,
    updatedBy: row.updated_by,
    updatedAt: toIsoString(row.updated_at),
  });
}

function depositIntentToRow(intent) {
  return {
    id: intent.id,
    user_id: intent.userId,
    rail: intent.rail,
    status: intent.status,
    source_chain: intent.sourceChain,
    source_asset: intent.sourceAsset,
    source_decimals: intent.sourceDecimals,
    settlement_chain: intent.settlementChain,
    settlement_asset: intent.settlementAsset,
    destination_wallet_address: intent.destinationWalletAddress,
    provider: intent.provider,
    provider_request_id: intent.providerRequestId,
    deposit_address: intent.depositAddress,
    expected_source_units: intent.expectedSourceUnits ?? intent.expectedSourceAmount?.units,
    actual_source_units: intent.actualSourceUnits ?? intent.actualSourceAmount?.units,
    settled_units: intent.settledUnits ?? intent.settledAmount?.units,
    source_tx_hash: intent.sourceTxHash,
    destination_tx_hash: intent.destinationTxHash,
    recovery_reason: intent.recoveryReason,
    idempotency_key: intent.idempotencyKey,
    created_at: intent.createdAt,
    updated_at: intent.updatedAt,
  };
}

function rowToDepositIntent(row) {
  return compact({
    id: row.id,
    userId: row.user_id,
    rail: row.rail,
    status: row.status,
    sourceChain: row.source_chain,
    sourceAsset: row.source_asset,
    sourceDecimals: row.source_decimals,
    settlementChain: row.settlement_chain,
    settlementAsset: row.settlement_asset,
    destinationWalletAddress: row.destination_wallet_address,
    provider: row.provider,
    providerRequestId: row.provider_request_id,
    depositAddress: row.deposit_address,
    expectedSourceAmount: row.expected_source_units
      ? tokenAmount(row.source_asset, row.source_chain, row.source_decimals, row.expected_source_units)
      : undefined,
    actualSourceAmount: row.actual_source_units
      ? tokenAmount(row.source_asset, row.source_chain, row.source_decimals, row.actual_source_units)
      : undefined,
    settledAmount: row.settled_units
      ? settlementTokenAmount(row.settlement_asset, row.settlement_chain, row.settled_units)
      : undefined,
    sourceTxHash: row.source_tx_hash,
    destinationTxHash: row.destination_tx_hash,
    recoveryReason: row.recovery_reason,
    idempotencyKey: row.idempotency_key,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  });
}

function withdrawalIntentToRow(intent) {
  return {
    id: intent.id,
    user_id: intent.userId,
    status: intent.status,
    settlement_chain: intent.settlementChain,
    source_wallet_address: intent.sourceWalletAddress,
    destination_address: intent.destinationAddress,
    asset: intent.asset ?? intent.amount?.asset,
    decimals: intent.decimals ?? intent.amount?.decimals,
    amount_units: intent.amountUnits ?? intent.amount?.units,
    idempotency_key: intent.idempotencyKey,
    user_authorization_hash: intent.userAuthorizationHash,
    user_authorization_nonce: intent.userAuthorizationNonce,
    user_authorization_expires_at: intent.userAuthorizationExpiresAt,
    policy_decision_id: intent.policyDecisionId,
    relayer_submission_id: intent.relayerSubmissionId,
    recovery_reason: intent.recoveryReason,
    created_at: intent.createdAt,
    updated_at: intent.updatedAt,
  };
}

function rowToWithdrawalIntent(row) {
  return compact({
    id: row.id,
    userId: row.user_id,
    status: row.status,
    settlementChain: row.settlement_chain,
    sourceWalletAddress: row.source_wallet_address,
    destinationAddress: row.destination_address,
    amount: tokenAmount(
      row.asset,
      amountChainForAsset(row.asset, row.settlement_chain),
      row.decimals,
      row.amount_units,
    ),
    idempotencyKey: row.idempotency_key,
    userAuthorizationHash: row.user_authorization_hash,
    userAuthorizationNonce: row.user_authorization_nonce,
    userAuthorizationExpiresAt: toIsoString(row.user_authorization_expires_at),
    policyDecisionId: row.policy_decision_id,
    relayerSubmissionId: row.relayer_submission_id,
    recoveryReason: row.recovery_reason,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  });
}

function bridgeEventToRow(event) {
  return {
    id: event.id,
    provider: event.provider,
    provider_request_id: event.providerRequestId,
    deposit_intent_id: event.depositIntentId,
    status: event.status,
    idempotency_key: event.idempotencyKey,
    source_chain: event.sourceChain,
    source_tx_hash: event.sourceTxHash,
    source_address: event.sourceAddress,
    deposit_address: event.depositAddress,
    destination_chain: event.destinationChain,
    destination_tx_hash: event.destinationTxHash,
    destination_wallet_address: event.destinationWalletAddress,
    amount_units: event.amountUnits ?? event.amount?.units,
    asset: event.asset ?? event.amount?.asset,
    decimals: event.decimals ?? event.amount?.decimals,
    recovery_reason: event.recoveryReason,
    raw_body_sha256:
      event.rawBodySha256 ?? event.callbackVerification?.envelope?.rawBodySha256,
    signature_version: event.signatureVersion ?? event.callbackVerification?.signatureVersion,
    verifier_key_id: event.verifierKeyId ?? event.callbackVerification?.verifierKeyId,
    observed_at: event.observedAt,
    created_at: event.createdAt,
  };
}

function rowToBridgeEvent(row) {
  return compact({
    id: row.id,
    provider: row.provider,
    providerRequestId: row.provider_request_id,
    depositIntentId: row.deposit_intent_id,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    sourceChain: row.source_chain,
    sourceTxHash: row.source_tx_hash,
    sourceAddress: row.source_address,
    depositAddress: row.deposit_address,
    destinationChain: row.destination_chain,
    destinationTxHash: row.destination_tx_hash,
    destinationWalletAddress: row.destination_wallet_address,
    amount: row.amount_units
      ? tokenAmount(
          row.asset,
          row.source_chain ?? row.destination_chain,
          row.decimals,
          row.amount_units,
        )
      : undefined,
    recoveryReason: row.recovery_reason,
    observedAt: toIsoString(row.observed_at),
    createdAt: toIsoString(row.created_at),
  });
}

function recoveryCaseToRow(recoveryCase) {
  return {
    id: recoveryCase.id,
    subject_type: recoveryCase.subjectType,
    subject_id: recoveryCase.subjectId,
    status: recoveryCase.status,
    recovery_reason: recoveryCase.recoveryReason,
    user_id: recoveryCase.userId,
    provider: recoveryCase.provider,
    provider_request_id: recoveryCase.providerRequestId,
    source_tx_hash: recoveryCase.sourceTxHash,
    destination_tx_hash: recoveryCase.destinationTxHash,
    assigned_operator_id: recoveryCase.assignedOperatorId,
    opened_at: recoveryCase.openedAt,
    updated_at: recoveryCase.updatedAt,
    closed_at: recoveryCase.closedAt,
  };
}

function rowToRecoveryCase(row) {
  return compact({
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    status: row.status,
    recoveryReason: row.recovery_reason,
    userId: row.user_id,
    provider: row.provider,
    providerRequestId: row.provider_request_id,
    sourceTxHash: row.source_tx_hash,
    destinationTxHash: row.destination_tx_hash,
    assignedOperatorId: row.assigned_operator_id,
    openedAt: toIsoString(row.opened_at),
    updatedAt: toIsoString(row.updated_at),
    closedAt: toIsoString(row.closed_at),
  });
}

function recoveryApprovalToRow(approval) {
  return {
    id: approval.id,
    recovery_case_id: approval.recoveryCaseId,
    operator_id: approval.operatorId,
    approval_type: approval.approvalType,
    decision: approval.decision,
    evidence_sha256: approval.evidenceSha256,
    note: approval.note,
    created_at: approval.createdAt,
  };
}

function rowToRecoveryApproval(row) {
  return compact({
    id: row.id,
    recoveryCaseId: row.recovery_case_id,
    operatorId: row.operator_id,
    approvalType: row.approval_type,
    decision: row.decision,
    evidenceSha256: row.evidence_sha256,
    note: row.note,
    createdAt: toIsoString(row.created_at),
  });
}

function auditEventToRow(event) {
  return {
    id: event.id,
    subject_type: event.subjectType,
    subject_id: event.subjectId,
    event_type: event.eventType,
    event_payload: JSON.stringify(event.eventPayload ?? {}),
    payload_sha256: event.payloadSha256,
    actor_type: event.actorType,
    actor_id: event.actorId,
    created_at: event.createdAt,
  };
}

function rowToAuditEvent(row) {
  return compact({
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    eventType: row.event_type,
    eventPayload: parseJsonPayload(row.event_payload),
    payloadSha256: row.payload_sha256,
    actorType: row.actor_type,
    actorId: row.actor_id,
    createdAt: toIsoString(row.created_at),
  });
}

function rowToReconciliationReport(reportRow, itemRows) {
  return {
    id: reportRow.id,
    businessDate: toDateString(reportRow.business_date),
    generatedAt: toIsoString(reportRow.generated_at),
    generatedBy: reportRow.generated_by,
    items: itemRows.map(rowToReconciliationItem),
  };
}

function reconciliationReportToRow(report) {
  return {
    id: report.id,
    business_date: report.businessDate,
    generated_at: report.generatedAt,
    generated_by: report.generatedBy,
  };
}

function reconciliationItemToRow(item, reportId) {
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

function rowToReconciliationItem(row) {
  return compact({
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    expectedUnits: row.expected_units,
    observedUnits: row.observed_units,
    asset: row.asset,
    chain: row.chain,
    status: row.status,
    providerRequestId: row.provider_request_id,
    sourceTxHash: row.source_tx_hash,
    destinationTxHash: row.destination_tx_hash,
    notes: row.notes,
  });
}

function parseJsonPayload(value) {
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  return value ?? {};
}

function tokenAmount(asset, chain, decimals, units) {
  return compact({
    asset,
    chain,
    decimals,
    units,
  });
}

function amountChainForAsset(asset, settlementChain) {
  return asset === "hUSD" ? "settlement" : settlementChain;
}

// Explicit (asset, chain) -> decimals table. This must stay in sync with the
// combinations the cashier schema and providers actually support (see the
// deposit_intents/bridge_events/withdrawal_intents CHECK constraints in
// migrations/001_cashier_core.sql and packages/cashier-sdk's DECIMALS table).
// An unrecognized pair throws rather than silently defaulting to 6, which
// previously could misrepresent a settlement amount by orders of magnitude.
const ASSET_CHAIN_DECIMALS = new Map([
  ["USDT:tron", 6],
  ["USDT:bsc", 18],
  ["USDC:polygon", 6],
  ["USDC:base", 6],
  ["USDC:arbitrum", 6],
  ["hUSD:settlement", 6],
]);

export function decimalForAssetOnChain(asset, chain) {
  const decimals = ASSET_CHAIN_DECIMALS.get(`${asset}:${chain}`);
  if (decimals === undefined) {
    throw new Error(`unknown_asset_chain_decimals:${asset}:${chain}`);
  }
  return decimals;
}

// Reconstructs the settlement-leg TokenAmount for a deposit intent. The chain
// used for the decimals lookup must be the same chain reported on the
// TokenAmount itself (amountChainForAsset's mapping), not the raw
// settlement_chain column -- hUSD always settles on the logical "settlement"
// chain regardless of which EVM chain the wallet lives on.
function settlementTokenAmount(asset, settlementChain, units) {
  const chain = amountChainForAsset(asset, settlementChain);
  return tokenAmount(asset, chain, decimalForAssetOnChain(asset, chain), units);
}

function toIsoString(value) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function toDateString(value) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null),
  );
}

function stableId(prefix, input) {
  const digest = createHash("sha256").update(String(input)).digest("hex").slice(0, 16);
  return `${prefix}_${digest}`;
}
