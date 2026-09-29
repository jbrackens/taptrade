/**
 * cashier-client — the crypto cashier's read of the gateway alpha cashier
 * (FEATURE_CASHIER_UI only). Kept apart from wallet-client, which stays a
 * payment-free points client (app/__tests__/wallet-paths.test.ts).
 *
 * The gateway mounts /api/v1/cashier/alpha/* only when its money flags are
 * on; otherwise this 404s and the UI shows the rail as unavailable.
 */

import { apiClient } from "./client";

/** The alpha cashier's public, non-secret settings. */
export interface AlphaCashierConfig {
  enabled: boolean;
  chainId: number;
  chainName: string;
  tokenSymbol: string;
  tokenAddress: string;
  tokenDecimals: number;
  treasuryAddress: string;
  confirmations: number;
  minDepositCents: number;
  maxDepositCents: number;
  dailyDepositLimitCents: number;
  withdrawalsEnabled: boolean;
  depositScannerEnabled?: boolean;
}

export async function getAlphaCashierConfig(): Promise<AlphaCashierConfig> {
  const raw = await apiClient.get<{ alphaCashier: AlphaCashierConfig }>(
    "/api/v1/cashier/alpha/config",
  );
  return raw.alphaCashier;
}
