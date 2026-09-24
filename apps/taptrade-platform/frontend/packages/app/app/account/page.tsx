"use client";

/**
 * AccountPage — Predict-native profile hub.
 *
 * Replaces the inherited player hub with a prediction-native layout:
 *   [identity banner: avatar + username + available points]
 *   [portfolio summary strip — pulled from /api/v1/portfolio/summary]
 *   [account actions grid: Profile, Portfolio, Points, Security, Alerts,
 *    Responsible Play]
 *
 * Loyalty, leaderboards, analytics, and activity heatmaps should return
 * only as Predict-specific point-native modules.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, HeartHandshake, Lock, Settings, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { logger } from "../lib/logger";
import { getBalance } from "../lib/api/wallet-client";
import type { Balance } from "../lib/api/wallet-client";
import type { PortfolioSummary } from "@taptrade-ui/api-client/src/prediction-types";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import { getPrivacy, updatePrivacy } from "../lib/api/privacy-client";
import { FEATURE_RG } from "../lib/features";
import { formatPoints } from "../lib/points";

const api = createPredictionClient();

export default function AccountPage() {
  const { t } = useTranslation("account");
  const { user } = useAuth();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user?.id) return;
      try {
        const bal = await getBalance(user.id);
        if (!cancelled) setBalance(bal);
      } catch (err: unknown) {
        logger.warn("Account", "balance fetch failed", err);
      }
      try {
        const sum = await api.getPortfolioSummary();
        if (!cancelled) setSummary(sum);
      } catch (err: unknown) {
        logger.warn("Account", "portfolio summary fetch failed", err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const username = user?.username ?? "—";
  const email = user?.email ?? user?.username ?? "—";
  const initial = (user?.username || user?.email || "?")
    .charAt(0)
    .toUpperCase();

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-[60px] pt-6">
      <header className="mb-6">
        <h1 className="type-poster m-0 mb-1.5 text-[28px] text-[var(--t1)] max-[640px]:text-[24px]">
          {t("hub.title", "Account")}
        </h1>
        <p className="m-0 text-[13px] text-[var(--t3)]">
          {t(
            "hub.subtitle",
            "Profile, points, security, and notification preferences.",
          )}
        </p>
      </header>

      <section className="mb-4 flex flex-wrap items-center justify-between gap-5 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] px-[22px] py-5">
        <div className="flex items-center gap-[14px]">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] text-[19px] font-semibold text-[var(--accent-text)]">
            {initial}
          </div>
          <div>
            <div className="text-base font-bold text-[var(--t1)]">
              {username}
            </div>
            <div className="mt-0.5 text-xs text-[var(--t3)]">{email}</div>
          </div>
        </div>
        <div className="flex flex-col gap-0.5 text-right">
          <span className="text-[12px] font-semibold text-[var(--t3)]">
            {t("hub.availableBalance", "Available points")}
          </span>
          {/* The largest number on the screen is a magnitude — neutral ink,
           * same rule as every price. */}
          <span className="font-mono text-[22px] font-medium tracking-[-0.01em] text-[var(--t1)] tabular-nums">
            {balance ? formatPoints(balance.availableBalance) : "—"}
          </span>
        </div>
      </section>

      {summary && <PortfolioStrip summary={summary} />}

      <PrivacyCard />

      <p className="mb-2 text-[12px] font-semibold text-[var(--t3)]">
        {t("hub.manage", "Manage")}
      </p>
      <section className="overflow-hidden rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)]">
        {/* Step 8: Profile pointed at /account/security — a stale link from
         * when /account/settings was the crashed pages-router page (see the
         * header comment in account/settings/page.tsx). Settings has been a
         * working App Router page since that rewrite; "details and account
         * setup" is that page. Security keeps its own row below. */}
        <SettingsRow
          href="/account/settings"
          icon={<Settings size={18} />}
          title={t("actions.profile.title", "Profile")}
          desc={t(
            "actions.profile.desc",
            "Update your details and account setup",
          )}
        />
        <SettingsRow
          href="/portfolio"
          icon={<TrendingUp size={18} />}
          title={t("actions.portfolio.title", "Portfolio")}
          desc={t(
            "actions.portfolio.desc",
            "Open positions, orders, settled history",
          )}
        />
        <SettingsRow
          href="/account/transactions"
          icon={<TrendingUp size={18} />}
          title={t("actions.points.title", "Point ledger")}
          desc={t(
            "actions.points.desc",
            "Starter grants, predictions, and rewards",
          )}
        />
        <SettingsRow
          href="/account/security"
          icon={<Lock size={18} />}
          title={t("actions.security.title", "Security")}
          desc={t(
            "actions.security.desc",
            "Password, sessions, and sign-in protection",
          )}
        />
        <SettingsRow
          href="/account/notifications"
          icon={<Bell size={18} />}
          title={t("actions.alerts.title", "Alerts")}
          desc={t(
            "actions.alerts.desc",
            "Control market and account notifications",
          )}
        />
        {FEATURE_RG && (
          <SettingsRow
            href="/responsible-gaming"
            icon={<HeartHandshake size={18} />}
            title={t("actions.responsible.title", "Play responsibly")}
            desc={t(
              "actions.responsible.desc",
              "Play limits, cool-offs, and self-exclusion",
            )}
          />
        )}
      </section>
    </div>
  );
}

function PrivacyCard() {
  const { t } = useTranslation("account");
  const [displayAnonymous, setDisplayAnonymous] = useState<boolean | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // userIntent guards the mount-effect from overwriting a user-initiated
  // change under React 19 Strict Mode's double-effect in dev. Any fetch that
  // completes after a user click is stale and must not trample state.
  const userIntentRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prefs = await getPrivacy();
        if (cancelled || userIntentRef.current) return;
        setDisplayAnonymous(prefs.displayAnonymous);
      } catch (err: unknown) {
        if (!cancelled) logger.warn("Account", "privacy fetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onToggle(next: boolean) {
    if (saving) return;
    userIntentRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePrivacy({ displayAnonymous: next });
      setDisplayAnonymous(updated.displayAnonymous);
    } catch (err: unknown) {
      logger.warn("Account", "privacy update failed", err);
      setError(
        err instanceof Error
          ? err.message
          : t("privacy.saveError", "Couldn’t save that change"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="mb-5 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] px-[22px] py-5"
      aria-labelledby="acct-privacy-title"
    >
      <div className="mb-[14px]">
        <span className="mb-0.5 block text-[12px] font-semibold text-[var(--t3)]">
          {t("privacy.kicker", "Privacy")}
        </span>
        <h2
          id="acct-privacy-title"
          className="m-0 text-base font-bold text-[var(--t1)]"
        >
          {t("privacy.title", "Appearance on public boards")}
        </h2>
      </div>
      <label className="grid cursor-pointer grid-cols-[auto_1fr] items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-[18px] w-[18px] cursor-pointer accent-[var(--accent)] disabled:cursor-wait disabled:opacity-60"
          checked={displayAnonymous ?? false}
          disabled={displayAnonymous === null || saving}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <div>
          <div className="mb-1 text-sm font-semibold text-[var(--t1)]">
            {t("privacy.label", "Appear anonymously on leaderboards")}
          </div>
          <div className="text-[13px] leading-normal text-[var(--t2)]">
            {t(
              "privacy.descriptionBeforeRank",
              "When on, your username is hidden on public boards and replaced with your rank (e.g.",
            )}{" "}
            <span className="font-mono tabular-nums">
              {t("privacy.rankExample", "Trader #14")}
            </span>
            {t(
              "privacy.descriptionAfterRank",
              "). Your rank and stats still show; only your handle is hidden.",
            )}
          </div>
        </div>
      </label>
      {error && (
        <div
          className="mt-2.5 rounded-[var(--r-rh-md)] border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-xs font-medium text-[var(--danger)]"
          role="alert"
        >
          {error}
        </div>
      )}
    </section>
  );
}

function PortfolioStrip({ summary }: { summary: PortfolioSummary }) {
  const { t } = useTranslation("account");
  const pnl = summary.realizedPoints;
  const pnlUp = pnl >= 0;
  return (
    <section className="mb-5 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] px-[22px] py-5">
      <header className="mb-[14px] flex items-baseline justify-between gap-[14px]">
        <div>
          <span className="mb-0.5 block text-[12px] font-semibold text-[var(--t3)]">
            {t("portfolio.kicker", "Portfolio")}
          </span>
          <h2 className="m-0 text-base font-bold text-[var(--t1)]">
            {t("portfolio.title", "Your positions at a glance")}
          </h2>
        </div>
        <Link
          href="/portfolio"
          className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap text-xs font-semibold text-[var(--accent-text)] no-underline hover:underline"
        >
          {t("portfolio.open", "Open portfolio")} →
        </Link>
      </header>
      <div className="grid grid-cols-4 gap-3 max-[720px]:grid-cols-2">
        <Stat
          label={t("stats.invested", "Points in play")}
          value={formatPoints(summary.totalValuePoints)}
        />
        {/* The one direction colour on the screen: the settled result is an
         * outcome, so it keeps the direction pair. Accuracy is a magnitude
         * — neutral ink like everything else. */}
        <Stat
          label={t("stats.realizedPnl", "Settled result")}
          value={`${pnlUp ? "+" : "-"}${formatPoints(Math.abs(pnl))}`}
          tone={pnlUp ? "yes" : "no"}
        />
        <Stat
          label={t("stats.openPositions", "Open positions")}
          value={String(summary.openPositions)}
        />
        <Stat
          label={t("stats.accuracy", "Accuracy")}
          value={
            summary.totalPredictions > 0
              ? `${summary.accuracyPct.toFixed(1)}%`
              : "—"
          }
          sub={
            summary.totalPredictions > 0
              ? `${summary.correctPredictions}/${summary.totalPredictions}`
 : t("stats.noSettledMarkets", "No settled markets yet")
 }
 />
 </div>
 </section>
 );
}

function Stat({
 label,
 value,
 sub,
 tone,
}: {
 label: string;
 value: string;
 sub?: string;
 tone?: "yes" | "no";
}) {
 const toneClass =
 tone === "yes"
 ? "text-[var(--yes-text)]"
 : tone === "no"
 ? "text-[var(--no-text)]"
 : "text-[var(--t1)]";

 return (
 <div className="flex flex-col gap-0.5 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] px-[14px] py-3">
 <span className="font-mono text-[12px] font-semibold text-[var(--t3)]">
 {label}
 </span>
 <span
 className={`font-mono text-lg font-medium tabular-nums ${toneClass}`}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-[var(--t3)]">{sub}</span>}
    </div>
  );
}

// Apple-Settings-grade navigation row: label + description left, chevron
// right, hairline divider between rows (the group's own border supplies
// the top/bottom edge — see the wrapping <section>). Hover is the same
// raised-well step TopBar's own menu items use, never a shadow or lift.
function SettingsRow({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center gap-3 border-b border-[var(--border-1)] px-5 py-4 no-underline transition-colors duration-150 last:border-b-0 hover:bg-[var(--surface-2)]"
    >
      <span
        className="flex shrink-0 items-center justify-center text-[var(--t2)]"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--t1)]">
          {title}
        </span>
        <span className="block text-xs leading-normal text-[var(--t3)]">
          {desc}
        </span>
      </span>
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="shrink-0 text-[var(--t3)]"
      >
        <path
          d="M6 3.5 10.5 8 6 12.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}

// Points display goes through lib/points (whole-Points unit model — wire
// integers ARE whole Points; never ÷100).
