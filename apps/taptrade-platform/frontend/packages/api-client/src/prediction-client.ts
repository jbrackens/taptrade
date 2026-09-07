/**
 * Tap Trade — Prediction Platform API Client
 * Extends the shared HTTP client with prediction-specific methods.
 */

import type {
  Category,
  PredictionEvent,
  PredictionMarket,
  PredictionOrder,
  Series,
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
  CreateEventRequest,
  MarketLifecycleAction,
  MarketLifecycleTransitionResponse,
  PredictionMarketLifecycleAuditResponse,
  MarketJurisdictionPolicy,
  SettleMarketRequest,
  SettleMarketResponse,
  SettlementPointDisbursement,
  SettlementReplayResponse,
  DashboardMover,
  DashboardVolumeStats,
  OrderBook,
  CollateralDriftAlert,
  DriftAlertsResponse,
  PricePoint,
  MarketPriceHistory,
  OrderBookLevel,
} from "./prediction-types";

type LegacySettlementPayout = SettlementPointDisbursement & {
  entryPricePoints?: number;
  exitPricePoints?: number;
  pnlPoints?: number;
  payoutPoints?: number;
};

type LegacySettleMarketResponse = SettleMarketResponse & {
  payouts?: LegacySettlementPayout[];
  settlement?: SettleMarketResponse["settlement"] & {
    totalPayoutPoints?: number;
  };
};

type LegacySettledPositionResult = Omit<
  SettledPositionResult,
  "entryPricePoints" | "exitPricePoints" | "realizedPoints" | "settlementPoints"
> & {
  entryPricePoints?: number;
  exitPricePoints?: number;
  pnlPoints?: number;
  payoutPoints?: number;
  realizedPoints?: number;
  settlementPoints?: number;
};

type LegacyOrderPreview = Partial<OrderPreview> & {
  side: OrderPreview["side"];
  action: OrderPreview["action"];
  quantity: number;
  pricePoints?: number;
  totalCostPoints?: number;
  feePoints?: number;
  maxProfitPoints?: number;
  maxLossPoints?: number;
  newYesPricePoints?: number;
  newNoPricePoints?: number;
  averageFillPricePoints?: number;
  totalCostWithFeesPoints?: number;
  estimatedSlippagePoints?: number;
};

type LegacyPredictionMarket = Omit<
  PredictionMarket,
  | "yesPricePoints"
  | "noPricePoints"
  | "lastTradePricePoints"
  | "volumePoints"
  | "openInterestPoints"
  | "liquidityPoints"
  | "ammSubsidyPoints"
  | "collateralPoolPoints"
  | "settlementPoolPoints"
  | "bestYesBidPoints"
  | "bestYesAskPoints"
  | "bestNoBidPoints"
  | "bestNoAskPoints"
> & {
  yesPricePoints?: number;
  noPricePoints?: number;
  lastTradePricePoints?: number;
  volumePoints?: number;
  openInterestPoints?: number;
  liquidityPoints?: number;
  ammSubsidyPoints?: number;
  collateralPoolPoints?: number;
  settlementPoolPoints?: number;
  settledPayoutPoolPoints?: number;
  bestYesBidPoints?: number;
  bestYesAskPoints?: number;
  bestNoBidPoints?: number;
  bestNoAskPoints?: number;
};

type LegacyDiscoveryResponse = Omit<
  DiscoveryResponse,
  "featured" | "trending" | "closingSoon" | "recent"
> & {
  featured?: LegacyPredictionMarket[];
  trending?: LegacyPredictionMarket[];
  closingSoon?: LegacyPredictionMarket[];
  recent?: LegacyPredictionMarket[];
};

type LegacyCollateralDriftAlert = Omit<
  CollateralDriftAlert,
  "maxDriftPoints" | "totalDriftPoints" | "unit"
> & {
  maxDriftPoints?: number;
  totalDriftPoints?: number;
  unit?: "PTS" | string;
};

type LegacyDriftAlertsResponse = Omit<DriftAlertsResponse, "data"> & {
  data: LegacyCollateralDriftAlert[];
};

type LegacyDashboardMover = Omit<
  DashboardMover,
  "yesPricePointsStart" | "yesPricePointsNow" | "volumePoints" | "unit"
> & {
  yesPricePointsStart?: number;
  yesPricePointsNow?: number;
  volumePoints?: number;
  unit?: "PTS" | string;
};

type LegacyDashboardVolumeStats = Omit<
  DashboardVolumeStats,
  "totalVolumePoints" | "topMovers" | "unit"
> & {
  totalVolumePoints?: number;
  topMovers: LegacyDashboardMover[];
  unit?: "PTS" | string;
};

type LegacyPricePoint = Omit<PricePoint, "yesPricePoints" | "volumePoints"> & {
  yesPricePoints?: number;
  volumePoints?: number;
};

type LegacyMarketPriceHistory = Omit<MarketPriceHistory, "points"> & {
  points: LegacyPricePoint[];
};

type LegacyOrderBookLevel = Omit<
  OrderBookLevel,
  | "pricePoints"
  | "shares"
  | "cumulativeShares"
  | "notionalPoints"
  | "totalNotionalPoints"
  | "unit"
> & {
  pricePoints?: number;
  shares?: number;
  cumulativeShares?: number;
  notionalPoints?: number;
  totalNotionalPoints?: number;
  unit?: "PTS" | string;
  quantity?: number;
  total?: number;
};

type LegacyOrderBookSide = {
  bids: LegacyOrderBookLevel[];
  asks: LegacyOrderBookLevel[];
};

type LegacyOrderBook = Omit<OrderBook, "yes" | "no"> & {
  yes: LegacyOrderBookSide;
  no: LegacyOrderBookSide;
};

type LegacyTrade = Omit<
  Trade,
  "pricePoints" | "feePoints" | "notionalPoints"
> & {
  pricePoints?: number;
  feePoints?: number;
  notionalPoints?: number;
};

export class PredictionApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  // refreshLock dedupes concurrent refresh attempts: a page firing several
  // prediction calls that all 401 must do ONE /refresh (the auth service
  // rotates the refresh-token cookie per call, so parallel refreshes race
  // and cascade-fail). Mirrors the app-level apiClient.refreshSession.
  private refreshLock: Promise<boolean> | null = null;

  private async refreshSession(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    if (this.refreshLock) return this.refreshLock;
    this.refreshLock = (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/api/v1/auth/refresh/`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...this.getCSRFHeaders(),
          },
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        // Clear in a macrotask so awaiting callers resolve with the result
        // before the lock reopens for the next 401.
        setTimeout(() => {
          this.refreshLock = null;
        }, 0);
      }
    })();
    return this.refreshLock;
  }

  private async request<T>(
    path: string,
    options?: RequestInit,
    retried = false,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...this.getCSRFHeaders(),
        ...(options?.headers || {}),
      },
      ...options,
    });

    // LC-37: a stale access token mid-action (place/preview/cancel order,
    // portfolio) previously surfaced as a raw "API error: 401" with the
    // action silently dropped — PredictionApiClient never refreshed, unlike
    // the app-level apiClient.fetchWithRetry. Refresh once and retry. This
    // is money-safe: the order path holds a stable idempotencyKey (LC-38)
    // across the retry, so a re-driven placeOrder is deduped by the gateway
    // and never double-executes.
    if (
      res.status === 401 &&
      !retried &&
      typeof window !== "undefined" &&
      (await this.refreshSession())
    ) {
      // Re-issue with rebuilt headers (CSRF cookie may have rotated; the
      // refreshed access_token rides the credentials:"include" cookie).
      return this.request<T>(path, options, true);
    }

    if (!res.ok) {
      const errorBody = await res
        .json()
        .catch(() => ({ error: res.statusText }));
      throw new Error(
        errorBody.error?.message ||
          errorBody.message ||
          `API error: ${res.status}`,
      );
    }

    return res.json();
  }

  private async requestText(
    path: string,
    options?: RequestInit,
    retried = false,
  ): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...this.getCSRFHeaders(),
        ...(options?.headers || {}),
      },
      ...options,
    });

    if (
      res.status === 401 &&
      !retried &&
      typeof window !== "undefined" &&
      (await this.refreshSession())
    ) {
      return this.requestText(path, options, true);
    }

    if (!res.ok) {
      const errorBody = await res
        .json()
        .catch(() => ({ error: res.statusText }));
      throw new Error(
        errorBody.error?.message ||
          errorBody.message ||
          `API error: ${res.status}`,
      );
    }

    return res.text();
  }

  private getCSRFHeaders(): Record<string, string> {
    if (typeof document === "undefined") return {};
    const match = document.cookie.match(/csrf_token=([^;]+)/);
    return match ? { "X-CSRF-Token": match[1] } : {};
  }

  // --- Discovery ---

  async getDiscovery(): Promise<DiscoveryResponse> {
    const response =
      await this.request<LegacyDiscoveryResponse>("/api/v1/discovery");
    return normalizeDiscoveryResponse(response);
  }

  // --- Categories ---

  async getCategories(): Promise<Category[]> {
    return this.request("/api/v1/categories");
  }

  async getCategory(slug: string): Promise<Category> {
    return this.request(`/api/v1/categories/${slug}`);
  }

  async getAdminCategories(): Promise<Category[]> {
    return this.request("/api/v1/admin/categories");
  }

  async createCategory(req: CreateCategoryRequest): Promise<Category> {
    return this.request("/api/v1/admin/categories", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  // --- Series and tags ---

  async getSeries(params?: { categoryId?: string }): Promise<Series[]> {
    const query = new URLSearchParams();
    if (params?.categoryId) query.set("categoryId", params.categoryId);
    const qs = query.toString();
    return this.request(`/api/v1/series${qs ? "?" + qs : ""}`);
  }

  async getTags(params?: { categoryId?: string }): Promise<string[]> {
    const query = new URLSearchParams();
    if (params?.categoryId) query.set("categoryId", params.categoryId);
    const qs = query.toString();
    const raw = await this.request<{ tags: string[] }>(
      `/api/v1/tags${qs ? "?" + qs : ""}`,
    );
    return raw.tags.filter((tag) => tag !== LAUNCH_REDACTED_TITLE);
  }

  async getAdminSeries(params?: { categoryId?: string }): Promise<Series[]> {
    const query = new URLSearchParams();
    if (params?.categoryId) query.set("categoryId", params.categoryId);
    const qs = query.toString();
    return this.request(`/api/v1/admin/series${qs ? "?" + qs : ""}`);
  }

  async createSeries(req: CreateSeriesRequest): Promise<Series> {
    return this.request("/api/v1/admin/series", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async getAdminTags(params?: { categoryId?: string }): Promise<string[]> {
    const query = new URLSearchParams();
    if (params?.categoryId) query.set("categoryId", params.categoryId);
    const qs = query.toString();
    const raw = await this.request<{ tags: string[] }>(
      `/api/v1/admin/tags${qs ? "?" + qs : ""}`,
    );
    return raw.tags;
  }

  // --- Events ---

  async getEvents(params?: {
    seriesId?: string;
    categoryId?: string;
    status?: string;
    featured?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<PredictionEvent>> {
    const query = new URLSearchParams();
    if (params?.seriesId) query.set("seriesId", params.seriesId);
    if (params?.categoryId) query.set("categoryId", params.categoryId);
    if (params?.status) query.set("status", params.status);
    if (params?.featured) query.set("featured", "true");
    if (params?.page) query.set("page", String(params.page));
    if (params?.pageSize) query.set("pageSize", String(params.pageSize));
    const qs = query.toString();
    return this.request(`/api/v1/events${qs ? "?" + qs : ""}`);
  }

  async getEvent(id: string): Promise<PredictionEvent> {
    return this.request(`/api/v1/events/${id}`);
  }

  // --- Markets ---

  async getMarkets(params?: {
    eventId?: string;
    seriesId?: string;
    categoryId?: string;
    status?: string;
    ticker?: string;
    /**
     * Batched id lookup: joined comma-separated into the gateway's `ids`
     * query param. The gateway caps this at 50 ids per request — chunk
     * larger sets client-side. Composes with the other filters and the
     * server-side unopened/launch-scrub gates like any list query.
     */
    ids?: string[];
    q?: string;
    tag?: string;
    sort?: "activity" | "closing_soon" | "newest";
    closeBefore?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<PredictionMarket>> {
    const query = new URLSearchParams();
    if (params?.eventId) query.set("eventId", params.eventId);
    if (params?.seriesId) query.set("seriesId", params.seriesId);
    if (params?.categoryId) query.set("categoryId", params.categoryId);
    if (params?.status) query.set("status", params.status);
    if (params?.ticker) query.set("ticker", params.ticker);
    if (params?.ids && params.ids.length > 0)
      query.set("ids", params.ids.join(","));
    if (params?.q) query.set("q", params.q);
    if (params?.tag) query.set("tag", params.tag);
    if (params?.sort) query.set("sort", params.sort);
    if (params?.closeBefore) query.set("closeBefore", params.closeBefore);
    if (params?.page) query.set("page", String(params.page));
    if (params?.pageSize) query.set("pageSize", String(params.pageSize));
    const qs = query.toString();
    const response = await this.request<
      PaginatedResponse<LegacyPredictionMarket>
    >(`/api/v1/markets${qs ? "?" + qs : ""}`);
    return {
      ...response,
      data: response.data
        .map(normalizePredictionMarket)
        .filter(isListableMarket),
    };
  }

  /**
   * Admin market list — includes pre-launch `unopened` drafts that the public
   * getMarkets() hides. The gateway only returns `unopened` markets to
   * admin-authenticated callers via this endpoint, so the backoffice uses it to
   * review and open AI-drafted / not-yet-published markets.
   */
  async getAdminMarkets(params?: {
    eventId?: string;
    categoryId?: string;
    status?: string;
    ticker?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<PredictionMarket>> {
    const query = new URLSearchParams();
    if (params?.eventId) query.set("eventId", params.eventId);
    if (params?.categoryId) query.set("categoryId", params.categoryId);
    if (params?.status) query.set("status", params.status);
    if (params?.ticker) query.set("ticker", params.ticker);
    if (params?.page) query.set("page", String(params.page));
    if (params?.pageSize) query.set("pageSize", String(params.pageSize));
    const qs = query.toString();
    const response = await this.request<
      PaginatedResponse<LegacyPredictionMarket>
    >(`/api/v1/admin/markets${qs ? "?" + qs : ""}`);
    return {
      ...response,
      data: response.data.map(normalizePredictionMarket),
    };
  }

  async exportAdminMarkets(params?: {
    eventId?: string;
    categoryId?: string;
    status?: string;
    ticker?: string;
    page?: number;
    pageSize?: number;
  }): Promise<string> {
    const query = new URLSearchParams();
    query.set("format", "csv");
    if (params?.eventId) query.set("eventId", params.eventId);
    if (params?.categoryId) query.set("categoryId", params.categoryId);
    if (params?.status) query.set("status", params.status);
    if (params?.ticker) query.set("ticker", params.ticker);
    if (params?.page) query.set("page", String(params.page));
    if (params?.pageSize) query.set("pageSize", String(params.pageSize));
    return this.requestText(`/api/v1/admin/markets?${query.toString()}`);
  }

  async getMarket(tickerOrId: string): Promise<PredictionMarket> {
    const market = await this.request<LegacyPredictionMarket>(
      `/api/v1/markets/${tickerOrId}`,
    );
    return normalizePredictionMarket(market);
  }

  async getMarketTrades(marketId: string, limit = 50): Promise<Trade[]> {
    // Server caps limit at 200; values above are clamped server-side.
    const trades = await this.request<LegacyTrade[]>(
      `/api/v1/markets/${marketId}/trades?limit=${limit}`,
    );
    return trades.map(normalizeTrade);
  }

  /**
   * Fetch the L2 order book for a market. Only meaningful for markets with
   * `executionMode === "order_book"`; AMM markets return an empty book.
   *
   * `depth` is the number of price levels per side (yes bids, yes asks, no
   * bids, no asks). Server clamps to [1, 100]; default 20 is good for the
   * compact ladder shown in the trade ticket. Use 50–100 for the full book
   * panel on the market detail page.
   */
  async getOrderBook(marketIdOrTicker: string, depth = 20): Promise<OrderBook> {
    const book = await this.request<LegacyOrderBook>(
      `/api/v1/markets/${marketIdOrTicker}/orderbook?depth=${depth}`,
    );
    return normalizeOrderBook(book);
  }

  /**
   * Fetch the volume-weighted YES price-history series for a market.
   * Returns equally-spaced buckets across the requested window with
   * carry-forward applied to empty buckets — chart consumers can plot
   * the `points` array directly.
   *
   * Ranges: "1h" | "1d" | "1w" | "1m" | "all". Default ("1d") matches
   * the prior synthetic hero-chart shape (24 hourly points).
   */
  async getMarketPriceHistory(
    marketIdOrTicker: string,
    range: "1h" | "1d" | "1w" | "1m" | "all" = "1d",
  ): Promise<MarketPriceHistory> {
    const history = await this.request<LegacyMarketPriceHistory>(
      `/api/v1/markets/${marketIdOrTicker}/prices?range=${range}`,
    );
    return normalizeMarketPriceHistory(history);
  }

  // --- Trading ---

  async previewOrder(req: PlaceOrderRequest): Promise<OrderPreview> {
    const response = await this.request<LegacyOrderPreview>(
      "/api/v1/orders/preview",
      {
        method: "POST",
        body: JSON.stringify(req),
      },
    );
    return normalizeOrderPreview(response);
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    // Points unit-model (2026-07-07): one wire format — the gateway emits
    // canonical *Points keys; no legacy-order normalization remains.
    return await this.request<PlaceOrderResponse>("/api/v1/orders", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request(`/api/v1/orders/${orderId}/cancel`, {
      method: "POST",
    });
  }

  async getOrders(params?: {
    marketId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<PredictionOrder>> {
    const query = new URLSearchParams();
    if (params?.marketId) query.set("marketId", params.marketId);
    if (params?.status) query.set("status", params.status);
    if (params?.page) query.set("page", String(params.page));
    if (params?.pageSize) query.set("pageSize", String(params.pageSize));
    const qs = query.toString();
    const page = await this.request<PaginatedResponse<LegacyPredictionOrder>>(
      `/api/v1/orders${qs ? "?" + qs : ""}`,
    );
    return {
      ...page,
      data: page.data.map(normalizePredictionOrder),
    };
  }

  // --- Portfolio ---

  async getPositions(): Promise<Position[]> {
    const positions = await this.request<LegacyPosition[]>("/api/v1/portfolio");
    return positions.map(normalizePosition);
  }

  async getPortfolioSummary(): Promise<PortfolioSummary> {
    return normalizePortfolioSummary(
      await this.request<LegacyPortfolioSummary>("/api/v1/portfolio/summary"),
    );
  }

  async getSettledPositions(
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedResponse<SettledPositionResult>> {
    const response = await this.request<
      PaginatedResponse<SettledPositionResult>
    >(`/api/v1/portfolio/history?page=${page}&pageSize=${pageSize}`);
    return {
      ...response,
      data: response.data.map(normalizeSettledPositionResult),
    };
  }

  // --- Admin: Markets ---

  async createMarket(req: CreateMarketRequest): Promise<PredictionMarket> {
    const market = await this.request<LegacyPredictionMarket>(
      "/api/v1/admin/markets",
      {
        method: "POST",
        body: JSON.stringify(req),
      },
    );
    return normalizePredictionMarket(market);
  }

  async updateMarket(
    marketId: string,
    req: CreateMarketRequest,
  ): Promise<PredictionMarket> {
    const market = await this.request<LegacyPredictionMarket>(
      `/api/v1/admin/markets/${marketId}`,
      {
        method: "PUT",
        body: JSON.stringify(req),
      },
    );
    return normalizePredictionMarket(market);
  }

  async createEvent(req: CreateEventRequest): Promise<PredictionEvent> {
    return this.request("/api/v1/admin/events", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async transitionMarketLifecycle(
    marketId: string,
    action: MarketLifecycleAction,
    reason?: string,
  ): Promise<MarketLifecycleTransitionResponse> {
    return this.request(
      `/api/v1/admin/markets/${marketId}/lifecycle/${action}`,
      {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      },
    );
  }

  async getMarketLifecycleAudit(
    marketId: string,
  ): Promise<PredictionMarketLifecycleAuditResponse> {
    return this.request(`/api/v1/admin/markets/${marketId}/lifecycle`);
  }

  async exportMarketLifecycleAudit(marketId: string): Promise<string> {
    return this.requestText(
      `/api/v1/admin/markets/${marketId}/lifecycle?format=csv`,
    );
  }

  // Per-market jurisdiction overlay (P3-07). GET reads the current policy
  // (policy: null = no overlay); POST sets it, or clears it when passed null
  // (an empty body, which the gateway treats as "clear").
  async getMarketJurisdiction(
    marketId: string,
  ): Promise<{ marketId: string; policy: MarketJurisdictionPolicy | null }> {
    return this.request(`/api/v1/admin/markets/${marketId}/jurisdiction`);
  }

  async setMarketJurisdiction(
    marketId: string,
    policy: MarketJurisdictionPolicy | null,
  ): Promise<{ marketId: string; policy: MarketJurisdictionPolicy | null }> {
    return this.request(`/api/v1/admin/markets/${marketId}/jurisdiction`, {
      method: "POST",
      body: JSON.stringify(policy ?? {}),
    });
  }

  async settleMarket(
    marketId: string,
    req: SettleMarketRequest,
  ): Promise<SettleMarketResponse> {
    const response = await this.request<SettleMarketResponse>(
      `/api/v1/admin/settlements/${marketId}`,
      {
        method: "POST",
        body: JSON.stringify(req),
      },
    );
    return normalizeSettleMarketResponse(response);
  }

  async replayIncompleteSettlements(): Promise<SettlementReplayResponse> {
    return this.request("/api/v1/admin/settlements/replay", {
      method: "POST",
    });
  }

  // --- Admin: Dashboard ---

  // since: Go duration ("24h", "7d") — gateway capped at 30 days.
  async getDashboardVolume(
    since = "24h",
    topMovers = 5,
  ): Promise<DashboardVolumeStats> {
    const response = await this.request<LegacyDashboardVolumeStats>(
      `/api/v1/admin/dashboard/volume?since=${encodeURIComponent(since)}&topN=${topMovers}`,
    );
    return normalizeDashboardVolumeStats(response);
  }

  /**
   * Recent collateral drift alerts. One row per market with `adjustment`
   * ledger entries since the lookback window (Go duration string, e.g.
   * "24h", "7d"). Empty `data` when nothing tripped. Gateway caps at 30d.
   */
  async getDriftAlerts(since = "24h"): Promise<DriftAlertsResponse> {
    const response = await this.request<LegacyDriftAlertsResponse>(
      `/api/v1/admin/prediction/drift-alerts?since=${encodeURIComponent(since)}`,
    );
    return {
      ...response,
      data: response.data.map(normalizeCollateralDriftAlert),
    };
  }
}

function normalizeCollateralDriftAlert(
  row: LegacyCollateralDriftAlert,
): CollateralDriftAlert {
  const maxDriftPoints =
    typeof row.maxDriftPoints === "number"
      ? row.maxDriftPoints
      : (row.maxDriftPoints ?? 0);
  const totalDriftPoints =
    typeof row.totalDriftPoints === "number"
      ? row.totalDriftPoints
      : (row.totalDriftPoints ?? 0);

  return {
    marketId: row.marketId,
    ticker: row.ticker,
    adjustmentCount: row.adjustmentCount,
    maxDriftPoints,
    totalDriftPoints,
    latestAdjustedAt: row.latestAdjustedAt,
    latestReason: row.latestReason,
    unit: row.unit || "PTS",
  };
}

function normalizeSettledPositionResult(
  row: SettledPositionResult | LegacySettledPositionResult,
): SettledPositionResult {
  const legacyRow = row as LegacySettledPositionResult;
  const realizedPoints =
    typeof row.realizedPoints === "number"
      ? row.realizedPoints
      : (legacyRow.pnlPoints ?? 0);
  const settlementPoints =
    typeof row.settlementPoints === "number"
      ? row.settlementPoints
      : (legacyRow.payoutPoints ?? 0);
  return {
    id: row.id,
    settlementId: row.settlementId,
    positionId: row.positionId,
    userId: row.userId,
    marketId: row.marketId,
    side: row.side,
    quantity: row.quantity,
    entryPricePoints: row.entryPricePoints ?? legacyRow.entryPricePoints ?? 0,
    exitPricePoints: row.exitPricePoints ?? legacyRow.exitPricePoints ?? 0,
    realizedPoints,
    settlementPoints,
    paidAt: row.paidAt,
    unit: row.unit || "PTS",
  };
}

/**
 * Launch-safety scrub sentinel — mirrors launchRedactedComplianceText in the
 * gateway (internal/compliance/launch_safety.go). Markets whose titles were
 * redacted carry no usable content; public discovery UIs must not render the
 * sentinel as a market question or tag, so list surfaces drop them here.
 */
export const LAUNCH_REDACTED_TITLE = "Removed by points-only safety boundary.";

function isListableMarket(market: { title?: string }): boolean {
  return (market.title || "").trim() !== LAUNCH_REDACTED_TITLE;
}

function normalizeDiscoveryResponse(
  response: LegacyDiscoveryResponse,
): DiscoveryResponse {
  const normalizeMarketBucket = (
    rows: LegacyPredictionMarket[] | undefined,
  ): PredictionMarket[] =>
    Array.isArray(rows)
      ? rows.map(normalizePredictionMarket).filter(isListableMarket)
      : [];
  const normalized: Record<string, unknown> = { ...response };

  if (Array.isArray(response.featured)) {
    normalized.featured = normalizeMarketBucket(response.featured);
  }
  if (Array.isArray(response.trending)) {
    normalized.trending = normalizeMarketBucket(response.trending);
  }
  if (Array.isArray(response.closingSoon)) {
    normalized.closingSoon = normalizeMarketBucket(response.closingSoon);
  }
  if (Array.isArray(response.recent)) {
    normalized.recent = normalizeMarketBucket(response.recent);
  }
  return normalized as unknown as DiscoveryResponse;
}

function normalizePredictionMarket(
  row: LegacyPredictionMarket,
): PredictionMarket {
  const yesPricePoints =
    typeof row.yesPricePoints === "number"
      ? row.yesPricePoints
      : (row.yesPricePoints ?? 0);
  const noPricePoints =
    typeof row.noPricePoints === "number"
      ? row.noPricePoints
      : (row.noPricePoints ?? 0);
  const lastTradePricePoints =
    typeof row.lastTradePricePoints === "number"
      ? row.lastTradePricePoints
      : row.lastTradePricePoints;
  const volumePoints =
    typeof row.volumePoints === "number"
      ? row.volumePoints
      : (row.volumePoints ?? 0);
  const openInterestPoints =
    typeof row.openInterestPoints === "number"
      ? row.openInterestPoints
      : (row.openInterestPoints ?? 0);
  const liquidityPoints =
    typeof row.liquidityPoints === "number"
      ? row.liquidityPoints
      : (row.liquidityPoints ?? 0);
  const ammSubsidyPoints =
    typeof row.ammSubsidyPoints === "number"
      ? row.ammSubsidyPoints
      : row.ammSubsidyPoints;
  const collateralPoolPoints =
    typeof row.collateralPoolPoints === "number"
      ? row.collateralPoolPoints
      : row.collateralPoolPoints;
  const settlementPoolPoints =
    typeof row.settlementPoolPoints === "number"
      ? row.settlementPoolPoints
      : (row.settledPayoutPoolPoints ?? row.settledPayoutPoolPoints);
  const bestYesBidPoints =
    typeof row.bestYesBidPoints === "number"
      ? row.bestYesBidPoints
      : row.bestYesBidPoints;
  const bestYesAskPoints =
    typeof row.bestYesAskPoints === "number"
      ? row.bestYesAskPoints
      : row.bestYesAskPoints;
  const bestNoBidPoints =
    typeof row.bestNoBidPoints === "number"
      ? row.bestNoBidPoints
      : row.bestNoBidPoints;
  const bestNoAskPoints =
    typeof row.bestNoAskPoints === "number"
      ? row.bestNoAskPoints
      : row.bestNoAskPoints;

  return {
    id: row.id,
    eventId: row.eventId,
    eventTitle: row.eventTitle,
    categoryId: row.categoryId,
    categorySlug: row.categorySlug,
    categoryName: row.categoryName,
    ticker: row.ticker,
    title: row.title,
    description: row.description,
    translations: row.translations,
    status: row.status,
    result: row.result,
    yesPricePoints,
    noPricePoints,
    lastTradePricePoints,
    volumePoints,
    openInterestPoints,
    liquidityPoints,
    settlementSourceKey: row.settlementSourceKey,
    settlementRule: row.settlementRule,
    settlementParams: row.settlementParams,
    feeRateBps: row.feeRateBps,
    closeAt: row.closeAt,
    createdAt: row.createdAt,
    imagePath: row.imagePath,
    imageUrl: row.imageUrl,
    image_url: row.image_url,
    executionMode: row.executionMode,
    ammYesShares: row.ammYesShares,
    ammNoShares: row.ammNoShares,
    ammLiquidityParam: row.ammLiquidityParam,
    ammSubsidyPoints,
    collateralPoolPoints,
    settlementPoolPoints,
    bestYesBidPoints,
    bestYesAskPoints,
    bestNoBidPoints,
    bestNoAskPoints,
    lastQuoteAt: row.lastQuoteAt,
    // §3-09: present only on user-facing list responses; absent means
    // "unknown", never zero. This normalizer is a WHITELIST — like the
    // gateway's MarshalJSON, new wire fields must be added HERE too.
    commentCount:
      typeof row.commentCount === "number" ? row.commentCount : undefined,
    unit: row.unit || "PTS",
  };
}

function normalizeMarketPriceHistory(
  history: LegacyMarketPriceHistory,
): MarketPriceHistory {
  return {
    ...history,
    points: history.points.map(normalizePricePoint),
  };
}

function normalizeDashboardVolumeStats(
  row: LegacyDashboardVolumeStats,
): DashboardVolumeStats {
  const totalVolumePoints =
    typeof row.totalVolumePoints === "number"
      ? row.totalVolumePoints
      : (row.totalVolumePoints ?? 0);

  return {
    since: row.since,
    windowSeconds: row.windowSeconds,
    totalVolumePoints,
    tradeCount: row.tradeCount,
    topMovers: row.topMovers.map(normalizeDashboardMover),
    unit: row.unit || "PTS",
  };
}

function normalizeDashboardMover(row: LegacyDashboardMover): DashboardMover {
  const yesPricePointsStart =
    typeof row.yesPricePointsStart === "number"
      ? row.yesPricePointsStart
      : (row.yesPricePointsStart ?? 0);
  const yesPricePointsNow =
    typeof row.yesPricePointsNow === "number"
      ? row.yesPricePointsNow
      : (row.yesPricePointsNow ?? 0);
  const volumePoints =
    typeof row.volumePoints === "number"
      ? row.volumePoints
      : (row.volumePoints ?? 0);

  return {
    marketId: row.marketId,
    ticker: row.ticker,
    title: row.title,
    yesPricePointsStart,
    yesPricePointsNow,
    volumePoints,
    unit: row.unit || "PTS",
  };
}

function normalizeOrderBook(book: LegacyOrderBook): OrderBook {
  return {
    ...book,
    yes: normalizeOrderBookSide(book.yes),
    no: normalizeOrderBookSide(book.no),
  };
}

function normalizeOrderBookSide(side: LegacyOrderBookSide): OrderBook["yes"] {
  return {
    bids: side.bids.map(normalizeOrderBookLevel),
    asks: side.asks.map(normalizeOrderBookLevel),
  };
}

function normalizeOrderBookLevel(row: LegacyOrderBookLevel): OrderBookLevel {
  const pricePoints =
    typeof row.pricePoints === "number"
      ? row.pricePoints
      : (row.pricePoints ?? 0);
  const shares =
    typeof row.shares === "number" ? row.shares : (row.quantity ?? 0);
  const cumulativeShares =
    typeof row.cumulativeShares === "number"
      ? row.cumulativeShares
      : (row.total ?? 0);
  const notionalPoints =
    typeof row.notionalPoints === "number"
      ? row.notionalPoints
      : pricePoints * shares;
  const totalNotionalPoints =
    typeof row.totalNotionalPoints === "number"
      ? row.totalNotionalPoints
      : pricePoints * cumulativeShares;
  return {
    pricePoints,
    shares,
    cumulativeShares,
    notionalPoints,
    totalNotionalPoints,
    unit: row.unit || "PTS",
  };
}

function normalizePricePoint(row: LegacyPricePoint): PricePoint {
  const yesPricePoints =
    typeof row.yesPricePoints === "number"
      ? row.yesPricePoints
      : (row.yesPricePoints ?? 0);
  const volumePoints =
    typeof row.volumePoints === "number"
      ? row.volumePoints
      : (row.volumePoints ?? 0);
  return {
    bucketStart: row.bucketStart,
    yesPricePoints,
    tradeCount: row.tradeCount,
    volumePoints,
    unit: row.unit || "PTS",
  };
}

type LegacyPortfolioSummary = Partial<PortfolioSummary> & {
  totalValuePoints?: number;
  unrealizedPnlPoints?: number;
  realizedPnlPoints?: number;
};

type LegacyPosition = Partial<Position> & {
  avgPricePoints?: number;
  totalCostPoints?: number;
  realizedPnlPoints?: number;
};

type LegacyPredictionOrder = Partial<PredictionOrder> & {
  pricePoints?: number;
  averageFillPricePoints?: number;
  totalCostPoints?: number;
  filledCostPoints?: number;
  notionalCapPoints?: number;
  reservedCashPoints?: number;
  capturedCashPoints?: number;
  releasedCashPoints?: number;
};

function normalizePortfolioSummary(
  row: LegacyPortfolioSummary,
): PortfolioSummary {
  const totalValuePoints =
    typeof row.totalValuePoints === "number"
      ? row.totalValuePoints
      : typeof row.portfolioValuePoints === "number"
        ? row.portfolioValuePoints
        : (row.totalValuePoints ?? 0);
  const unrealizedPoints =
    typeof row.unrealizedPoints === "number"
      ? row.unrealizedPoints
      : (row.unrealizedPnlPoints ?? 0);
  const realizedPoints =
    typeof row.realizedPoints === "number"
      ? row.realizedPoints
      : (row.realizedPnlPoints ?? 0);

  return {
    totalValuePoints,
    portfolioValuePoints:
      typeof row.portfolioValuePoints === "number"
        ? row.portfolioValuePoints
        : totalValuePoints,
    investedPoints:
      typeof row.investedPoints === "number"
        ? row.investedPoints
        : totalValuePoints,
    unrealizedPoints,
    realizedPoints,
    openPositions: row.openPositions ?? 0,
    totalPredictions: row.totalPredictions ?? 0,
    correctPredictions: row.correctPredictions ?? 0,
    accuracyPct: row.accuracyPct ?? 0,
    unit: row.unit || "PTS",
  };
}

function normalizeOrderPreview(row: LegacyOrderPreview): OrderPreview {
  const pricePoints =
    typeof row.pricePoints === "number"
      ? row.pricePoints
      : (row.pricePoints ?? 0);
  const totalCostPoints =
    typeof row.totalCostPoints === "number"
      ? row.totalCostPoints
      : (row.totalCostPoints ?? 0);
  const feePoints =
    typeof row.feePoints === "number" ? row.feePoints : (row.feePoints ?? 0);
  const maxResultPoints =
    typeof row.maxResultPoints === "number"
      ? row.maxResultPoints
      : typeof row.maxProfitPoints === "number"
        ? row.maxProfitPoints
        : (row.maxProfitPoints ?? 0);
  const maxLossPoints =
    typeof row.maxLossPoints === "number"
      ? row.maxLossPoints
      : (row.maxLossPoints ?? 0);
  const newYesPricePoints =
    typeof row.newYesPricePoints === "number"
      ? row.newYesPricePoints
      : (row.newYesPricePoints ?? 0);
  const newNoPricePoints =
    typeof row.newNoPricePoints === "number"
      ? row.newNoPricePoints
      : (row.newNoPricePoints ?? 0);
  const averageFillPricePoints =
    typeof row.averageFillPricePoints === "number"
      ? row.averageFillPricePoints
      : row.averageFillPricePoints;
  const totalCostWithFeesPoints =
    typeof row.totalCostWithFeesPoints === "number"
      ? row.totalCostWithFeesPoints
      : row.totalCostWithFeesPoints;
  const estimatedSlippagePoints =
    typeof row.estimatedSlippagePoints === "number"
      ? row.estimatedSlippagePoints
      : row.estimatedSlippagePoints;

  return {
    side: row.side,
    action: row.action,
    quantity: row.quantity,
    pricePoints,
    totalCostPoints,
    feePoints,
    maxResultPoints,
    maxLossPoints,
    newYesPricePoints,
    newNoPricePoints,
    executionMode: row.executionMode,
    filledQuantity: row.filledQuantity,
    unfilledQuantity: row.unfilledQuantity,
    averageFillPricePoints,
    totalCostWithFeesPoints,
    estimatedSlippagePoints,
    quoteStatus: row.quoteStatus,
    quoteStaleAfterMillis: row.quoteStaleAfterMillis,
    quoteGeneratedAtUnixSec: row.quoteGeneratedAtUnixSec,
    unit: row.unit || "PTS",
  };
}

function normalizeTrade(row: LegacyTrade): Trade {
  const pricePoints =
    typeof row.pricePoints === "number"
      ? row.pricePoints
      : (row.pricePoints ?? 0);
  const feePoints =
    typeof row.feePoints === "number" ? row.feePoints : (row.feePoints ?? 0);
  const notionalPoints =
    typeof row.notionalPoints === "number"
      ? row.notionalPoints
      : pricePoints * row.quantity;

  return {
    id: row.id,
    marketId: row.marketId,
    buyerId: row.buyerId,
    sellerId: row.sellerId,
    buyOrderId: row.buyOrderId,
    sellOrderId: row.sellOrderId,
    side: row.side,
    pricePoints,
    quantity: row.quantity,
    feePoints,
    notionalPoints,
    isAmmTrade: row.isAmmTrade,
    tradedAt: row.tradedAt,
    unit: row.unit || "PTS",
    matchId: row.matchId,
    tradeKind: row.tradeKind,
    engineKind: row.engineKind,
  };
}

function normalizePredictionOrder(row: LegacyPredictionOrder): PredictionOrder {
  const totalCostPoints =
    typeof row.totalCostPoints === "number"
      ? row.totalCostPoints
      : (row.totalCostPoints ?? 0);
  const reservedPoints =
    typeof row.reservedPoints === "number"
      ? row.reservedPoints
      : row.reservedCashPoints;
  const capturedPoints =
    typeof row.capturedPoints === "number"
      ? row.capturedPoints
      : row.capturedCashPoints;
  const releasedPoints =
    typeof row.releasedPoints === "number"
      ? row.releasedPoints
      : row.releasedCashPoints;
  const filledCostPoints =
    typeof row.filledCostPoints === "number"
      ? row.filledCostPoints
      : row.filledCostPoints;
  const notionalCapPoints =
    typeof row.notionalCapPoints === "number"
      ? row.notionalCapPoints
      : row.notionalCapPoints;
  const pricePoints =
    typeof row.pricePoints === "number" ? row.pricePoints : row.pricePoints;
  const averageFillPricePoints =
    typeof row.averageFillPricePoints === "number"
      ? row.averageFillPricePoints
      : row.averageFillPricePoints;

  return {
    id: row.id ?? "",
    userId: row.userId ?? "",
    marketId: row.marketId ?? "",
    side: row.side ?? "yes",
    action: row.action ?? "buy",
    orderType: row.orderType ?? "limit",
    pricePoints,
    quantity: row.quantity ?? 0,
    filledQuantity: row.filledQuantity ?? 0,
    remainingQuantity: row.remainingQuantity ?? 0,
    totalCostPoints,
    status: row.status ?? "pending",
    filledAt: row.filledAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt ?? "",
    timeInForce: row.timeInForce,
    reservedPoints,
    capturedPoints,
    releasedPoints,
    reservedQuantity: row.reservedQuantity,
    averageFillPricePoints,
    filledCostPoints,
    failureReason: row.failureReason,
    postOnly: row.postOnly,
    clientOrderId: row.clientOrderId,
    selfMatchAction: row.selfMatchAction,
    notionalCapPoints,
    unit: row.unit || "PTS",
  };
}

function normalizePosition(row: LegacyPosition): Position {
  const totalCostPoints =
    typeof row.totalCostPoints === "number"
      ? row.totalCostPoints
      : (row.totalCostPoints ?? 0);
  const realizedPoints =
    typeof row.realizedPoints === "number"
      ? row.realizedPoints
      : (row.realizedPnlPoints ?? 0);

  return {
    id: row.id ?? "",
    userId: row.userId ?? "",
    marketId: row.marketId ?? "",
    side: row.side ?? "yes",
    quantity: row.quantity ?? 0,
    avgPricePoints:
      typeof row.avgPricePoints === "number"
        ? row.avgPricePoints
        : (row.avgPricePoints ?? 0),
    totalCostPoints,
    realizedPoints,
    reservedQuantity: row.reservedQuantity,
    unit: row.unit || "PTS",
  };
}

function normalizeSettleMarketResponse(
  response: SettleMarketResponse,
): SettleMarketResponse {
  const legacyResponse = response as LegacySettleMarketResponse;
  const pointDisbursements = (
    response.pointDisbursements ||
    legacyResponse.payouts ||
    []
  ).map(normalizeSettlementPointDisbursement);
  const totalSettlementPoints =
    typeof response.totalSettlementPoints === "number"
      ? response.totalSettlementPoints
      : pointDisbursements.reduce(
          (sum, payout) => sum + (payout.settlementPoints || 0),
          0,
        );
  return {
    ...response,
    settlement: {
      ...response.settlement,
      totalSettlementPoints:
        typeof response.settlement?.totalSettlementPoints === "number"
          ? response.settlement.totalSettlementPoints
          : legacyResponse.settlement?.totalPayoutPoints,
      unit: response.settlement?.unit || "PTS",
    },
    pointDisbursements,
    totalSettlementPoints,
    unit: response.unit || "PTS",
  };
}

function normalizeSettlementPointDisbursement(
  row: SettlementPointDisbursement | LegacySettlementPayout,
): SettlementPointDisbursement {
  const settlementPoints =
    typeof row.settlementPoints === "number"
      ? row.settlementPoints
      : (row as LegacySettlementPayout).payoutPoints;
  const realizedPoints =
    typeof row.realizedPoints === "number"
      ? row.realizedPoints
      : (row as LegacySettlementPayout).pnlPoints;
  return {
    id: row.id,
    settlementId: row.settlementId,
    positionId: row.positionId,
    userId: row.userId,
    marketId: row.marketId,
    side: row.side,
    quantity: row.quantity,
    entryPricePoints:
      row.entryPricePoints ??
      (row as LegacySettlementPayout).entryPricePoints ??
      0,
    exitPricePoints:
      row.exitPricePoints ??
      (row as LegacySettlementPayout).exitPricePoints ??
      0,
    settlementPoints,
    realizedPoints,
    paidAt: row.paidAt,
    unit: row.unit || "PTS",
  };
}

/**
 * Create a PredictionApiClient with a context-appropriate base URL.
 *
 * Resolution:
 *   1. Explicit `baseUrl` argument (highest priority — caller knows best).
 *   2. Browser context: prefer NEXT_DATA runtime config, then
 *      NEXT_PUBLIC_API_URL, then **same-origin (empty string)**. Same-origin
 *      means fetches go through the Next.js rewrite proxy at /api/v1/*,
 *      which avoids CORS entirely and works on whatever port Next is
 *      serving from (3000, 3010, ephemeral preview ports, etc.).
 *   3. SSR / Node context: env var or localhost fallback (no proxy on the
 *      server side, so we need an absolute URL).
 *
 * Why this matters: the previous implementation used `||` which treats
 * empty string as "fall through to the hardcoded localhost." That meant
 * `NEXT_PUBLIC_API_URL=""` (the natural way to opt into same-origin
 * proxy mode) silently became `http://localhost:18080` on the client and
 * broke under CORS as soon as the dev server moved off port 3000.
 */
interface NextDataRuntimeConfig {
  __NEXT_DATA__?: {
    runtimeConfig?: {
      apiUrl?: string;
    };
  };
}

export function createPredictionClient(baseUrl?: string): PredictionApiClient {
  if (baseUrl !== undefined) return new PredictionApiClient(baseUrl);

  if (typeof window !== "undefined") {
    const w = window as unknown as NextDataRuntimeConfig;
    const runtimeUrl = w.__NEXT_DATA__?.runtimeConfig?.apiUrl;
    if (runtimeUrl) return new PredictionApiClient(runtimeUrl);
    // Truthy NEXT_PUBLIC_API_URL wins; empty string or undefined → same-origin.
    if (process.env.NEXT_PUBLIC_API_URL) {
      return new PredictionApiClient(process.env.NEXT_PUBLIC_API_URL);
    }
    return new PredictionApiClient("");
  }

  // SSR: no proxy, need an absolute URL.
  return new PredictionApiClient(
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:18080",
  );
}
