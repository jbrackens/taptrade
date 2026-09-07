/**
 * Tap Trade — Prediction Platform API Types
 */

export interface Category {
  id: string;
  slug: string;
  name: string;
  icon?: string;
  sortOrder: number;
  active: boolean;
}

export interface CreateCategoryRequest {
  slug?: string;
  name: string;
  icon?: string;
  sortOrder?: number;
  active?: boolean;
}

export interface Series {
  id: string;
  slug: string;
  title: string;
  description?: string;
  categoryId: string;
  frequency?: string;
  tags: string[];
  active: boolean;
}

export interface CreateSeriesRequest {
  slug?: string;
  title: string;
  description?: string;
  categoryId: string;
  frequency?: string;
  tags?: string[];
  active?: boolean;
}

export interface PredictionEvent {
  id: string;
  seriesId?: string;
  title: string;
  description?: string;
  categoryId: string;
  status: EventStatus;
  featured: boolean;
  openAt?: string;
  closeAt: string;
  settleAt?: string;
  settledAt?: string;
  metadata?: Record<string, unknown>;
  markets?: PredictionMarket[];
}

export type EventStatus =
  | "draft"
  | "open"
  | "trading_halt"
  | "closed"
  | "settling"
  | "settled"
  | "voided";

export interface MarketTranslation {
  title?: string;
  description?: string;
}

export interface PredictionMarket {
  id: string;
  eventId: string;
  /** Parent event's editorial title — Moments cluster headers use it. */
  eventTitle?: string;
  categoryId?: string;
  categorySlug?: string;
  categoryName?: string;
  ticker: string;
  title: string;
  description?: string;
  translations?: Record<string, MarketTranslation>;
  status: MarketStatus;
  result?: "yes" | "no";
  yesPricePoints: number;
  noPricePoints: number;
  lastTradePricePoints?: number;
  volumePoints: number;
  openInterestPoints: number;
  /**
   * Discussion size, present only on user-facing ListMarkets responses
   * (§3-09 — the feed card's activity signal). Absent on GetMarket and
   * worker-shaped list calls; treat missing as "unknown", not zero.
   */
  commentCount?: number;
  liquidityPoints: number;
  settlementSourceKey: string;
  settlementRule: string;
  settlementParams?: Record<string, unknown>;
  feeRateBps: number;
  closeAt: string;
  createdAt: string;
  imagePath?: string;
  imageUrl?: string;
  image_url?: string;

  // Exchange engine fields (migration 019). Markets created before
  // 019 default executionMode='amm'; new markets default 'order_book'.
  // Trade ticket UI must branch on this — order book markets support
  // limit/market/sell/IOC/FOK; AMM markets remain buy-only.
  executionMode?: ExecutionMode;
  ammYesShares?: number;
  ammNoShares?: number;
  ammLiquidityParam?: number;
  ammSubsidyPoints?: number;
  collateralPoolPoints?: number;
  bestYesBidPoints?: number;
  bestYesAskPoints?: number;
  bestNoBidPoints?: number;
  bestNoAskPoints?: number;
  settlementPoolPoints?: number;
  unit?: "PTS" | string;
  lastQuoteAt?: string;
  taptradeLifecycle?: TapTradeMarketLifecycle;
}

// Per-market jurisdiction overlay (P3-07). An optional country allow/deny list
// evaluated AFTER the global geo gate — it can only further restrict, never
// widen. null/absent = no overlay (the global gate is the only control).
export interface MarketJurisdictionPolicy {
  mode: "allow" | "deny";
  countries: string[]; // ISO-3166 alpha-2, e.g. ["US", "CA"]
}

export type MarketStatus =
  | "unopened"
  | "open"
  | "halted"
  | "closed"
  | "proposed_resolution"
  | "disputed"
  | "settled"
  | "voided";

export type TapTradeMarketStage =
  | "draft"
  | "open"
  | "paused"
  | "closed"
  | "resolving"
  | "settled"
  | "invalid"
  | "unknown";

export interface TapTradeLifecycleAction {
  action: string;
  label: string;
  targetStatus: MarketStatus;
  targetStage: TapTradeMarketStage;
  requiresReason: boolean;
  destructive: boolean;
}

export interface TapTradeMarketLifecycle {
  stage: TapTradeMarketStage;
  label: string;
  description: string;
  tradeable: boolean;
  terminal: boolean;
  allowedActions: TapTradeLifecycleAction[];
}

export interface PredictionMarketLifecycleEvent {
  id: string;
  marketId: string;
  eventType: MarketStatus | string;
  actorId?: string;
  actorType: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  occurredAt: string;
  taptradeLifecycle: TapTradeMarketLifecycle;
}

export interface PredictionMarketLifecycleAuditResponse {
  marketId: string;
  data: PredictionMarketLifecycleEvent[];
}

function lifecycleAction(
  action: string,
  label: string,
  targetStatus: MarketStatus,
  targetStage: TapTradeMarketStage,
  requiresReason: boolean,
  destructive: boolean,
): TapTradeLifecycleAction {
  return {
    action,
    label,
    targetStatus,
    targetStage,
    requiresReason,
    destructive,
  };
}

export const TAPTRADE_MARKET_LIFECYCLE_BY_STATUS: Record<
  MarketStatus,
  TapTradeMarketLifecycle
> = {
  unopened: {
    stage: "draft",
    label: "Draft",
    description:
      "Not yet published. Admins can open or cancel before users can trade.",
    tradeable: false,
    terminal: false,
    allowedActions: [
      lifecycleAction("open", "Open", "open", "open", false, false),
      lifecycleAction("void", "Cancel", "voided", "invalid", true, true),
    ],
  },
  open: {
    stage: "open",
    label: "Open",
    description: "Published and accepting prediction orders.",
    tradeable: true,
    terminal: false,
    allowedActions: [
      lifecycleAction("halt", "Pause", "halted", "paused", true, true),
      lifecycleAction("close", "Close", "closed", "closed", true, true),
      lifecycleAction("void", "Invalidate", "voided", "invalid", true, true),
    ],
  },
  halted: {
    stage: "paused",
    label: "Paused",
    description:
      "Visible but not accepting new orders until resumed or closed.",
    tradeable: false,
    terminal: false,
    allowedActions: [
      lifecycleAction("open", "Resume", "open", "open", false, false),
      lifecycleAction("close", "Close", "closed", "closed", true, true),
      lifecycleAction("void", "Invalidate", "voided", "invalid", true, true),
    ],
  },
  closed: {
    stage: "closed",
    label: "Closed",
    description:
      "Trading is closed. The market is ready for resolution or invalidation.",
    tradeable: false,
    terminal: false,
    allowedActions: [
      lifecycleAction(
        "propose",
        "Propose Resolution",
        "proposed_resolution",
        "resolving",
        true,
        true,
      ),
      lifecycleAction("settle", "Settle Now", "settled", "settled", true, true),
      lifecycleAction("void", "Invalidate", "voided", "invalid", true, true),
    ],
  },
  proposed_resolution: {
    stage: "resolving",
    label: "Resolving",
    description:
      "A resolution has been proposed and is awaiting challenge-window finalization.",
    tradeable: false,
    terminal: false,
    allowedActions: [
      lifecycleAction("finalize", "Finalize", "settled", "settled", true, true),
      lifecycleAction("void", "Invalidate", "voided", "invalid", true, true),
    ],
  },
  disputed: {
    stage: "resolving",
    label: "Disputed",
    description: "Resolution is disputed and must be finalized or invalidated.",
    tradeable: false,
    terminal: false,
    allowedActions: [
      lifecycleAction("finalize", "Finalize", "settled", "settled", true, true),
      lifecycleAction("void", "Invalidate", "voided", "invalid", true, true),
    ],
  },
  settled: {
    stage: "settled",
    label: "Settled",
    description: "Final result and point disbursements are recorded.",
    tradeable: false,
    terminal: true,
    allowedActions: [],
  },
  voided: {
    stage: "invalid",
    label: "Invalid",
    description:
      "Market is canceled or invalidated and no longer accepts actions.",
    tradeable: false,
    terminal: true,
    allowedActions: [],
  },
};

export function describeTapTradeMarketLifecycle(
  status?: MarketStatus | string,
): TapTradeMarketLifecycle {
  const mapped =
    TAPTRADE_MARKET_LIFECYCLE_BY_STATUS[status as MarketStatus] || null;
  if (mapped) return mapped;
  return {
    stage: "unknown",
    label: status || "unknown",
    description: "Unknown lifecycle state.",
    tradeable: false,
    terminal: false,
    allowedActions: [],
  };
}

export type OrderSide = "yes" | "no";
export type OrderAction = "buy" | "sell";
export type OrderType = "market" | "limit";
export type OrderStatus =
  | "pending"
  | "open"
  | "partial"
  | "filled"
  | "cancelled"
  | "expired"
  | "rejected";

export type TimeInForce = "gtc" | "ioc" | "fok";

export type SelfMatchAction = "cancel_taker" | "cancel_maker" | "cancel_both";

export type ExecutionMode = "order_book" | "amm";

export type TradeKind = "secondary" | "issuance";

export type EngineKind = "order_book" | "amm";

/**
 * Failure reason values populated on `PredictionOrder.failureReason` when
 * an order is rejected or cancelled by the exchange engine. Mirrors the
 * Go-side `Failure*` constants in internal/prediction/types.go.
 */
export type OrderFailureReason =
  | "price_band_violation"
  | "post_only_would_take"
  | "self_match_rejected"
  | "closed_market"
  | "insufficient_balance"
  | "insufficient_position"
  | "notional_cap_missing"
  | "notional_cap_exceeded"
  | "fok_unavailable";

export interface PredictionOrder {
  id: string;
  userId: string;
  marketId: string;
  side: OrderSide;
  action: OrderAction;
  orderType: OrderType;
  pricePoints?: number;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  totalCostPoints: number;
  status: OrderStatus;
  filledAt?: string;
  cancelledAt?: string;
  createdAt: string;

  // Exchange engine fields (present on order_book markets; ignored on AMM).
  timeInForce?: TimeInForce;
  reservedPoints?: number;
  capturedPoints?: number;
  releasedPoints?: number;
  reservedQuantity?: number;
  averageFillPricePoints?: number;
  filledCostPoints?: number;
  failureReason?: OrderFailureReason;
  postOnly?: boolean;
  clientOrderId?: string;
  selfMatchAction?: SelfMatchAction;
  notionalCapPoints?: number;
  unit?: "PTS" | string;
}

export interface Position {
  id: string;
  userId: string;
  marketId: string;
  side: OrderSide;
  quantity: number;
  avgPricePoints: number;
  totalCostPoints: number;
  realizedPoints: number;
  reservedQuantity?: number;
  unit?: "PTS" | string;
}

export interface Trade {
  id: string;
  marketId: string;
  buyerId: string;
  sellerId?: string;
  buyOrderId?: string;
  sellOrderId?: string;
  side: OrderSide;
  pricePoints: number;
  quantity: number;
  feePoints: number;
  notionalPoints: number;
  isAmmTrade: boolean;
  tradedAt: string;
  unit?: "PTS" | string;

  // Exchange engine fields. matchId links the two trade rows produced by a
  // complementary issuance fill (yes + no, prices summing to 100); equals
  // trade id for secondary transfers. UI groups the trade tape by matchId
  // for issuance and renders one row per match.
  matchId?: string;
  tradeKind?: TradeKind;
  engineKind?: EngineKind;
}

export interface OrderPreview {
  side: OrderSide;
  action: OrderAction;
  quantity: number;
  pricePoints: number;
  totalCostPoints: number;
  feePoints: number;
  maxResultPoints: number;
  maxLossPoints: number;
  newYesPricePoints: number;
  newNoPricePoints: number;
  executionMode?: ExecutionMode;
  filledQuantity?: number;
  unfilledQuantity?: number;
  averageFillPricePoints?: number;
  totalCostWithFeesPoints?: number;
  estimatedSlippagePoints?: number;
  quoteStatus?: OrderStatus;
  quoteStaleAfterMillis?: number;
  quoteGeneratedAtUnixSec?: number;
  unit?: "PTS" | string;
}

export interface PortfolioSummary {
  totalValuePoints: number;
  portfolioValuePoints: number;
  investedPoints: number;
  unrealizedPoints: number;
  realizedPoints: number;
  unit?: "PTS" | string;
  openPositions: number;
  totalPredictions: number;
  correctPredictions: number;
  accuracyPct: number;
}

export interface SettledPositionResult {
  id: string;
  settlementId?: string;
  positionId?: string;
  userId?: string;
  marketId: string;
  side: OrderSide;
  quantity: number;
  entryPricePoints: number;
  exitPricePoints: number;
  realizedPoints: number;
  settlementPoints: number;
  unit?: "PTS" | string;
  paidAt: string;
}

export interface DiscoveryResponse {
  featured: PredictionMarket[];
  trending: PredictionMarket[];
  closingSoon: PredictionMarket[];
  recent: PredictionMarket[];
}

export interface PlaceOrderRequest {
  marketId: string;
  side: OrderSide;
  action: OrderAction;
  orderType: OrderType;
  pricePoints?: number;
  quantity: number;
  idempotencyKey?: string;

  // Exchange engine fields. Ignored on AMM-mode markets.
  // - timeInForce: gtc rests, ioc cancels remainder, fok all-or-nothing.
  // - postOnly: reject if the order would take any quantity at submission.
  // - clientOrderId: caller-supplied ID separate from idempotencyKey.
  // - selfMatchAction: how to handle same-user crossings.
  // - pricePoints: preferred point-native limit price.
  // - notionalCapPoints: preferred point-native market BUY slippage cap.
  timeInForce?: TimeInForce;
  postOnly?: boolean;
  clientOrderId?: string;
  selfMatchAction?: SelfMatchAction;
  notionalCapPoints?: number;
}

/**
 * One price level in the L2 order book. `cumulativeShares` is the cumulative
 * share count up to and including this level (used for ladder rendering).
 */
export interface OrderBookLevel {
  pricePoints: number;
  shares: number;
  cumulativeShares: number;
  notionalPoints: number;
  totalNotionalPoints: number;
  unit: "PTS" | string;
}

export interface OrderBookSide {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

/**
 * Full L2 order book for a market. Both yes and no sides; bids descending
 * price, asks ascending. `cumulativeShares` on each level is the cumulative
 * share count from the top of the book.
 *
 * Populated by GET /api/v1/markets/{idOrTicker}/orderbook?depth=N.
 * Server clamps depth to [1, 100].
 */
export interface OrderBook {
  marketId: string;
  yes: OrderBookSide;
  no: OrderBookSide;
}

/**
 * WebSocket payload for `orderbook:{marketId}` channel. Hint-only; clients
 * refetch the full book via GET /orderbook on receipt.
 */
export interface OrderBookHint {
  marketId: string;
  bestYesBidPoints?: number;
  bestYesAskPoints?: number;
  bestNoBidPoints?: number;
  bestNoAskPoints?: number;
  lastQuoteAt?: string;
  unit?: "PTS" | string;
  ts: string;
}

export interface PlaceOrderResponse {
  order: PredictionOrder;
  trade?: Trade;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PageMeta;
}

// --- Admin ---

export interface CreateMarketRequest {
  eventId: string;
  ticker: string;
  title: string;
  description?: string;
  settlementSourceKey: string;
  settlementRule: string;
  settlementParams?: Record<string, unknown>;
  fallbackSourceKey?: string;
  closeAt: string;
  settlementCutoffAt?: string;
  feeRateBps?: number;
  ammLiquidityParam?: number;
  ammSubsidyPoints?: number;
  articleSourceId?: string;
  aiGenerationLogIds?: string[];
}

export interface CreateEventRequest {
  seriesId?: string;
  title: string;
  description?: string;
  categoryId: string;
  featured?: boolean;
  openAt?: string;
  closeAt: string;
  metadata?: Record<string, unknown>;
}

export type MarketLifecycleAction = "open" | "halt" | "close" | "void";

export interface MarketLifecycleTransitionResponse {
  marketId: string;
  status: MarketStatus;
  reason: string;
  taptradeLifecycle: TapTradeMarketLifecycle;
}

export type MarketResult = "yes" | "no";

/**
 * One row in the backoffice drift-alert table — markets with
 * `prediction_collateral_ledger entry_type='adjustment'` rows in the
 * lookback window. Surfaced by the reconciliation cron after Phase 2 of
 * the two-phase check writes a forensic adjustment.
 */
export interface CollateralDriftAlert {
  marketId: string;
  ticker: string;
  adjustmentCount: number;
  maxDriftPoints: number;
  totalDriftPoints: number;
  latestAdjustedAt: string;
  latestReason: string;
  unit: "PTS" | string;
}

export interface DriftAlertsResponse {
  data: CollateralDriftAlert[];
  sinceText: string;
}

export interface SettleMarketRequest {
  result: MarketResult;
  attestationSource: string;
  attestationId?: string;
  attestationData?: Record<string, unknown>;
  reason?: string;

  // Settlement override audit (engine plan §Settlement Plan, schema 019).
  // Required when an admin proceeds with settlement despite a collateral
  // imbalance. The gateway populates `overridden_by_user_id` and
  // `overridden_at` server-side from the session and timestamp; the admin
  // only supplies the human-readable reason here. All-or-none CHECK
  // constraint on the schema enforces consistency.
  overrideReason?: string;
}

export interface SettlementRecord_Audit {
  overrideReason?: string;
  overriddenByUserId?: string;
  overriddenAt?: string;
}

export interface SettlementRecord {
  id: string;
  marketId: string;
  result: MarketResult;
  attestationSource: string;
  attestationId?: string;
  attestationData?: Record<string, unknown>;
  settledBy?: string;
  settledAt: string;
  totalSettlementPoints?: number;
  unit?: "PTS" | string;
}

export interface SettlementPointDisbursement {
  id: string;
  settlementId: string;
  positionId: string;
  userId: string;
  marketId?: string;
  side?: OrderSide;
  quantity?: number;
  entryPricePoints?: number;
  exitPricePoints?: number;
  settlementPoints?: number;
  realizedPoints?: number;
  paidAt?: string;
  unit?: "PTS" | string;
}

export interface SettleMarketResponse {
  settlement: SettlementRecord;
  pointDisbursements?: SettlementPointDisbursement[];
  totalSettlementPoints?: number;
  unit?: "PTS" | string;
  taptradeLifecycle?: TapTradeMarketLifecycle;
}

export interface SettlementReplayResponse {
  completedSettlements: number;
  summary: string;
}

// --- Admin: Dashboard ---

export interface DashboardMover {
  marketId: string;
  ticker: string;
  title: string;
  yesPricePointsStart: number;
  yesPricePointsNow: number;
  volumePoints: number;
  unit: "PTS" | string;
}

export interface DashboardVolumeStats {
  since: string;
  windowSeconds: number;
  totalVolumePoints: number;
  tradeCount: number;
  topMovers: DashboardMover[];
  unit: "PTS" | string;
}

// --- Market price history (charts) ---

export interface PricePoint {
  bucketStart: string;
  yesPricePoints: number;
  tradeCount: number;
  volumePoints: number;
  unit?: "PTS" | string;
}

export interface MarketPriceHistory {
  marketId: string;
  range: string;
  since: string;
  until: string;
  bucketSec: number;
  points: PricePoint[];
}
