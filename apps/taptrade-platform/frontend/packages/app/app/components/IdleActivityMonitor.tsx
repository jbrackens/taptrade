"use client";

import type React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { logger } from "../lib/logger";
import { Button } from "./ui";

interface IdleActivityMonitorProps {
  onLogout: () => void;
  onRefreshToken?: () => Promise<void>;
  isAuthenticated: boolean;
  sessionTimeoutSeconds?: number;
  warningSeconds?: number;
}

const SIGN_OUT_TIME = 840;
const WARN_TIME = 60;
const TOKEN_REFRESH_AHEAD = 30;

export const IdleActivityMonitor: React.FC<IdleActivityMonitorProps> = ({
  onLogout,
  onRefreshToken,
  isAuthenticated,
  sessionTimeoutSeconds = SIGN_OUT_TIME,
  warningSeconds = WARN_TIME,
}) => {
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(warningSeconds);
  const lastActivityRef = useRef<number>(Date.now());
  const countdownIntervalRef = useRef<number | null>(null);
  const warningTimeoutRef = useRef<number | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const warningShownRef = useRef(false);

  // ── Stable callback refs (CLAUDE.md pattern) ──────────────
  // Props like onLogout and onRefreshToken come from useCallback chains
  // that depend on context values (toast, etc.) and can recreate every
  // render. Storing them in refs keeps our effects stable.
  const onLogoutRef = useRef(onLogout);
  useEffect(() => {
    onLogoutRef.current = onLogout;
  });

  const onRefreshTokenRef = useRef(onRefreshToken);
  useEffect(() => {
    onRefreshTokenRef.current = onRefreshToken;
  });

  const clearSessionTimers = useCallback(() => {
    if (warningTimeoutRef.current) {
      clearTimeout(warningTimeoutRef.current);
      warningTimeoutRef.current = null;
    }
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  // scheduleSessionTimers uses refs for callbacks, so it only depends
  // on primitive values — no cascading function reference changes.
  const scheduleSessionTimers = useCallback(() => {
    clearSessionTimers();

    const idleMs = Date.now() - lastActivityRef.current;
    const refreshInMs = Math.max(
      0,
      (sessionTimeoutSeconds - TOKEN_REFRESH_AHEAD) * 1000 - idleMs,
    );
    const warningInMs = Math.max(0, sessionTimeoutSeconds * 1000 - idleMs);

    refreshTimeoutRef.current = window.setTimeout(async () => {
      if (!warningShownRef.current) {
        try {
          await onRefreshTokenRef.current?.();
        } catch (err) {
          logger.error("IdleMonitor", "Token refresh failed", err);
        }
      }
    }, refreshInMs);

    warningTimeoutRef.current = window.setTimeout(() => {
      warningShownRef.current = true;
      setShowWarning(true);
      setCountdown(warningSeconds);
    }, warningInMs);
  }, [clearSessionTimers, sessionTimeoutSeconds, warningSeconds]);

  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();

    if (warningShownRef.current) {
      warningShownRef.current = false;
      setShowWarning(false);
      setCountdown(warningSeconds);
    }

    scheduleSessionTimers();
  }, [scheduleSessionTimers, warningSeconds]);

  // Start/stop timers when auth state changes
  useEffect(() => {
    if (!isAuthenticated) {
      clearSessionTimers();
      warningShownRef.current = false;
      setShowWarning(false);
      return;
    }

    lastActivityRef.current = Date.now();
    scheduleSessionTimers();

    return () => {
      clearSessionTimers();
    };
  }, [clearSessionTimers, isAuthenticated, scheduleSessionTimers]);

  // Attach activity listeners
  useEffect(() => {
    if (!isAuthenticated) return;

    const events = ["mousedown", "keydown", "scroll", "touchstart", "focus"];

    events.forEach((event) => {
      window.addEventListener(event, handleActivity, {
        capture: true,
        passive: event === "scroll" || event === "touchstart",
      });
    });

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity, true);
      });
    };
  }, [isAuthenticated, handleActivity]);

  // Countdown tick when warning is visible
  useEffect(() => {
    if (!showWarning) return;

    countdownIntervalRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
          }
          onLogoutRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [showWarning]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSessionTimers();
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [clearSessionTimers]);

  if (!showWarning || !isAuthenticated) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[color-mix(in_srgb,var(--ink-deep)_58%,transparent)]">
      <div className="max-w-[400px] rounded-[var(--r-rh-xl)] bg-[var(--card)] p-8 text-center shadow-[var(--shadow-pop)]">
        <h2 className="mb-3 text-xl font-bold text-[var(--t1)]">
          Inactivity Warning
        </h2>

        <p className="mb-6 text-sm leading-[1.5] text-[var(--t2)]">
          Your session will expire due to inactivity. Click below to stay logged
          in.
        </p>

        <div className="mb-6 rounded-[var(--r-rh-md)] border border-[var(--border-1)] border-l-[3px] border-l-[var(--warning)] bg-[var(--surface-2)] p-4">
          <p className="font-mono text-2xl font-bold text-[var(--t1)]">
            {countdown}s
          </p>
          <p className="mt-2 text-xs text-[var(--t2)]">Seconds remaining</p>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="primary"
            onClick={handleActivity}
            className="w-full"
          >
            Stay Logged In
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => onLogoutRef.current()}
            className="w-full"
          >
            Log Out Now
          </Button>
        </div>
      </div>
    </div>
  );
};

export default IdleActivityMonitor;
