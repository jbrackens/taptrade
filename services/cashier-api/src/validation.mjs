import { CashierValidationError } from "./errors.mjs";

/**
 * Request-shape validation mirroring the enums/patterns in openapi.yaml.
 * These run before any repository call so malformed requests never reach the
 * database and never surface as an unhandled 500.
 */

export const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
export const POSITIVE_BASE_UNITS_PATTERN = /^[1-9][0-9]*$/;

export const ASSET_SYMBOLS = ["USDT", "USDC", "hUSD"];
export const SETTLEMENT_CHAINS = ["polygon", "bsc", "base", "arbitrum"];
export const DEPOSIT_RAILS = ["tron-usdt-deposit-address", "evm-stablecoin-direct", "manual-recovery"];

const ASSET_SYMBOL_SET = new Set(ASSET_SYMBOLS);
const SETTLEMENT_CHAIN_SET = new Set(SETTLEMENT_CHAINS);
const DEPOSIT_RAIL_SET = new Set(DEPOSIT_RAILS);

function fail(field, message) {
  throw new CashierValidationError(message, { field });
}

function requireBody(request) {
  if (!request || typeof request !== "object") {
    fail("body", "request body is required");
  }
}

export function validateCreateDepositIntentRequest(request) {
  requireBody(request);
  if (typeof request.rail !== "string" || !DEPOSIT_RAIL_SET.has(request.rail)) {
    fail("rail", `rail must be one of: ${DEPOSIT_RAILS.join(", ")}`);
  }
  if (typeof request.settlementChain !== "string" || !SETTLEMENT_CHAIN_SET.has(request.settlementChain)) {
    fail("settlementChain", `settlementChain must be one of: ${SETTLEMENT_CHAINS.join(", ")}`);
  }
}

export function validateCreateWithdrawalIntentRequest(request) {
  requireBody(request);
  if (typeof request.destinationAddress !== "string" || !EVM_ADDRESS_PATTERN.test(request.destinationAddress)) {
    fail("destinationAddress", "destinationAddress must match ^0x[a-fA-F0-9]{40}$");
  }
  if (typeof request.asset !== "string" || !ASSET_SYMBOL_SET.has(request.asset)) {
    fail("asset", `asset must be one of: ${ASSET_SYMBOLS.join(", ")}`);
  }
  if (typeof request.amountUnits !== "string" || !POSITIVE_BASE_UNITS_PATTERN.test(request.amountUnits)) {
    fail("amountUnits", "amountUnits must be a positive base-unit integer string");
  }
  if (typeof request.settlementChain !== "string" || !SETTLEMENT_CHAIN_SET.has(request.settlementChain)) {
    fail("settlementChain", `settlementChain must be one of: ${SETTLEMENT_CHAINS.join(", ")}`);
  }
}
