"use client";

import type React from "react";
import {
  createContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../lib/api/client";
import { login as authLogin, getSession } from "../lib/api/auth-client";
import { getCoolOffStatus } from "../lib/api/compliance-client";
import { claimStarterGrant } from "../lib/api/wallet-client";
import { IdleActivityMonitor } from "./IdleActivityMonitor";
import { useToast } from "./ToastProvider";
import { logger } from "../lib/logger";

function getCSRFHeaders(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("csrf_token="));
  if (!match) return {};
  const token = decodeURIComponent(match.slice("csrf_token=".length));
  return token ? { "X-CSRF-Token": token } : {};
}

export interface User {
  id: string;
  username: string;
  email?: string;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (
    username: string,
    password: string,
    opts?: { welcomeToast?: boolean },
  ) => Promise<User>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  error: Error | null;
  sessionStartTime: Date | null;
}

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined,
);

interface AuthProviderProps {
  children: React.ReactNode;
}

function readStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  const id = localStorage.getItem("taptrade_user_id");
  const username = localStorage.getItem("taptrade_username");
  if (!id || !username) return null;
  return { id, username };
}

function persistStoredUser(user: User) {
  if (typeof window === "undefined") return;
  localStorage.setItem("taptrade_user_id", user.id);
  localStorage.setItem("taptrade_username", user.username);
}

function clearStoredUser() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("taptrade_user_id");
  localStorage.removeItem("taptrade_username");
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  // Hydration safety (P12, 2026-07-12): auth state MUST start null on both
  // passes. The previous initializer read localStorage during the first
  // render (server: null, client: possibly a user), a tree mismatch that was
  // only masked because I18nProvider used to withhold children until after
  // hydration. The stored user is re-applied in the mount effect below —
  // synchronously before the async session validation — and TopBar already
  // renders no auth CTA while `isLoading` is true, so there is no
  // signed-out flash for returning users.
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const toast = useToast();
  const { t } = useTranslation("header");

  // Starter point grant: when a session is established (login or restore),
  // claim the one-time faucet so a freshly-registered player is immediately
  // tradeable. The endpoint is idempotent and a no-op when the faucet is
  // disabled server-side (STARTER_GRANT_CENTS=0). Best-effort — it never
  // blocks auth.
  //
  // Once-per-user sticky: the gateway resolves the claim once and for all
  // (granted, already granted, or faucet disabled), so after ANY definitive
  // response we record a per-user localStorage marker and skip the POST on
  // every later login/session restore. Brand-new users have no marker and
  // still fire. Only a failed request (network error / non-2xx — the client
  // resolves those to null) leaves the marker unset so the next session
  // retries.
  const starterGrantClaimedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user || starterGrantClaimedFor.current === user.id) return;
    const doneKey = `taptrade_starter_grant_done:${user.id}`;
    if (typeof window !== "undefined" && localStorage.getItem(doneKey)) {
      return;
    }
    starterGrantClaimedFor.current = user.id;
    void claimStarterGrant(user.id).then((res) => {
      if (!res) return;
      if (res.enabled) {
        logger.info("Points", "starter grant applied", res.balancePoints);
      }
      // The welcome moment: only the claim that actually wrote the ledger
      // row (granted, server-decided) gets a toast — a returning user's
      // idempotent replay stays silent.
      if (res.enabled && res.granted && (res.grantPoints ?? 0) > 0) {
        toast.success(
          t("STARTER_GRANT_TOAST_TITLE"),
          t("STARTER_GRANT_TOAST_BODY", { points: res.grantPoints }),
        );
      }
      if (typeof window !== "undefined") {
        localStorage.setItem(doneKey, "1");
      }
    });
  }, [user, toast, t]);

  // Check for existing session on mount
  useEffect(() => {
    let mounted = true;

    // Two-pass auth hydrate: seed the locally-stored user immediately after
    // mount (client-only, so no SSR mismatch) while getSession() validates
    // the cookie in the background. This mirrors the pre-P12 useState
    // initializer's condition exactly — restoreSession() below then
    // confirms, replaces, or clears it.
    if (apiClient.isAuthenticated()) {
      const seeded = readStoredUser();
      if (seeded) setUser(seeded);
    }

    const restoreSession = async () => {
      try {
        // Hint the server has a session even if localStorage was cleared:
        // csrf_token is set alongside access_token on every successful login
        // and is readable from JS (access_token itself is HttpOnly). If either
        // signal is present we check the session; otherwise skip the round-trip
        // so anonymous page loads stay fast.
        const storedUser = readStoredUser();
        const hasCsrfCookie =
          typeof document !== "undefined" &&
          /(^|;\s*)csrf_token=/.test(document.cookie);
        if (!storedUser && !hasCsrfCookie) {
          return;
        }

        try {
          // Session validation uses HttpOnly cookie automatically
          const session = await getSession();
          if (!mounted) return;
          if (!session.authenticated) {
            // Cookie exists but session is invalid (expired, revoked) —
            // clear any stale stored user and drop out of auth state.
            clearStoredUser();
            setUser(null);
            return;
          }
          const restoredUser = {
            id: session.userId,
            username: session.username,
          };
          setUser(restoredUser);
          setSessionStartTime(new Date());
          persistStoredUser(restoredUser);
        } catch (sessionErr) {
          // Issue #4: Distinguish network errors from auth failures
          const isNetworkError = !(
            sessionErr instanceof Error && "status" in sessionErr
          );
          if (isNetworkError && storedUser) {
            // Network issue, keep user logged in with stale data
            logger.warn(
              "Auth",
              "Session check failed, possible network issue",
              sessionErr,
            );
            if (mounted) {
              setUser(storedUser);
              setSessionStartTime(new Date());
            }
            return;
          }

          // Auth failure, try refresh (cookie-based, no token param needed).
          // Route through apiClient.refreshSession so this mount-time
          // path also shares the refreshLock — see refreshTokenFn for
          // the full rationale on the rotation-race that surfaces as
          // "refresh token is invalid or expired" without the shared
          // lock.
          try {
            const ok = await apiClient.refreshSession();
            if (!ok) throw new Error("refresh failed");
            const session = await getSession();
            if (!mounted || !session.authenticated) return;
            const restoredUser = {
              id: session.userId,
              username: session.username,
            };
            setUser(restoredUser);
            setSessionStartTime(new Date());
            persistStoredUser(restoredUser);
          } catch {
            throw sessionErr;
          }
        }
      } catch (err) {
        logger.error("Auth", "Session check failed", err);
        clearStoredUser();
        if (mounted) {
          setUser(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    restoreSession();

    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(
    async (
      username: string,
      password: string,
      opts?: { welcomeToast?: boolean },
    ) => {
      setIsLoading(true);
      setError(null);
      try {
        // Login sets HttpOnly cookies server-side, no client token handling needed
        await authLogin({ username, password });

        // Validate session via cookie-authenticated endpoint
        const session = await getSession();
        if (!session.authenticated) {
          throw new Error("Authenticated session could not be restored");
        }

        // Check cool-off status before completing login
        const coolOff = await getCoolOffStatus(session.userId);
        if (coolOff.status === "active" && coolOff.coolOffUntil) {
          const coolOffEnd = new Date(coolOff.coolOffUntil);
          if (coolOffEnd > new Date()) {
            logger.warn("Auth", "Login blocked due to active cool-off period", {
              userId: session.userId,
              coolOffUntil: coolOff.coolOffUntil,
            });
            // Clear server-side cookies via logout endpoint
            await fetch("/api/v1/auth/logout/", {
              method: "POST",
              credentials: "include",
              headers: getCSRFHeaders(),
            }).catch(() => {});
            clearStoredUser();
            throw new Error(
              `Your account is under a cool-off period until ${coolOffEnd.toLocaleDateString()}. Please try again later.`,
            );
          }
        }

        const authenticatedUser = {
          id: session.userId,
          username: session.username,
        };
        persistStoredUser(authenticatedUser);
        setUser(authenticatedUser);
        setSessionStartTime(new Date());
        // QA fix ISSUE-010 (2026-07-26): the register flow reuses login()
        // and used to greet brand-new accounts with "Welcome back!" —
        // callers that follow registration pass welcomeToast:false and
        // announce the account creation themselves.
        if (opts?.welcomeToast !== false) {
          toast.success("Welcome back!", session.username);
        }
        return authenticatedUser;
      } catch (err) {
        // Issue #5 fix: clear cookies on any login failure to prevent half-auth
        await fetch("/api/v1/auth/logout/", {
          method: "POST",
          credentials: "include",
          headers: getCSRFHeaders(),
        }).catch(() => {});
        clearStoredUser();
        setUser(null);
        const loginError = err instanceof Error ? err : new Error(String(err));
        setError(loginError);
        throw loginError;
      } finally {
        setIsLoading(false);
      }
    },
    [toast],
  );

  const logout = useCallback(async () => {
    // Clear server-side HttpOnly cookies
    await fetch("/api/v1/auth/logout/", {
      method: "POST",
      credentials: "include",
      headers: getCSRFHeaders(),
    }).catch(() => {});
    clearStoredUser();
    setUser(null);
    setError(null);
    setSessionStartTime(null);
    toast.info("Signed out", "You have been logged out.");
  }, [toast]);

  const refreshTokenFn = useCallback(async () => {
    setError(null);
    try {
      // Route through apiClient.refreshSession so this path shares the
      // refreshLock with fetchWithRetry's post-401 retry path. Without
      // the shared lock, the IdleActivityMonitor's scheduled timer and
      // an in-flight 401-retry could both fire /refresh concurrently
      // with the same token. The auth service rotates refresh tokens on
      // success, so the second call lands with a stale token and 401s
      // — surfacing as "refresh token is invalid or expired" in the
      // console and force-logging the user out. The shared lock
      // serializes both paths through a single in-flight refresh.
      const ok = await apiClient.refreshSession();
      if (!ok) {
        throw new Error("refresh token is invalid or expired");
      }
      const session = await getSession();
      const refreshedUser = { id: session.userId, username: session.username };
      persistStoredUser(refreshedUser);
      setUser(refreshedUser);
    } catch (err) {
      const refreshError = err instanceof Error ? err : new Error(String(err));
      setError(refreshError);
      logout();
      throw refreshError;
    }
  }, [logout]);

  const isAuthenticated = user !== null;

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      login,
      logout,
      refreshToken: refreshTokenFn,
      error,
      sessionStartTime,
    }),
    [
      user,
      isAuthenticated,
      isLoading,
      login,
      logout,
      refreshTokenFn,
      error,
      sessionStartTime,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {isAuthenticated && (
        <IdleActivityMonitor
          onLogout={logout}
          onRefreshToken={refreshTokenFn}
          isAuthenticated={isAuthenticated}
          sessionTimeoutSeconds={840}
          warningSeconds={60}
        />
      )}
      {children}
    </AuthContext.Provider>
  );
};
