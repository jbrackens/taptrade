"use client";

import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { logger } from "../lib/logger";

const CHECK_INTERVAL_MS = 30_000;
const TIMEOUT_MS = 5_000;

/**
 * Thin banner that appears when the Go gateway API is unreachable.
 * Polls /api/v1/status every 30s. Shows nothing when healthy.
 */
export function BackendStatusBanner() {
  const [status, setStatus] = useState<"ok" | "down" | "checking">("checking");
  const [dismissed, setDismissed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useTranslation("common");

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const res = await fetch("/api/v1/status/", {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (mounted) {
          setStatus(res.ok ? "ok" : "down");
          if (res.ok) setDismissed(false);
        }
      } catch {
        if (mounted) setStatus("down");
      }
    };

    // Initial check
    check();

    // Periodic check
    timerRef.current = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      mounted = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (status === "down") {
      logger.warn("BackendStatus", "Go gateway unreachable");
    }
  }, [status]);

  if (status !== "down" || dismissed) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b border-[var(--border-1)] border-l-[3px] border-l-[var(--warning)] bg-[var(--surface-1)] px-4 py-2 text-[13px] font-medium text-[var(--t1)]"
    >
      <span className="flex items-center gap-2">
        <WarningIcon
          size={15}
          weight="bold"
          aria-hidden="true"
          className="shrink-0 text-[var(--warning)]"
        />
        {t("BACKEND_OFFLINE", {
          defaultValue:
            "Backend services are offline — some features may not work. Check that the Go gateway is running on port 18080.",
        })}
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 cursor-pointer rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-transparent px-2 py-0.5 text-[11px] font-semibold text-[var(--t2)] transition-colors duration-150 hover:border-[var(--t3)] hover:text-[var(--t1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]"
      >
        {t("DISMISS", { defaultValue: "Dismiss" })}
      </button>
    </div>
  );
}

export default BackendStatusBanner;
