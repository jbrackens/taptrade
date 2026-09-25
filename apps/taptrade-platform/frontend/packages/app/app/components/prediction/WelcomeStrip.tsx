"use client";

/**
 * WelcomeStrip — the one-line pitch above the board for signed-out
 * visitors (the home page is the market board, Kalshi-style). States the
 * points-only boundary up front: free to play, no cash, 18+.
 */

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";

// The points-only boundary line carries money words ("cash"), so like the
// other compliance copy it is an inline English constant, never a locale
// string (the locale files are kept free of cash/gambling vocabulary).
const WELCOME_FINE_LEGAL = "Points only · no cash, no cash-out · 18+";

export function WelcomeStrip() {
  const { t } = useTranslation("prediction");
  const { isAuthenticated, isLoading } = useAuth();
  // Signed-in users (and the brief auth check) go straight to the board.
  if (isLoading || isAuthenticated) return null;

  return (
    <section
      aria-labelledby="welcome-strip-title"
      data-testid="welcome-strip"
      className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] px-6 py-5 shadow-[var(--shadow-card)] max-[640px]:px-4 max-[640px]:py-4"
    >
      <div className="min-w-0">
        <h2
          id="welcome-strip-title"
          className="m-0 text-[22px] font-semibold leading-tight tracking-[-0.025em] text-[var(--t1)] max-[640px]:text-[19px]"
        >
          {t("HOME_WELCOME_TITLE", "Call what happens next.")}
        </h2>
        <p className="m-0 mt-1 text-[14px] text-[var(--t2)]">
          {t(
            "HOME_WELCOME_BODY",
            "Pick Yes or No on the moments everyone's talking about. Free to play with points.",
          )}
        </p>
        <p className="m-0 mt-1 text-[12px] text-[var(--t3)]">
          {WELCOME_FINE_LEGAL}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 max-[640px]:w-full">
        <Link
          href="/auth/register"
          className="inline-flex h-10 items-center rounded-[var(--r-rh-md)] bg-[var(--accent)] px-4 text-[14px] font-semibold text-[var(--ticket-cta-text)] no-underline transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_86%,var(--surface-1))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 max-[640px]:flex-1 max-[640px]:justify-center"
        >
          {t("HOME_WELCOME_CTA", "Start free")}
        </Link>
        <Link
          href="/welcome#how-it-works"
          className="inline-flex h-10 items-center rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-1)] px-4 text-[14px] font-semibold text-[var(--t1)] no-underline transition-colors duration-150 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 max-[640px]:flex-1 max-[640px]:justify-center"
        >
          {t("HOME_WELCOME_HOW", "How it works")}
        </Link>
      </div>
    </section>
  );
}
