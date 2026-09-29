export type ChainKind = "tron" | "evm";

export type SettlementChain = "polygon" | "bsc" | "base" | "arbitrum";

export type AssetSymbol = "USDT" | "USDC" | "hUSD";

export type ProviderName = "relay" | "symbiosis" | "lifi" | "debridge" | "manual";

export type IdempotencyKey = `${string}:${string}`;

export type DepositRail =
  | "tron-usdt-deposit-address"
  | "evm-stablecoin-direct"
  | "manual-recovery";

export type DepositIntentStatus =
  | "created"
  | "address_issued"
  | "source_detected"
  | "bridging"
  | "settled"
  | "recovery_required"
  | "failed";

export type BridgeEventStatus =
  | "received"
  | "signature_verified"
  | "source_confirmed"
  | "destination_confirmed"
  | "ignored_duplicate"
  | "quarantined"
  | "failed";

export type WithdrawalStatus =
  | "created"
  | "user_authorized"
  | "policy_approved"
  | "submitted"
  | "confirmed"
  | "recovery_required"
  | "failed";

export type RelayerSubmissionStatus =
  | "queued"
  | "submitted"
  | "included"
  | "replaced"
  | "dropped"
  | "failed";

export interface DecimalSpec {
  readonly chainKind: ChainKind;
  readonly chain: string;
  readonly asset: AssetSymbol;
  readonly decimals: number;
}

export const DECIMALS = {
  tronUsdt: { chainKind: "tron", chain: "tron", asset: "USDT", decimals: 6 },
  bscUsdt: { chainKind: "evm", chain: "bsc", asset: "USDT", decimals: 18 },
  polygonUsdc: {
    chainKind: "evm",
    chain: "polygon",
    asset: "USDC",
    decimals: 6,
  },
  hUSD: { chainKind: "evm", chain: "settlement", asset: "hUSD", decimals: 6 },
} as const satisfies Record<string, DecimalSpec>;

export interface CashierUserWallet {
  readonly userId: string;
  readonly embeddedWalletAddress: `0x${string}`;
  readonly smartWalletAddress: `0x${string}`;
  readonly settlementChain: SettlementChain;
  readonly smartWalletProvider?: "safe" | "erc4337" | "thirdweb" | "privy";
  readonly createdAt: string;
}

export interface DepositIntent {
  readonly id: string;
  readonly userId: string;
  readonly rail: DepositRail;
  readonly status: DepositIntentStatus;
  readonly sourceChain: "tron" | SettlementChain;
  readonly sourceAsset: AssetSymbol;
  readonly sourceDecimals: number;
  readonly settlementChain: SettlementChain;
  readonly settlementAsset: AssetSymbol;
  readonly destinationWalletAddress: `0x${string}`;
  readonly provider?: ProviderName;
  readonly providerRequestId?: string;
  readonly depositAddress?: string;
  readonly expectedSourceAmount?: TokenAmount;
  readonly actualSourceAmount?: TokenAmount;
  readonly settledAmount?: TokenAmount;
  readonly sourceTxHash?: string;
  readonly destinationTxHash?: `0x${string}`;
  readonly recoveryReason?: RecoveryReason;
  readonly idempotencyKey: IdempotencyKey;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TokenAmount {
  readonly asset: AssetSymbol;
  readonly chain: string;
  readonly decimals: number;
  readonly units: string;
}

export type RecoveryReason =
  | "wrong_token"
  | "wrong_chain"
  | "under_minimum"
  | "expired_quote"
  | "provider_failed"
  | "ambiguous_source"
  | "sanctions_review";

export interface CreateDepositIntentRequest {
  readonly userId: string;
  readonly rail: DepositRail;
  readonly settlementChain: SettlementChain;
  readonly idempotencyKey: IdempotencyKey;
}

export interface ProviderCallbackEnvelope {
  readonly provider: ProviderName;
  readonly receivedAt: string;
  readonly signatureHeader: string;
  readonly rawBodySha256: string;
}

export interface ProviderCallbackVerification {
  readonly envelope: ProviderCallbackEnvelope;
  readonly signatureVersion: string;
  readonly verifiedAt: string;
  readonly verifierKeyId: string;
}

export interface BridgeEvent {
  readonly id: string;
  readonly provider: ProviderName;
  readonly providerRequestId?: string;
  readonly depositIntentId?: string;
  readonly status: BridgeEventStatus;
  readonly idempotencyKey: IdempotencyKey;
  readonly sourceChain?: "tron" | SettlementChain;
  readonly sourceTxHash?: string;
  readonly sourceAddress?: string;
  readonly depositAddress?: string;
  readonly destinationChain?: SettlementChain;
  readonly destinationTxHash?: `0x${string}`;
  readonly destinationWalletAddress?: `0x${string}`;
  readonly amount?: TokenAmount;
  readonly recoveryReason?: RecoveryReason;
  readonly callbackVerification?: ProviderCallbackVerification;
  readonly observedAt: string;
}

export interface WithdrawalIntent {
  readonly id: string;
  readonly userId: string;
  readonly status: WithdrawalStatus;
  readonly settlementChain: SettlementChain;
  readonly sourceWalletAddress: `0x${string}`;
  readonly destinationAddress: string;
  readonly amount: TokenAmount;
  readonly idempotencyKey: IdempotencyKey;
  readonly userAuthorizationHash?: `0x${string}`;
  readonly userAuthorizationNonce?: string;
  readonly userAuthorizationExpiresAt?: string;
  readonly policyDecisionId?: string;
  readonly relayerSubmissionId?: string;
  readonly recoveryReason?: RecoveryReason;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RelayerSubmission {
  readonly id: string;
  readonly status: RelayerSubmissionStatus;
  readonly settlementChain: SettlementChain;
  readonly userId: string;
  readonly smartWalletAddress: `0x${string}`;
  readonly targetContract: `0x${string}`;
  readonly calldataSha256: string;
  readonly userAuthorizationHash: `0x${string}`;
  readonly userAuthorizationNonce: string;
  readonly userAuthorizationExpiresAt: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly submittedTxHash?: `0x${string}`;
  readonly includedTxHash?: `0x${string}`;
  readonly failureReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ComplianceDecision {
  readonly id: string;
  readonly subjectType: "deposit" | "withdrawal" | "address" | "relayer_submission";
  readonly subjectId: string;
  readonly decision: "allow" | "manual_review" | "quarantine" | "deny";
  readonly reasons: readonly string[];
  readonly decidedAt: string;
  readonly decidedBy: "system" | "operator";
}

export interface AuditEvent {
  readonly id: string;
  readonly subjectType: "deposit" | "withdrawal" | "relayer_submission" | "recovery";
  readonly subjectId: string;
  readonly eventType: string;
  readonly eventPayload: Record<string, unknown>;
  readonly payloadSha256: string;
  readonly actorType: "system" | "operator" | "provider";
  readonly actorId?: string;
  readonly createdAt: string;
}

export type RecoveryCaseStatus =
  | "triage"
  | "waiting_on_provider"
  | "waiting_on_user"
  | "compliance_hold"
  | "ready_for_release"
  | "closed";

export interface RecoveryCase {
  readonly id: string;
  readonly subjectType: "deposit" | "withdrawal" | "bridge_event";
  readonly subjectId: string;
  readonly status: RecoveryCaseStatus;
  readonly recoveryReason: RecoveryReason;
  readonly userId?: string;
  readonly provider?: ProviderName;
  readonly providerRequestId?: string;
  readonly sourceTxHash?: string;
  readonly destinationTxHash?: `0x${string}`;
  readonly assignedOperatorId?: string;
  readonly openedAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
}

export interface RecoveryApproval {
  readonly id: string;
  readonly recoveryCaseId: string;
  readonly operatorId: string;
  readonly approvalType: string;
  readonly decision: "approve" | "deny";
  readonly evidenceSha256: string;
  readonly note: string;
  readonly createdAt: string;
}

export interface CanaryCheck {
  readonly name: string;
  readonly status: "ok" | "warn" | "fail";
  readonly durationMs: number;
  readonly message?: string;
}

export interface CanaryResult {
  readonly id: string;
  readonly status: "ok" | "warn" | "fail";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly checks: readonly CanaryCheck[];
}

export type RuntimeFlagKey =
  | "tron_deposits_enabled"
  | "evm_deposits_enabled"
  | "withdrawals_enabled"
  | "relayer_enabled"
  | "provider_callbacks_enabled";

export interface RuntimeFlag {
  readonly flagKey: RuntimeFlagKey;
  readonly enabled: boolean;
  readonly reason: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

export interface ReconciliationItem {
  readonly id: string;
  readonly subjectType: "deposit" | "withdrawal" | "relayer_submission";
  readonly subjectId: string;
  readonly expectedUnits: string;
  readonly observedUnits: string;
  readonly asset: AssetSymbol;
  readonly chain: string;
  readonly status: "matched" | "missing_provider" | "missing_chain" | "amount_mismatch" | "quarantined";
  readonly providerRequestId?: string;
  readonly sourceTxHash?: string;
  readonly destinationTxHash?: `0x${string}`;
  readonly notes?: string;
}

export interface ReconciliationReport {
  readonly id: string;
  readonly businessDate: string;
  readonly generatedAt: string;
  readonly generatedBy: string;
  readonly items: readonly ReconciliationItem[];
}

export interface ReconciliationSummary {
  readonly reportId: string;
  readonly businessDate: string;
  readonly itemCount: number;
  readonly matchedCount: number;
  readonly mismatchCount: number;
  readonly byStatus: Record<ReconciliationItem["status"], number>;
}

export interface RelayerPolicyInput {
  readonly submission: RelayerSubmission;
  readonly complianceDecision: Pick<ComplianceDecision, "decision">;
  readonly allowedTargets: readonly `0x${string}`[];
  readonly allowedSelectors: readonly string[];
  readonly calldataSelector: string;
  readonly amount?: TokenAmount;
  readonly maxAmountUnits?: string;
  readonly paymasterRunwaySeconds: number;
  readonly minPaymasterRunwaySeconds: number;
  readonly alreadySubmittedOrIncluded: boolean;
  readonly now: string;
  readonly paused?: boolean;
}

export interface RelayerPolicyResult {
  readonly decision: "allow" | "deny";
  readonly reasons: readonly string[];
}

export interface CashierCompliancePolicyInput {
  readonly subjectType: ComplianceDecision["subjectType"];
  readonly amount?: TokenAmount;
  readonly perTransactionCapUnits?: string;
  readonly dailyAggregateUnits?: string;
  readonly dailyCapUnits?: string;
  readonly geoAllowed: boolean;
  readonly addressScreening:
    | "clear"
    | "manual_review"
    | "sanctions_hit"
    | "unavailable";
  readonly paused?: boolean;
}

export interface CashierCompliancePolicyResult {
  readonly decision: ComplianceDecision["decision"];
  readonly reasons: readonly string[];
}

export interface ProviderCallbackSignatureInput {
  readonly rawBody: string;
  readonly signatureHeader: string;
  readonly secret: string;
  readonly computeHmacSha256: (secret: string, rawBody: string) => string;
}

const SETTLEMENT_CHAINS = ["polygon", "bsc", "base", "arbitrum"] as const;
const PROVIDERS = ["relay", "symbiosis", "lifi", "debridge", "manual"] as const;
const DEPOSIT_RAILS = [
  "tron-usdt-deposit-address",
  "evm-stablecoin-direct",
  "manual-recovery",
] as const;
const DEPOSIT_STATUSES = [
  "created",
  "address_issued",
  "source_detected",
  "bridging",
  "settled",
  "recovery_required",
  "failed",
] as const;
const BRIDGE_EVENT_STATUSES = [
  "received",
  "signature_verified",
  "source_confirmed",
  "destination_confirmed",
  "ignored_duplicate",
  "quarantined",
  "failed",
] as const;
const WITHDRAWAL_STATUSES = [
  "created",
  "user_authorized",
  "policy_approved",
  "submitted",
  "confirmed",
  "recovery_required",
  "failed",
] as const;
const RELAYER_STATUSES = [
  "queued",
  "submitted",
  "included",
  "replaced",
  "dropped",
  "failed",
] as const;
const COMPLIANCE_SUBJECT_TYPES = [
  "deposit",
  "withdrawal",
  "address",
  "relayer_submission",
] as const;
const COMPLIANCE_DECISIONS = [
  "allow",
  "manual_review",
  "quarantine",
  "deny",
] as const;
const COMPLIANCE_DECIDED_BY = ["system", "operator"] as const;
const AUDIT_SUBJECT_TYPES = [
  "deposit",
  "withdrawal",
  "relayer_submission",
  "recovery",
] as const;
const AUDIT_ACTOR_TYPES = ["system", "operator", "provider"] as const;
const RECOVERY_CASE_SUBJECT_TYPES = ["deposit", "withdrawal", "bridge_event"] as const;
const RECOVERY_CASE_STATUSES = [
  "triage",
  "waiting_on_provider",
  "waiting_on_user",
  "compliance_hold",
  "ready_for_release",
  "closed",
] as const;
const RECOVERY_REASONS = [
  "wrong_token",
  "wrong_chain",
  "under_minimum",
  "expired_quote",
  "provider_failed",
  "ambiguous_source",
  "sanctions_review",
] as const;
const RUNTIME_FLAG_KEYS = [
  "tron_deposits_enabled",
  "evm_deposits_enabled",
  "withdrawals_enabled",
  "relayer_enabled",
  "provider_callbacks_enabled",
] as const;
const RECONCILIATION_SUBJECT_TYPES = [
  "deposit",
  "withdrawal",
  "relayer_submission",
] as const;
const RECONCILIATION_STATUSES = [
  "matched",
  "missing_provider",
  "missing_chain",
  "amount_mismatch",
  "quarantined",
] as const;
const CANARY_STATUSES = ["ok", "warn", "fail"] as const;
const ADDRESS_SCREENING_STATUSES = [
  "clear",
  "manual_review",
  "sanctions_hit",
  "unavailable",
] as const;

export const DEPOSIT_STATUS_TRANSITIONS = {
  created: ["address_issued", "recovery_required", "failed"],
  address_issued: ["source_detected", "recovery_required", "failed"],
  source_detected: ["bridging", "recovery_required", "failed"],
  bridging: ["settled", "recovery_required", "failed"],
  settled: [],
  recovery_required: [],
  failed: [],
} as const satisfies Record<DepositIntentStatus, readonly DepositIntentStatus[]>;

export const WITHDRAWAL_STATUS_TRANSITIONS = {
  created: ["user_authorized", "recovery_required", "failed"],
  user_authorized: ["policy_approved", "recovery_required", "failed"],
  policy_approved: ["submitted", "recovery_required", "failed"],
  submitted: ["confirmed", "recovery_required", "failed"],
  confirmed: [],
  recovery_required: [],
  failed: [],
} as const satisfies Record<WithdrawalStatus, readonly WithdrawalStatus[]>;

export const RELAYER_STATUS_TRANSITIONS = {
  queued: ["submitted", "failed"],
  submitted: ["included", "replaced", "dropped", "failed"],
  included: [],
  replaced: ["submitted", "included", "dropped", "failed"],
  dropped: ["submitted", "failed"],
  failed: [],
} as const satisfies Record<RelayerSubmissionStatus, readonly RelayerSubmissionStatus[]>;

export const RECOVERY_CASE_STATUS_TRANSITIONS = {
  triage: [
    "waiting_on_provider",
    "waiting_on_user",
    "compliance_hold",
    "ready_for_release",
    "closed",
  ],
  waiting_on_provider: [
    "triage",
    "waiting_on_user",
    "compliance_hold",
    "ready_for_release",
    "closed",
  ],
  waiting_on_user: [
    "triage",
    "waiting_on_provider",
    "compliance_hold",
    "ready_for_release",
    "closed",
  ],
  compliance_hold: ["triage", "ready_for_release", "closed"],
  ready_for_release: ["closed"],
  closed: [],
} as const satisfies Record<RecoveryCaseStatus, readonly RecoveryCaseStatus[]>;

export function isTerminalDepositStatus(status: DepositIntentStatus): boolean {
  return (
    status === "settled" ||
    status === "recovery_required" ||
    status === "failed"
  );
}

export function canTransitionDepositStatus(
  from: DepositIntentStatus,
  to: DepositIntentStatus,
): boolean {
  const allowed = DEPOSIT_STATUS_TRANSITIONS[from] as readonly DepositIntentStatus[];
  return allowed.includes(to);
}

export function isTerminalWithdrawalStatus(status: WithdrawalStatus): boolean {
  return (
    status === "confirmed" ||
    status === "recovery_required" ||
    status === "failed"
  );
}

export function canTransitionWithdrawalStatus(
  from: WithdrawalStatus,
  to: WithdrawalStatus,
): boolean {
  const allowed = WITHDRAWAL_STATUS_TRANSITIONS[from] as readonly WithdrawalStatus[];
  return allowed.includes(to);
}

export function isTerminalRelayerStatus(
  status: RelayerSubmissionStatus,
): boolean {
  return status === "included" || status === "failed";
}

export function canTransitionRelayerStatus(
  from: RelayerSubmissionStatus,
  to: RelayerSubmissionStatus,
): boolean {
  const allowed = RELAYER_STATUS_TRANSITIONS[
    from
  ] as readonly RelayerSubmissionStatus[];
  return allowed.includes(to);
}

export function isTerminalRecoveryCaseStatus(
  status: RecoveryCaseStatus,
): boolean {
  return status === "closed";
}

export function canTransitionRecoveryCaseStatus(
  from: RecoveryCaseStatus,
  to: RecoveryCaseStatus,
): boolean {
  const allowed = RECOVERY_CASE_STATUS_TRANSITIONS[
    from
  ] as readonly RecoveryCaseStatus[];
  return allowed.includes(to);
}

export function nextDepositStatusForBridgeEvent(
  current: DepositIntentStatus,
  event: Pick<BridgeEvent, "status">,
): DepositIntentStatus {
  if (isTerminalDepositStatus(current)) {
    return current;
  }

  switch (event.status) {
    case "source_confirmed":
      return canTransitionDepositStatus(current, "source_detected")
        ? "source_detected"
        : current;
    case "destination_confirmed":
      if (canTransitionDepositStatus(current, "settled")) {
        return "settled";
      }
      if (canTransitionDepositStatus(current, "bridging")) {
        return "bridging";
      }
      return current;
    case "quarantined":
      return canTransitionDepositStatus(current, "recovery_required")
        ? "recovery_required"
        : current;
    case "failed":
      return canTransitionDepositStatus(current, "failed") ? "failed" : current;
    case "received":
    case "signature_verified":
    case "ignored_duplicate":
      return current;
  }
}

export function applyBridgeEventToDepositIntent(
  intent: DepositIntent,
  event: BridgeEvent,
  now: string,
): DepositIntent {
  assertValidDepositIntent(intent);
  assertValidBridgeEvent(event);

  if (event.depositIntentId && event.depositIntentId !== intent.id) {
    throw new Error("BridgeEvent.depositIntentId does not match DepositIntent.id");
  }

  const nextStatus = nextDepositStatusForBridgeEvent(intent.status, event);
  if (nextStatus === intent.status) {
    return intent;
  }

  const updated: DepositIntent = {
    ...intent,
    status: nextStatus,
    updatedAt: now,
  };
  const txEvidence = {
    ...(event.sourceTxHash ? { sourceTxHash: event.sourceTxHash } : {}),
    ...(event.destinationTxHash ? { destinationTxHash: event.destinationTxHash } : {}),
  };
  if (event.status === "source_confirmed" && event.amount) {
    return { ...updated, ...txEvidence, actualSourceAmount: event.amount };
  }
  if (event.status === "destination_confirmed" && event.amount) {
    return {
      ...updated,
      ...txEvidence,
      settledAmount: event.amount,
    };
  }
  if (nextStatus === "recovery_required") {
    return {
      ...updated,
      ...txEvidence,
      recoveryReason: event.recoveryReason ?? intent.recoveryReason ?? "provider_failed",
    };
  }
  return {
    ...updated,
    ...txEvidence,
  };
}

export function createRecoveryCaseFromBridgeEvent(parts: {
  readonly id: string;
  readonly intent: DepositIntent;
  readonly event: BridgeEvent;
  readonly openedAt: string;
}): RecoveryCase {
  assertValidDepositIntent(parts.intent);
  assertValidBridgeEvent(parts.event);
  if (parts.event.status !== "quarantined" && parts.event.status !== "failed") {
    throw new Error("Recovery case requires quarantined or failed bridge event");
  }
  const recoveryCase: RecoveryCase = {
    id: parts.id,
    subjectType: "deposit",
    subjectId: parts.intent.id,
    status: "triage",
    recoveryReason:
      parts.event.recoveryReason ?? parts.intent.recoveryReason ?? "provider_failed",
    userId: parts.intent.userId,
    provider: parts.event.provider,
    openedAt: parts.openedAt,
    updatedAt: parts.openedAt,
  };
  return {
    ...recoveryCase,
    ...(parts.event.providerRequestId ? { providerRequestId: parts.event.providerRequestId } : {}),
    ...(parts.event.sourceTxHash ? { sourceTxHash: parts.event.sourceTxHash } : {}),
    ...(parts.event.destinationTxHash
      ? { destinationTxHash: parts.event.destinationTxHash }
      : {}),
  };
}

export function assertValidCashierUserWallet(wallet: CashierUserWallet): void {
  assertNonEmpty(wallet.userId, "CashierUserWallet.userId");
  assertEvmAddress(
    wallet.embeddedWalletAddress,
    "CashierUserWallet.embeddedWalletAddress",
  );
  assertEvmAddress(
    wallet.smartWalletAddress,
    "CashierUserWallet.smartWalletAddress",
  );
  assertOneOf(
    wallet.settlementChain,
    SETTLEMENT_CHAINS,
    "CashierUserWallet.settlementChain",
  );
  if (wallet.smartWalletProvider) {
    assertOneOf(
      wallet.smartWalletProvider,
      ["safe", "erc4337", "thirdweb", "privy"] as const,
      "CashierUserWallet.smartWalletProvider",
    );
  }
  assertValidDateTime(wallet.createdAt, "CashierUserWallet.createdAt");
}

export function assertValidDepositIntent(intent: DepositIntent): void {
  assertNonEmpty(intent.id, "DepositIntent.id");
  assertNonEmpty(intent.userId, "DepositIntent.userId");
  assertOneOf(intent.rail, DEPOSIT_RAILS, "DepositIntent.rail");
  assertOneOf(intent.status, DEPOSIT_STATUSES, "DepositIntent.status");
  assertOneOf(intent.settlementChain, SETTLEMENT_CHAINS, "DepositIntent.settlementChain");
  assertNonEmpty(intent.idempotencyKey, "DepositIntent.idempotencyKey");
  assertEvmAddress(intent.destinationWalletAddress, "DepositIntent.destinationWalletAddress");

  if (intent.rail === "tron-usdt-deposit-address" && intent.sourceChain !== "tron") {
    throw new Error("TRC-20 deposit rail must use tron as sourceChain");
  }
  assertKnownDecimalSpec({
    chainKind: intent.sourceChain === "tron" ? "tron" : "evm",
    chain: intent.sourceChain,
    asset: intent.sourceAsset,
    decimals: intent.sourceDecimals,
  });

  for (const amount of [
    intent.expectedSourceAmount,
    intent.actualSourceAmount,
    intent.settledAmount,
  ]) {
    if (amount) {
      assertBaseUnits(amount);
    }
  }

  if (intent.status === "address_issued" && !intent.depositAddress) {
    throw new Error("address_issued deposit intent must include depositAddress");
  }
  if (intent.status === "settled" && !intent.destinationTxHash) {
    throw new Error("settled deposit intent must include destinationTxHash");
  }
}

export function assertValidBridgeEvent(event: BridgeEvent): void {
  assertNonEmpty(event.id, "BridgeEvent.id");
  assertNonEmpty(event.provider, "BridgeEvent.provider");
  assertOneOf(event.provider, PROVIDERS, "BridgeEvent.provider");
  assertOneOf(event.status, BRIDGE_EVENT_STATUSES, "BridgeEvent.status");
  assertNonEmpty(event.idempotencyKey, "BridgeEvent.idempotencyKey");
  assertNonEmpty(event.observedAt, "BridgeEvent.observedAt");

  if (event.amount) {
    assertBaseUnits(event.amount);
  }
  if (event.status === "source_confirmed" && !event.sourceTxHash) {
    throw new Error("source_confirmed bridge event must include sourceTxHash");
  }
  if (event.status === "destination_confirmed") {
    if (!event.destinationTxHash) {
      throw new Error("destination_confirmed bridge event must include destinationTxHash");
    }
    if (!event.destinationWalletAddress) {
      throw new Error(
        "destination_confirmed bridge event must include destinationWalletAddress",
      );
    }
    assertEvmAddress(
      event.destinationWalletAddress,
      "BridgeEvent.destinationWalletAddress",
    );
  }
  if (event.callbackVerification) {
    assertProviderCallbackVerification(event.callbackVerification);
  }
}

export function assertValidRelayerSubmission(submission: RelayerSubmission): void {
  assertNonEmpty(submission.id, "RelayerSubmission.id");
  assertOneOf(
    submission.status,
    RELAYER_STATUSES,
    "RelayerSubmission.status",
  );
  assertOneOf(
    submission.settlementChain,
    SETTLEMENT_CHAINS,
    "RelayerSubmission.settlementChain",
  );
  assertNonEmpty(submission.userId, "RelayerSubmission.userId");
  assertEvmAddress(
    submission.smartWalletAddress,
    "RelayerSubmission.smartWalletAddress",
  );
  assertEvmAddress(submission.targetContract, "RelayerSubmission.targetContract");
  assertHex32(submission.userAuthorizationHash, "RelayerSubmission.userAuthorizationHash");
  assertNonEmpty(
    submission.userAuthorizationNonce,
    "RelayerSubmission.userAuthorizationNonce",
  );
  assertValidDateTime(
    submission.userAuthorizationExpiresAt,
    "RelayerSubmission.userAuthorizationExpiresAt",
  );
  assertNonEmpty(submission.calldataSha256, "RelayerSubmission.calldataSha256");
  assertNonEmpty(submission.idempotencyKey, "RelayerSubmission.idempotencyKey");
}

export function assertValidWithdrawalIntent(intent: WithdrawalIntent): void {
  assertNonEmpty(intent.id, "WithdrawalIntent.id");
  assertNonEmpty(intent.userId, "WithdrawalIntent.userId");
  assertOneOf(intent.status, WITHDRAWAL_STATUSES, "WithdrawalIntent.status");
  assertOneOf(
    intent.settlementChain,
    SETTLEMENT_CHAINS,
    "WithdrawalIntent.settlementChain",
  );
  assertEvmAddress(intent.sourceWalletAddress, "WithdrawalIntent.sourceWalletAddress");
  assertEvmAddress(intent.destinationAddress, "WithdrawalIntent.destinationAddress");
  assertBaseUnits(intent.amount);
  assertNonEmpty(intent.idempotencyKey, "WithdrawalIntent.idempotencyKey");
  if (
    intent.status !== "created" &&
    intent.status !== "recovery_required" &&
    intent.status !== "failed" &&
    !intent.userAuthorizationHash
  ) {
    throw new Error("authorized/submitted withdrawal must include userAuthorizationHash");
  }
  if (intent.userAuthorizationHash) {
    assertHex32(intent.userAuthorizationHash, "WithdrawalIntent.userAuthorizationHash");
    assertNonEmpty(
      intent.userAuthorizationNonce,
      "WithdrawalIntent.userAuthorizationNonce",
    );
    assertValidDateTime(
      intent.userAuthorizationExpiresAt,
      "WithdrawalIntent.userAuthorizationExpiresAt",
    );
  }
}

export function assertValidComplianceDecision(decision: ComplianceDecision): void {
  assertNonEmpty(decision.id, "ComplianceDecision.id");
  assertOneOf(
    decision.subjectType,
    COMPLIANCE_SUBJECT_TYPES,
    "ComplianceDecision.subjectType",
  );
  assertNonEmpty(decision.subjectId, "ComplianceDecision.subjectId");
  assertOneOf(decision.decision, COMPLIANCE_DECISIONS, "ComplianceDecision.decision");
  assertOneOf(decision.decidedBy, COMPLIANCE_DECIDED_BY, "ComplianceDecision.decidedBy");
  if (decision.reasons.length === 0) {
    throw new Error("ComplianceDecision.reasons must be non-empty");
  }
  assertNonEmpty(decision.decidedAt, "ComplianceDecision.decidedAt");
}

export function assertValidAuditEvent(event: AuditEvent): void {
  assertNonEmpty(event.id, "AuditEvent.id");
  assertOneOf(event.subjectType, AUDIT_SUBJECT_TYPES, "AuditEvent.subjectType");
  assertNonEmpty(event.subjectId, "AuditEvent.subjectId");
  assertNonEmpty(event.eventType, "AuditEvent.eventType");
  assertSha256Hex(event.payloadSha256, "AuditEvent.payloadSha256");
  assertOneOf(event.actorType, AUDIT_ACTOR_TYPES, "AuditEvent.actorType");
  assertNonEmpty(event.createdAt, "AuditEvent.createdAt");
}

export function assertValidRecoveryCase(recoveryCase: RecoveryCase): void {
  assertNonEmpty(recoveryCase.id, "RecoveryCase.id");
  assertOneOf(
    recoveryCase.subjectType,
    RECOVERY_CASE_SUBJECT_TYPES,
    "RecoveryCase.subjectType",
  );
  assertNonEmpty(recoveryCase.subjectId, "RecoveryCase.subjectId");
  assertOneOf(recoveryCase.status, RECOVERY_CASE_STATUSES, "RecoveryCase.status");
  assertOneOf(
    recoveryCase.recoveryReason,
    RECOVERY_REASONS,
    "RecoveryCase.recoveryReason",
  );
  assertNonEmpty(recoveryCase.openedAt, "RecoveryCase.openedAt");
  assertNonEmpty(recoveryCase.updatedAt, "RecoveryCase.updatedAt");
  if (recoveryCase.status === "closed" && !recoveryCase.closedAt) {
    throw new Error("closed RecoveryCase must include closedAt");
  }
  if (recoveryCase.destinationTxHash) {
    assertHex32(recoveryCase.destinationTxHash, "RecoveryCase.destinationTxHash");
  }
}

export function assertValidRecoveryApproval(approval: RecoveryApproval): void {
  assertNonEmpty(approval.id, "RecoveryApproval.id");
  assertNonEmpty(approval.recoveryCaseId, "RecoveryApproval.recoveryCaseId");
  assertNonEmpty(approval.operatorId, "RecoveryApproval.operatorId");
  assertNonEmpty(approval.approvalType, "RecoveryApproval.approvalType");
  assertOneOf(approval.decision, ["approve", "deny"] as const, "RecoveryApproval.decision");
  assertSha256Hex(approval.evidenceSha256, "RecoveryApproval.evidenceSha256");
  assertNonEmpty(approval.note, "RecoveryApproval.note");
  assertNonEmpty(approval.createdAt, "RecoveryApproval.createdAt");
}

export function hasTwoPersonApproval(
  approvals: readonly RecoveryApproval[],
  approvalType: string,
): boolean {
  const operators = new Set<string>();
  for (const approval of approvals) {
    assertValidRecoveryApproval(approval);
    if (approval.approvalType === approvalType && approval.decision === "approve") {
      operators.add(approval.operatorId);
    }
  }
  return operators.size >= 2;
}

export function assertValidCanaryResult(result: CanaryResult): void {
  assertNonEmpty(result.id, "CanaryResult.id");
  assertOneOf(result.status, CANARY_STATUSES, "CanaryResult.status");
  assertNonEmpty(result.startedAt, "CanaryResult.startedAt");
  assertNonEmpty(result.finishedAt, "CanaryResult.finishedAt");
  if (result.checks.length === 0) {
    throw new Error("CanaryResult.checks must be non-empty");
  }
  const worst = result.checks.some((check) => check.status === "fail")
    ? "fail"
    : result.checks.some((check) => check.status === "warn")
      ? "warn"
      : "ok";
  if (result.status !== worst) {
    throw new Error("CanaryResult.status must match worst check status");
  }
  for (const check of result.checks) {
    assertNonEmpty(check.name, "CanaryCheck.name");
    assertOneOf(check.status, CANARY_STATUSES, "CanaryCheck.status");
    if (!Number.isInteger(check.durationMs) || check.durationMs < 0) {
      throw new Error("CanaryCheck.durationMs must be a non-negative integer");
    }
  }
}

export function assertValidRuntimeFlag(flag: RuntimeFlag): void {
  assertOneOf(flag.flagKey, RUNTIME_FLAG_KEYS, "RuntimeFlag.flagKey");
  assertNonEmpty(flag.flagKey, "RuntimeFlag.flagKey");
  assertNonEmpty(flag.reason, "RuntimeFlag.reason");
  assertNonEmpty(flag.updatedBy, "RuntimeFlag.updatedBy");
  assertNonEmpty(flag.updatedAt, "RuntimeFlag.updatedAt");
}

export function isRuntimeFlagEnabled(
  flags: readonly RuntimeFlag[],
  flagKey: RuntimeFlagKey,
): boolean {
  const flag = flags.find((candidate) => candidate.flagKey === flagKey);
  if (!flag) {
    return false;
  }
  assertValidRuntimeFlag(flag);
  return flag.enabled;
}

export function assertValidReconciliationReport(report: ReconciliationReport): void {
  assertNonEmpty(report.id, "ReconciliationReport.id");
  assertNonEmpty(report.businessDate, "ReconciliationReport.businessDate");
  assertNonEmpty(report.generatedAt, "ReconciliationReport.generatedAt");
  assertNonEmpty(report.generatedBy, "ReconciliationReport.generatedBy");
  if (report.items.length === 0) {
    throw new Error("ReconciliationReport.items must be non-empty");
  }
  for (const item of report.items) {
    assertNonEmpty(item.id, "ReconciliationItem.id");
    assertOneOf(
      item.subjectType,
      RECONCILIATION_SUBJECT_TYPES,
      "ReconciliationItem.subjectType",
    );
    assertNonEmpty(item.subjectId, "ReconciliationItem.subjectId");
    assertOneOf(item.status, RECONCILIATION_STATUSES, "ReconciliationItem.status");
    assertNonEmpty(item.expectedUnits, "ReconciliationItem.expectedUnits");
    assertNonEmpty(item.observedUnits, "ReconciliationItem.observedUnits");
    assertBaseUnits({
      asset: item.asset,
      chain: item.chain,
      decimals: decimalForAssetOnChain(item.asset, item.chain),
      units: item.expectedUnits,
    });
    assertBaseUnits({
      asset: item.asset,
      chain: item.chain,
      decimals: decimalForAssetOnChain(item.asset, item.chain),
      units: item.observedUnits,
    });
    if (item.status === "matched" && item.expectedUnits !== item.observedUnits) {
      throw new Error("matched reconciliation item must have equal units");
    }
  }
}

export function summarizeReconciliationReport(
  report: ReconciliationReport,
): ReconciliationSummary {
  assertValidReconciliationReport(report);
  const byStatus: Record<ReconciliationItem["status"], number> = {
    matched: 0,
    missing_provider: 0,
    missing_chain: 0,
    amount_mismatch: 0,
    quarantined: 0,
  };
  for (const item of report.items) {
    byStatus[item.status] += 1;
  }
  return {
    reportId: report.id,
    businessDate: report.businessDate,
    itemCount: report.items.length,
    matchedCount: byStatus.matched,
    mismatchCount: report.items.length - byStatus.matched,
    byStatus,
  };
}

export function assertProviderCallbackVerification(
  verification: ProviderCallbackVerification,
): void {
  assertNonEmpty(
    verification.envelope.signatureHeader,
    "ProviderCallbackEnvelope.signatureHeader",
  );
  assertSha256Hex(
    verification.envelope.rawBodySha256,
    "ProviderCallbackEnvelope.rawBodySha256",
  );
  assertNonEmpty(verification.signatureVersion, "signatureVersion");
  assertNonEmpty(verification.verifierKeyId, "verifierKeyId");
}

export function evaluateRelayerPolicy(
  input: RelayerPolicyInput,
): RelayerPolicyResult {
  const reasons: string[] = [];

  try {
    assertValidRelayerSubmission(input.submission);
  } catch (err) {
    reasons.push(err instanceof Error ? err.message : String(err));
  }

  if (input.paused) {
    reasons.push("relayer_paused");
  }
  if (input.complianceDecision.decision !== "allow") {
    reasons.push(`compliance_${input.complianceDecision.decision}`);
  }
  if (
    !input.allowedTargets
      .map((target) => target.toLowerCase())
      .includes(input.submission.targetContract.toLowerCase())
  ) {
    reasons.push("target_not_allowlisted");
  }
  if (
    !input.allowedSelectors
      .map((selector) => selector.toLowerCase())
      .includes(input.calldataSelector.toLowerCase())
  ) {
    reasons.push("selector_not_allowlisted");
  }
  if (input.amount) {
    try {
      assertBaseUnits(input.amount);
      if (
        input.maxAmountUnits !== undefined &&
        BigInt(input.amount.units) > BigInt(input.maxAmountUnits)
      ) {
        reasons.push("amount_above_cap");
      }
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (input.paymasterRunwaySeconds < input.minPaymasterRunwaySeconds) {
    reasons.push("paymaster_runway_too_low");
  }
  if (input.alreadySubmittedOrIncluded) {
    reasons.push("idempotency_key_already_submitted");
  }
  try {
    assertValidDateTime(input.now, "RelayerPolicyInput.now");
    assertValidDateTime(
      input.submission.userAuthorizationExpiresAt,
      "RelayerSubmission.userAuthorizationExpiresAt",
    );
    if (
      Date.parse(input.submission.userAuthorizationExpiresAt) <= Date.parse(input.now)
    ) {
      reasons.push("authorization_expired");
    }
  } catch (err) {
    reasons.push(err instanceof Error ? err.message : String(err));
  }

  return reasons.length === 0
    ? { decision: "allow", reasons: [] }
    : { decision: "deny", reasons };
}

export function evaluateCashierCompliancePolicy(
  input: CashierCompliancePolicyInput,
): CashierCompliancePolicyResult {
  assertOneOf(
    input.subjectType,
    COMPLIANCE_SUBJECT_TYPES,
    "CashierCompliancePolicyInput.subjectType",
  );
  assertOneOf(
    input.addressScreening,
    ADDRESS_SCREENING_STATUSES,
    "CashierCompliancePolicyInput.addressScreening",
  );

  const reasons: string[] = [];
  let decision: CashierCompliancePolicyResult["decision"] = "allow";

  const escalate = (nextDecision: CashierCompliancePolicyResult["decision"]) => {
    const rank = { allow: 0, manual_review: 1, quarantine: 2, deny: 3 };
    if (rank[nextDecision] > rank[decision]) {
      decision = nextDecision;
    }
  };

  if (input.paused) {
    reasons.push("cashier_paused");
    escalate("manual_review");
  }
  if (!input.geoAllowed) {
    reasons.push("geo_blocked");
    escalate("deny");
  }
  if (input.addressScreening === "sanctions_hit") {
    reasons.push("address_screening_sanctions_hit");
    escalate("quarantine");
  }
  if (input.addressScreening === "manual_review") {
    reasons.push("address_screening_manual_review");
    escalate("manual_review");
  }
  if (input.addressScreening === "unavailable") {
    reasons.push("address_screening_unavailable");
    escalate("manual_review");
  }

  if (input.amount) {
    assertBaseUnits(input.amount);
    if (
      input.perTransactionCapUnits !== undefined &&
      BigInt(input.amount.units) > BigInt(input.perTransactionCapUnits)
    ) {
      reasons.push("per_transaction_cap_exceeded");
      escalate("manual_review");
    }
    if (
      input.dailyAggregateUnits !== undefined &&
      input.dailyCapUnits !== undefined &&
      BigInt(input.dailyAggregateUnits) + BigInt(input.amount.units) >
        BigInt(input.dailyCapUnits)
    ) {
      reasons.push("daily_cap_exceeded");
      escalate("manual_review");
    }
  }

  return { decision, reasons };
}

export function verifyProviderCallbackSignature(
  input: ProviderCallbackSignatureInput,
): boolean {
  assertNonEmpty(input.rawBody, "ProviderCallbackSignatureInput.rawBody");
  assertNonEmpty(input.signatureHeader, "ProviderCallbackSignatureInput.signatureHeader");
  assertNonEmpty(input.secret, "ProviderCallbackSignatureInput.secret");
  const expected = normalizeHex(input.computeHmacSha256(input.secret, input.rawBody));
  const actual = normalizeHex(input.signatureHeader);
  return constantTimeStringEqual(expected, actual);
}

export function makeDepositIdempotencyKey(parts: {
  readonly provider: ProviderName;
  readonly chain: string;
  readonly txHashOrRequestId: string;
  readonly logIndexOrEvent: string | number;
}): IdempotencyKey {
  return [
    "deposit",
    parts.provider,
    parts.chain,
    parts.txHashOrRequestId,
    String(parts.logIndexOrEvent),
  ].join(":") as IdempotencyKey;
}

export function makeWithdrawalIdempotencyKey(parts: {
  readonly userId: string;
  readonly destinationAddress: string;
  readonly amountUnits: string;
  readonly userAuthorizationHash: string;
}): IdempotencyKey {
  return [
    "withdrawal",
    parts.userId,
    parts.destinationAddress.toLowerCase(),
    parts.amountUnits,
    parts.userAuthorizationHash.toLowerCase(),
  ].join(":") as IdempotencyKey;
}

export function makeRelayerIdempotencyKey(parts: {
  readonly chain: SettlementChain;
  readonly smartWalletAddress: `0x${string}`;
  readonly targetContract: `0x${string}`;
  readonly calldataSha256: string;
  readonly userAuthorizationHash: `0x${string}`;
}): IdempotencyKey {
  return [
    "relayer",
    parts.chain,
    parts.smartWalletAddress.toLowerCase(),
    parts.targetContract.toLowerCase(),
    parts.calldataSha256.toLowerCase(),
    parts.userAuthorizationHash.toLowerCase(),
  ].join(":") as IdempotencyKey;
}

export function assertBaseUnits(amount: TokenAmount): void {
  if (!/^(0|[1-9][0-9]*)$/.test(amount.units)) {
    throw new Error("TokenAmount.units must be a non-negative base-unit integer string");
  }
  assertKnownDecimalSpec({
    chainKind: amount.chain === "tron" ? "tron" : "evm",
    chain: amount.chain,
    asset: amount.asset,
    decimals: amount.decimals,
  });
}

export function assertKnownDecimalSpec(spec: DecimalSpec): void {
  const knownSpecs = Object.values(DECIMALS);
  const known = knownSpecs.some(
    (candidate) =>
      candidate.chainKind === spec.chainKind &&
      candidate.chain === spec.chain &&
      candidate.asset === spec.asset &&
      candidate.decimals === spec.decimals,
  );
  if (!known) {
    throw new Error(
      `Unknown decimal spec: ${spec.chainKind}:${spec.chain}:${spec.asset}:${spec.decimals}`,
    );
  }
}

function decimalForAssetOnChain(asset: AssetSymbol, chain: string): number {
  const match = Object.values(DECIMALS).find(
    (candidate) => candidate.asset === asset && candidate.chain === chain,
  );
  if (!match) {
    throw new Error(`Unknown decimal spec for ${asset} on ${chain}`);
  }
  return match.decimals;
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be non-empty`);
  }
}

function assertOneOf<T extends readonly string[]>(
  value: string,
  allowed: T,
  field: string,
): asserts value is T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`${field} has unsupported value: ${value}`);
  }
}

function assertValidDateTime(value: unknown, field: string): asserts value is string {
  assertNonEmpty(value, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be a valid date-time string`);
  }
}

function assertEvmAddress(value: string, field: string): void {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${field} must be an EVM address`);
  }
}

function assertHex32(value: string, field: string): void {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a 32-byte hex string`);
  }
}

function assertSha256Hex(value: string, field: string): void {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a SHA-256 hex string`);
  }
}

function normalizeHex(value: string): string {
  return value.trim().toLowerCase().replace(/^sha256=/, "").replace(/^0x/, "");
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
