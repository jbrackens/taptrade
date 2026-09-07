/**
 * Tap Trade API Client
 * Type-safe API client with automatic auth token management and 401 refresh
 */

import { AuthManager, createAuthManager } from "./auth";
import {
  ApiClientConfig,
  ApiError,
  TokenResponse,
  SessionResponse,
  ErrorResponse,
  LoginRequest,
  RefreshRequest,
  WalletBalance,
  WalletLedgerEntry,
  WalletMutationResponse,
  WalletMutationRequest,
  AuditLogEntry,
  PaginationOptions,
} from "./types";

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY = 100;
const POINT_UNIT = "PTS";

interface LegacyWalletBalancePayload extends Partial<WalletBalance> {
  balancePoints?: number;
  availablePoints?: number;
  reservedPoints?: number;
}

interface LegacyWalletLedgerEntryPayload extends Partial<WalletLedgerEntry> {
  amountPoints?: number;
  balancePoints?: number;
}

interface LegacyWalletMutationPayload {
  entry?: LegacyWalletLedgerEntryPayload;
  balancePoints?: number;
  unit?: string;
}

interface LegacyAuditLogEntryPayload extends Partial<AuditLogEntry> {
  freebetId?: string;
  oddsBoostId?: string;
  freebetAppliedPoints?: number;
}

export class TapTradeApiClient {
  private baseUrl: string;
  private timeout: number;
  private retryAttempts: number;
  private retryDelay: number;
  private authManager: AuthManager;
  private refreshInProgress: Promise<boolean> | null = null;

  constructor(config: ApiClientConfig, authManager?: AuthManager) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.retryAttempts = config.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
    this.retryDelay = config.retryDelay ?? DEFAULT_RETRY_DELAY;
    this.authManager = authManager ?? createAuthManager();
  }

  /**
   * Set auth manager instance
   */
  setAuthManager(authManager: AuthManager): void {
    this.authManager = authManager;
  }

  /**
   * Get auth manager instance
   */
  getAuthManager(): AuthManager {
    return this.authManager;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.authManager.isAuthenticated();
  }

  /**
   * Clear all auth tokens
   */
  logout(): void {
    this.authManager.clearTokens();
  }

  // ===== Auth Endpoints =====

  /**
   * Login with username and password
   */
  async login(request: LoginRequest): Promise<TokenResponse> {
    const response = await this.post<TokenResponse>(
      "/api/v1/auth/login",
      request,
    );
    // Store tokens if refreshToken is returned
    if (response.accessToken) {
      this.authManager.setTokens(
        response.accessToken,
        response.refreshToken,
        response.expiresInSeconds,
      );
    }
    return response;
  }

  /**
   * Refresh access token using refresh token
   */
  async refresh(request: RefreshRequest): Promise<TokenResponse> {
    const response = await this.post<TokenResponse>(
      "/api/v1/auth/refresh",
      request,
    );
    if (response.accessToken) {
      this.authManager.setTokens(
        response.accessToken,
        response.refreshToken,
        response.expiresInSeconds,
      );
    }
    return response;
  }

  /**
   * Get current session info (requires auth)
   */
  async getSession(): Promise<SessionResponse> {
    return this.get<SessionResponse>("/api/v1/auth/session");
  }

  // ===== Wallet =====

  /**
   * Get wallet balance
   */
  async getWalletBalance(userId: string): Promise<WalletBalance> {
    const payload = await this.get<LegacyWalletBalancePayload>(
      `/api/v1/wallet/${userId}`,
    );
    return this.normalizeWalletBalance(payload, userId);
  }

  /**
   * Get wallet ledger
   */
  async getWalletLedger(
    userId: string,
    limit?: number,
  ): Promise<{ userId: string; items: WalletLedgerEntry[]; total: number }> {
    const params = new URLSearchParams();
    if (limit) params.append("limit", limit.toString());
    const payload = await this.get<{
      userId: string;
      items: LegacyWalletLedgerEntryPayload[];
      total: number;
    }>(`/api/v1/wallet/${userId}/ledger`, params);
    return {
      userId: payload.userId,
      items: payload.items.map((item) =>
        this.normalizeWalletLedgerEntry(item, userId),
      ),
      total: payload.total,
    };
  }

  /**
   * Credit wallet
   */
  async creditWallet(
    request: WalletMutationRequest,
  ): Promise<WalletMutationResponse> {
    const payload = await this.post<LegacyWalletMutationPayload>(
      "/api/v1/wallet/credit",
      request,
    );
    return this.normalizeWalletMutation(payload, request.userId);
  }

  /**
   * Debit wallet
   */
  async debitWallet(
    request: WalletMutationRequest,
  ): Promise<WalletMutationResponse> {
    const payload = await this.post<LegacyWalletMutationPayload>(
      "/api/v1/wallet/debit",
      request,
    );
    return this.normalizeWalletMutation(payload, request.userId);
  }

  // ===== Admin =====

  /**
   * List audit logs (admin only)
   */
  async adminListAuditLogs(
    options?: PaginationOptions,
  ): Promise<{ items: AuditLogEntry[]; pagination: any }> {
    const params = this.buildQueryParams(options);
    const payload = await this.get<{
      items: LegacyAuditLogEntryPayload[];
      pagination: any;
    }>("/admin/audit-logs", params);
    return {
      items: payload.items.map((item) => this.normalizeAuditLogEntry(item)),
      pagination: payload.pagination,
    };
  }

  private normalizeWalletBalance(
    payload: LegacyWalletBalancePayload,
    fallbackUserId: string,
  ): WalletBalance {
    const balancePoints =
      payload.balancePoints ?? payload.balancePoints ?? 0;
    return {
      userId: payload.userId ?? fallbackUserId,
      balancePoints,
      availablePoints:
        payload.availablePoints ??
        payload.availablePoints ??
        balancePoints,
      reservedPoints:
        payload.reservedPoints ?? payload.reservedPoints ?? 0,
      unit: POINT_UNIT,
    };
  }

  private normalizeWalletLedgerEntry(
    payload: LegacyWalletLedgerEntryPayload,
    fallbackUserId: string,
  ): WalletLedgerEntry {
    const amountPoints =
      payload.amountPoints ?? payload.amountPoints ?? 0;
    return {
      entryId: payload.entryId ?? "",
      userId: payload.userId ?? fallbackUserId,
      type: payload.type ?? "credit",
      amountPoints,
      balancePoints:
        payload.balancePoints ?? payload.balancePoints ?? amountPoints,
      unit: POINT_UNIT,
      reason: payload.reason ?? "",
      idempotencyKey: payload.idempotencyKey,
      createdAt: payload.createdAt ?? "",
    };
  }

  private normalizeWalletMutation(
    payload: LegacyWalletMutationPayload,
    fallbackUserId: string,
  ): WalletMutationResponse {
    const entry = this.normalizeWalletLedgerEntry(
      payload.entry ?? {},
      fallbackUserId,
    );
    return {
      entry,
      balancePoints:
        payload.balancePoints ??
        payload.balancePoints ??
        entry.balancePoints,
      unit: POINT_UNIT,
    };
  }

  private normalizeAuditLogEntry(
    payload: LegacyAuditLogEntryPayload,
  ): AuditLogEntry {
    return {
      id: payload.id ?? "",
      action: payload.action ?? "",
      actorId: payload.actorId ?? "",
      userId: payload.userId,
      targetId: payload.targetId ?? "",
      pointGrantId: payload.pointGrantId ?? payload.freebetId,
      pointRuleId: payload.pointRuleId ?? payload.oddsBoostId,
      pointGrantAppliedPoints:
        payload.pointGrantAppliedPoints ?? payload.freebetAppliedPoints,
      occurredAt: payload.occurredAt ?? "",
      details: payload.details ?? "",
    };
  }

  // ===== Internal HTTP Methods =====

  /**
   * Make GET request with auth and retry logic
   */
  private async get<T>(
    path: string,
    params?: URLSearchParams | Record<string, string>,
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>("GET", url);
  }

  /**
   * Make POST request with auth and retry logic
   */
  private async post<T>(path: string, body?: any): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>("POST", url, body);
  }

  /**
   * Make HTTP request with automatic auth, 401 refresh, and retry logic
   */
  private async request<T>(
    method: string,
    url: string,
    body?: any,
    retryCount: number = 0,
  ): Promise<T> {
    try {
      const response = await this.fetchWithTimeout(url, {
        method,
        headers: this.buildHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle 401 - try to refresh token
      if (response.status === 401) {
        if (await this.tryRefreshToken()) {
          // Retry with new token
          if (retryCount < this.retryAttempts) {
            return this.request<T>(method, url, body, retryCount + 1);
          }
        }
        // Refresh failed or max retries exceeded - logout
        this.authManager.clearTokens();
        throw this.createApiError("Unauthorized", response, false, retryCount);
      }

      if (!response.ok) {
        const error = await this.handleErrorResponse(response);
        // Retry on 5xx errors (server errors)
        const isRetryable = response.status >= 500;
        if (isRetryable && retryCount < this.retryAttempts) {
          await this.delay(this.retryDelay * Math.pow(2, retryCount));
          return this.request<T>(method, url, body, retryCount + 1);
        }
        throw error;
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new Error(
        `Network request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Try to refresh the access token
   */
  private async tryRefreshToken(): Promise<boolean> {
    // Prevent concurrent refresh attempts
    if (this.refreshInProgress) {
      return this.refreshInProgress;
    }

    const refreshToken = this.authManager.getRefreshToken();
    if (!refreshToken) {
      return false;
    }

    this.refreshInProgress = (async () => {
      try {
        const response = await this.post<TokenResponse>(
          "/api/v1/auth/refresh",
          {
            refreshToken,
          },
        );
        this.authManager.setTokens(
          response.accessToken,
          response.refreshToken,
          response.expiresInSeconds,
        );
        return true;
      } catch {
        return false;
      } finally {
        this.refreshInProgress = null;
      }
    })();

    return this.refreshInProgress;
  }

  /**
   * Fetch with timeout
   */
  private fetchWithTimeout(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    return fetch(url, {
      ...options,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
  }

  /**
   * Build Authorization and other headers
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const authHeader = this.authManager.getAuthHeader();
    if (authHeader) {
      headers.Authorization = authHeader;
    }

    return headers;
  }

  /**
   * Build full URL with query params
   */
  private buildUrl(
    path: string,
    params?: URLSearchParams | Record<string, string>,
  ): string {
    const url = new URL(path, this.baseUrl);

    if (params) {
      if (params instanceof URLSearchParams) {
        url.search = params.toString();
      } else {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== "") {
            url.searchParams.append(key, String(value));
          }
        });
      }
    }

    return url.toString();
  }

  /**
   * Build query params from options
   */
  private buildQueryParams(
    options?: Record<string, any>,
  ): Record<string, string> {
    const params: Record<string, string> = {};
    if (!options) return params;

    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        params[key] = String(value);
      }
    });

    return params;
  }

  /**
   * Handle error response
   */
  private async handleErrorResponse(response: Response): Promise<ApiError> {
    let errorData: ErrorResponse | undefined;

    try {
      errorData = await response.json();
    } catch {
      // Response is not JSON
    }

    return this.createApiError(
      errorData?.message || response.statusText,
      response,
      false,
      0,
    );
  }

  /**
   * Create ApiError
   */
  private createApiError(
    message: string,
    response: Response,
    retryable: boolean,
    retryCount: number,
  ): ApiError {
    const error = new Error(message) as ApiError;
    error.name = "ApiError";
    error.status = response.status;
    error.retryable = retryable;
    error.retryCount = retryCount;
    return error;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
