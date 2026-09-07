/**
 * Tap Trade API client entrypoint.
 *
 * Shared auth, wallet, and compliance infrastructure remain available through
 * this package. New prediction-market work should import PredictionApiClient
 * or createPredictionClient from this package entrypoint instead of reaching
 * into src/prediction-client directly.
 */

export { TapTradeApiClient } from "./client";
export {
  AuthManager,
  createAuthManager,
  decodeJWT,
  isJWTExpired,
} from "./auth";
export {
  PredictionApiClient,
  createPredictionClient,
} from "./prediction-client";
export type { AuthTokens } from "./auth";

// Type exports
export type {
  TokenResponse,
  SessionResponse,
  ErrorResponse,
  PaginationMeta,
  WalletBalance,
  WalletLedgerEntry,
  WalletMutationResponse,
  AuditLogEntry,
  LoginRequest,
  RefreshRequest,
  WalletMutationRequest,
  PaginationOptions,
  ListResponse,
  SimpleListResponse,
  ApiClientConfig,
} from "./types";

export { ApiError } from "./types";

export type {
  Category,
  PredictionEvent,
  PredictionMarket,
  PredictionOrder,
  Position,
  Trade,
  OrderPreview,
  PortfolioSummary,
  SettledPositionResult,
  DiscoveryResponse,
  PlaceOrderRequest,
  PlaceOrderResponse,
  PaginatedResponse,
  CreateCategoryRequest,
  CreateSeriesRequest,
  CreateMarketRequest,
  MarketLifecycleAction,
  SettleMarketRequest,
  SettleMarketResponse,
  SettlementReplayResponse,
  DashboardVolumeStats,
  OrderBook,
  DriftAlertsResponse,
} from "./prediction-types";
