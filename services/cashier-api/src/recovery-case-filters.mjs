/**
 * Recovery case filter keys accepted by both repository backends'
 * `listRecoveryCases(filter)`. Keeping this list in one place lets the
 * in-memory and SQL repositories reject the same unknown keys the same way.
 */
export const RECOVERY_CASE_FILTER_KEYS = [
  "id",
  "subjectType",
  "subjectId",
  "status",
  "recoveryReason",
  "userId",
  "provider",
  "providerRequestId",
  "sourceTxHash",
  "destinationTxHash",
  "assignedOperatorId",
];

export const RECOVERY_CASE_FILTER_KEY_SET = new Set(RECOVERY_CASE_FILTER_KEYS);
