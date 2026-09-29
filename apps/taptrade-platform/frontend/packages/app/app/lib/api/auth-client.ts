import { ApiError, apiClient } from "./client";

// Request types
export interface GoLoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  date_of_birth?: string;
  ssn_last4?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  terms_accepted?: boolean;
  terms_version?: string;
  launch_disclosure_accepted?: boolean;
  launch_disclosure_version?: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  new_password: string;
}

export interface VerifyEmailRequest {
  token: string;
}

export interface ChangePasswordRequest {
  user_id: string;
  current_password: string;
  new_password: string;
}

export interface AcceptTermsRequest {
  user_id: string;
  terms_version: string;
}

// Response types (Go API uses snake_case)
interface GoLoginResponseRaw {
  access_token: string;
  refresh_token: string;
  user_id: string;
  username: string;
}

interface GoRefreshResponseRaw {
  access_token: string;
  refresh_token: string;
}

interface RegisterResponseRaw {
  user_id?: string;
  userId?: string;
  username: string;
  email?: string;
  role?: string;
  terms_accepted?: boolean;
  termsAccepted?: boolean;
  terms_version?: string;
  termsVersion?: string;
  terms_accepted_at?: string;
  termsAcceptedAt?: string;
  launch_disclosure_accepted?: boolean;
  launchDisclosureAccepted?: boolean;
  launch_disclosure_version?: string;
  launchDisclosureVersion?: string;
  launch_disclosure_accepted_at?: string;
  launchDisclosureAcceptedAt?: string;
  requires_email_verification?: boolean;
  requires_mfa?: boolean;
}

interface ForgotPasswordResponseRaw {
  message: string;
}

interface ResetPasswordResponseRaw {
  message: string;
}

interface VerifyEmailResponseRaw {
  user_id: string;
  status: string;
}

interface ChangePasswordResponseRaw {
  message: string;
}

interface AcceptTermsResponseRaw {
  accepted: boolean;
  terms_version: string;
}

// Normalized response types (camelCase)
export interface GoLoginResponse {
  accessToken: string;
  refreshToken: string;
  userId: string;
  username: string;
}

export interface GoRefreshResponse {
  accessToken: string;
  refreshToken: string;
}

interface SessionResponseRaw {
  authenticated: boolean;
  userId: string;
  username: string;
  expiresAt: string;
  termsAccepted?: boolean;
  termsVersion?: string;
  termsAcceptedAt?: string;
  launchDisclosureAccepted?: boolean;
  launchDisclosureVersion?: string;
  launchDisclosureAcceptedAt?: string;
}

export interface SessionResponse {
  authenticated: boolean;
  userId: string;
  username: string;
  expiresAt: string;
  termsAccepted?: boolean;
  termsVersion?: string;
  termsAcceptedAt?: string;
  launchDisclosureAccepted?: boolean;
  launchDisclosureVersion?: string;
  launchDisclosureAcceptedAt?: string;
}

export interface RegisterResponse {
  userId: string;
  username: string;
  email?: string;
  role?: string;
  termsAccepted?: boolean;
  termsVersion?: string;
  termsAcceptedAt?: string;
  launchDisclosureAccepted?: boolean;
  launchDisclosureVersion?: string;
  launchDisclosureAcceptedAt?: string;
  requiresEmailVerification?: boolean;
  requiresMfa?: boolean;
}

export interface ForgotPasswordResponse {
  message: string;
}

export interface ResetPasswordResponse {
  message: string;
}

export interface VerifyEmailResponse {
  userId: string;
  status: string;
}

/**
 * Returned by login instead of tokens when the account signs in with a code
 * from an authenticator app. `enrollment` is present when a staff account has
 * no authenticator yet: the page shows the key, and the first code confirms it.
 */
export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
  expiresInSeconds: number;
  enrollment?: MfaEnrollment;
}

export interface MfaEnrollment {
  secret: string;
  otpauthUrl: string;
}

export interface MfaStatus {
  available: boolean;
  enabled: boolean;
  pending: boolean;
  required: boolean;
}

/** Thrown by AuthProvider.login when the password was right and a code is next. */
export class MfaRequiredError extends Error {
  challenge: MfaChallenge;
  constructor(challenge: MfaChallenge) {
    super("two-factor code required");
    this.name = "MfaRequiredError";
    this.challenge = challenge;
  }
}

export function isMfaChallenge(value: unknown): value is MfaChallenge {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).mfaRequired === true
  );
}

export interface ChangePasswordResponse {
  message: string;
}

export interface AcceptTermsResponse {
  accepted: boolean;
  termsVersion: string;
}

// Utility function to normalize snake_case to camelCase
function normalizeSnakeCase<T extends object>(obj: T): unknown {
  if (Array.isArray(obj)) {
    return obj.map(normalizeSnakeCase) as unknown as Record<string, unknown>;
  }
  if (obj !== null && typeof obj === "object") {
    return Object.entries(obj).reduce<Record<string, unknown>>(
      (acc, [key, value]) => {
        const camelKey = key.replace(/_([a-z])/g, (_, letter: string) =>
          letter.toUpperCase(),
        );
        acc[camelKey] =
          typeof value === "object" && value !== null
            ? normalizeSnakeCase(value as Record<string, unknown>)
            : value;
        return acc;
      },
      {},
    );
  }
  return obj;
}

/**
 * Login with username and password
 */
export async function login(
  request: GoLoginRequest,
): Promise<GoLoginResponse | MfaChallenge> {
  const response = await fetch("/api/v1/auth/login/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = await response.text();
    let readable = body || "Login failed";
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        const errObj = (parsed as Record<string, unknown>).error;
        if (errObj && typeof errObj === "object" && "message" in errObj) {
          readable = String((errObj as Record<string, unknown>).message);
        }
      }
    } catch {
      // body is not JSON, use as-is
    }
    throw new Error(readable);
  }

  const raw: unknown = await response.json();
  if (isMfaChallenge(raw)) return raw;
  return normalizeSnakeCase(raw as GoLoginResponseRaw) as GoLoginResponse;
}

/**
 * Second sign-in step: the authenticator code. The challenge travels in an
 * HttpOnly cookie set by the password step (or by social sign-in); pass
 * mfaToken when the page has it from the login response.
 */
export async function verifyLoginMfa(
  code: string,
  mfaToken?: string,
): Promise<GoLoginResponse> {
  const response = await fetch("/api/v1/auth/login/mfa/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(mfaToken ? { code, mfaToken } : { code }),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  const raw = (await response.json()) as GoLoginResponseRaw;
  return normalizeSnakeCase(raw) as GoLoginResponse;
}

export function getMfaStatus(): Promise<MfaStatus> {
  return apiClient.get<MfaStatus>("/api/v1/auth/mfa");
}

/** Starts (or restarts) setup: returns a new key for the authenticator app. */
export function startMfaEnrollment(): Promise<MfaEnrollment> {
  return apiClient.post<MfaEnrollment>("/api/v1/auth/mfa/enroll", {});
}

/** Confirms setup with the first code from the new key. */
export async function activateMfa(code: string): Promise<void> {
  await apiClient.post("/api/v1/auth/mfa/activate", { code });
}

/** Turns two-factor sign-in off; needs a current code. */
export async function disableMfa(code: string): Promise<void> {
  await apiClient.post("/api/v1/auth/mfa/disable", { code });
}

/**
 * Refresh access token
 */
export async function refresh(): Promise<GoRefreshResponse> {
  // Refresh token is sent automatically via HttpOnly cookie
  const response = await fetch("/api/v1/auth/refresh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });

  if (!response.ok) {
    const body = await response.text();
    let readable = body || "Session refresh failed";
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        const errObj = (parsed as Record<string, unknown>).error;
        if (errObj && typeof errObj === "object" && "message" in errObj) {
          readable = String((errObj as Record<string, unknown>).message);
        }
      }
    } catch {
      // not JSON
    }
    throw new Error(readable);
  }

  const raw = (await response.json()) as GoRefreshResponseRaw;
  return normalizeSnakeCase(raw) as GoRefreshResponse;
}

export async function getSession(): Promise<SessionResponse> {
  // Access token is sent automatically via HttpOnly cookie
  const response = await fetch("/api/v1/auth/session/", {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    const body = await response.text();
    let readable = body || "Session validation failed";
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        const errObj = (parsed as Record<string, unknown>).error;
        if (errObj && typeof errObj === "object" && "message" in errObj) {
          readable = String((errObj as Record<string, unknown>).message);
        }
      }
    } catch {
      // not JSON
    }
    throw new Error(readable);
  }

  const raw = (await response.json()) as SessionResponseRaw;
  return raw;
}

/**
 * Register a new user
 */
export async function register(
  request: RegisterRequest,
): Promise<RegisterResponse> {
  const raw = await apiClient.post<RegisterResponseRaw>(
    "/api/v1/auth/register",
    request,
  );
  return normalizeSnakeCase(raw) as RegisterResponse;
}

/**
 * Request password reset
 */
export async function forgotPassword(
  request: ForgotPasswordRequest,
): Promise<ForgotPasswordResponse> {
  const raw = await apiClient.post<ForgotPasswordResponseRaw>(
    "/api/v1/auth/forgot-password",
    request,
  );
  return normalizeSnakeCase(raw) as ForgotPasswordResponse;
}

/**
 * Reset password with token
 */
export async function resetPassword(
  request: ResetPasswordRequest,
): Promise<ResetPasswordResponse> {
  const raw = await apiClient.post<ResetPasswordResponseRaw>(
    "/api/v1/auth/reset-password",
    request,
  );
  return normalizeSnakeCase(raw) as ResetPasswordResponse;
}

/**
 * Verify email with token
 */
export async function verifyEmail(
  request: VerifyEmailRequest,
): Promise<VerifyEmailResponse> {
  const raw = await apiClient.post<VerifyEmailResponseRaw>(
    "/api/v1/auth/verify-email",
    request,
  );
  return normalizeSnakeCase(raw) as VerifyEmailResponse;
}

/**
 * Change user password
 */
export async function changePassword(
  request: ChangePasswordRequest,
): Promise<ChangePasswordResponse> {
  const raw = await apiClient.post<ChangePasswordResponseRaw>(
    "/api/v1/auth/change-password",
    request,
  );
  return normalizeSnakeCase(raw) as ChangePasswordResponse;
}

/**
 * Accept terms and conditions
 */
export async function acceptTerms(
  request: AcceptTermsRequest,
): Promise<AcceptTermsResponse> {
  const raw = await apiClient.post<AcceptTermsResponseRaw>(
    "/api/v1/auth/accept-terms",
    request,
  );
  return normalizeSnakeCase(raw) as AcceptTermsResponse;
}

// Session types
interface SessionRaw {
  id: string;
  device: string;
  location: string;
  last_active: string;
  current: boolean;
}

export interface Session {
  id: string;
  device: string;
  location: string;
  lastActive: string;
  current: boolean;
}

/**
 * Get active sessions for a user
 */
export async function getSessions(userId: string): Promise<Session[]> {
  const raw = await apiClient.get<SessionRaw[]>("/api/v1/auth/sessions", {
    user_id: userId,
  });
  if (Array.isArray(raw)) {
    return raw.map((s) => normalizeSnakeCase(s) as Session);
  }
  return [];
}

/**
 * Revoke (sign out) a specific session
 */
export async function revokeSession(
  sessionId: string,
): Promise<{ message: string }> {
  const raw = await apiClient.delete<{ message: string }>(
    `/api/v1/auth/sessions/${sessionId}`,
  );
  return raw;
}
