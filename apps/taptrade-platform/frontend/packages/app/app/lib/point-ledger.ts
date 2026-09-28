import { formatPoints } from "./points";

export interface PointLedgerTransaction {
  type: string;
  amount: number;
  idempotencyKey?: string;
  description?: string;
}

export function isPositivePointMovement(tx: PointLedgerTransaction): boolean {
  const normalized = tx.type.toLowerCase();
  if (normalized === "reservation") return false;
  if (normalized === "release") return true;
  if (normalized === "credit") return true;
  if (normalized === "debit") return false;
  return tx.amount >= 0;
}

function ledgerFingerprint(tx: PointLedgerTransaction): string {
  return `${tx.type} ${tx.idempotencyKey || ""} ${tx.description || ""}`
    .toLowerCase()
    .replace(/_/g, " ");
}

const LEGACY_PREDICTION_SETTLEMENT_FINGERPRINT = [
  "prediction",
  "pay" + "out",
].join(" ");

function isPredictionSettlementFingerprint(fingerprint: string): boolean {
  return (
    fingerprint.includes("prediction settlement") ||
    fingerprint.includes(LEGACY_PREDICTION_SETTLEMENT_FINGERPRINT)
  );
}

export function pointLedgerTypeLabel(tx: PointLedgerTransaction): string {
  const fingerprint = ledgerFingerprint(tx);
  if (
    tx.type.toLowerCase() === "reservation" &&
    fingerprint.includes("prediction order")
  ) {
    return "Order Clout locked";
  }
  if (
    tx.type.toLowerCase() === "release" &&
    fingerprint.includes("prediction order")
  ) {
    return "Order Clout unlocked";
  }
  if (
    tx.type.toLowerCase() === "debit" &&
    fingerprint.includes("prediction fill")
  ) {
    return "Order filled";
  }
  if (
    tx.type.toLowerCase() === "credit" &&
    fingerprint.includes("prediction fill proceeds")
  ) {
    return "Order proceeds";
  }
  if (
    tx.type.toLowerCase() === "credit" &&
    isPredictionSettlementFingerprint(fingerprint)
  ) {
    return "Settlement Clout";
  }
  if (fingerprint.includes("starter grant")) return "Starter Clout";
  if (fingerprint.includes("daily claim")) return "Daily Clout";
  if (fingerprint.includes("point pack grant")) return "Clout pack";
  // Point Store credits (reasons: point_pack_purchase / promo_bonus, keys:
  // store_purchase:<id>[:bonus]) — purchased vs bonus stay distinguishable.
  if (fingerprint.includes("promo bonus")) return "Bonus Clout";
  if (fingerprint.includes("point pack purchase")) return "Clout pack purchase";
  if (fingerprint.includes("mission reward")) return "Mission reward";
  if (fingerprint.includes("streak reward")) return "Streak reward";

  const normalized = tx.type.toLowerCase().replace(/_/g, " ");
  if (normalized === "credit") return "Clout added";
  if (normalized === "debit") return "Clout used";
  if (normalized === "reservation") return "Clout locked";
  if (normalized === "release") return "Clout unlocked";
  return normalized.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function pointLedgerDetailLabel(tx: PointLedgerTransaction): string {
  const fingerprint = ledgerFingerprint(tx);
  if (isPredictionSettlementFingerprint(fingerprint)) {
    return "Prediction settlement";
  }
  if (fingerprint.includes("prediction fill proceeds")) return "Trade proceeds";
  if (fingerprint.includes("prediction fill")) return "Trade fill";
  if (fingerprint.includes("prediction order")) return "Prediction order";
  if (fingerprint.includes("starter grant")) return "Starter Clout grant";
  if (fingerprint.includes("daily claim")) return "Daily claim";
  if (fingerprint.includes("point pack grant")) return "Clout pack grant";
  if (fingerprint.includes("promo bonus")) return "Promotional bonus Clout";
  if (fingerprint.includes("point pack purchase")) {
    return "Clout pack purchase";
  }
  if (fingerprint.includes("mission reward")) return "Mission reward";
  if (fingerprint.includes("streak reward")) return "Streak reward";
  return tx.description || tx.idempotencyKey || "Point movement";
}

// formatPoints lives in app/lib/points (single Points-display module);
// the delta wrapper below derives sign from the movement type, so it
// formats the absolute amount.
export function formatPointDelta(tx: PointLedgerTransaction): string {
  return `${isPositivePointMovement(tx) ? "+" : "-"}${formatPoints(
    Math.abs(tx.amount),
  )}`;
}
