"use client";

/**
 * MarketHead — the identity block at the top of /market/[ticker]
 * (P9.2, 2026-07-07 — Robinhood-structure pass).
 *
 *   Row 1: eyebrow — LIVE dot · CATEGORY · closes-in · close date
 *   Row 2: market question (28px)
 *   Row 3: sides strip — [● Yes · prob%]   8 pts — 92 pts   [prob% · No ●]
 *
 * The old pill rows (volume / trader count / ticker) are gone: volume
 * belongs to the discovery surfaces, machine tickers are plumbing, and
 * the countdown carries the only time-critical fact. Settled markets
 * swap the eyebrow for the outcome and keep the sides strip as a
 * historical record.
 *
 * Live countdown to closeAt — updates every 30s for a fresh but cheap
 * "closes in …" string.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { categoryLabel, localizedMarket } from "./market-content";
import { isOpenMarketStatus, marketStatusLabel } from "./market-display";

interface MarketHeadProps {
  market: PredictionMarket;
  categoryName?: string;
}

function formatCountdown(
  deltaMs: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (deltaMs <= 0) return t("CLOSED");
  const totalSec = Math.floor(deltaMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0)
    return t("CLOSES_IN_DHM", {
      days,
      hours: hours.toString().padStart(2, "0"),
      minutes: mins.toString().padStart(2, "0"),
    });
  if (hours > 0)
    return t("CLOSES_IN_HM", {
      hours,
      minutes: mins.toString().padStart(2, "0"),
    });
  return t("CLOSES_IN_M", { minutes: mins });
}

function formatCloseDate(iso: string): string {
  const d = new Date(iso);
  // QA fix ISSUE-007 (2026-07-26): the month came from LOCAL time while
  // the day/hours/mins came from UTC, so 2026-07-31T23:59Z rendered as
  // "AUG 31, 23:59 UTC" in any UTC+n timezone (local month rolls over,
  // UTC day doesn't) — contradicting the countdown beside it. Every
  // component of a "… UTC"-labeled stamp must read UTC.
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const hours = d.getUTCHours().toString().padStart(2, "0");
  const mins = d.getUTCMinutes().toString().padStart(2, "0");
  return `${month} ${day}, ${hours}:${mins} UTC`;
}

const MARKET_HEAD_CLASS = "flex h-full flex-col";
const MARKET_HEAD_EYEBROW_CLASS =
  "mb-4 flex flex-wrap items-center gap-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--t3)]";
const MARKET_HEAD_LIVE_CLASS =
  "inline-flex items-center gap-1.5 text-[var(--live-text)]";
const MARKET_HEAD_LIVE_DOT_CLASS =
  "h-[7px] w-[7px] rounded-full bg-[var(--live)]";
const MARKET_HEAD_SETTLED_CLASS =
  "font-mono inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.1em] text-[var(--t2)]";
const MARKET_HEAD_COUNTDOWN_CLASS =
  "font-mono text-[10px] text-[var(--t3)] [font-variant-numeric:tabular-nums]";
const MARKET_HEAD_TITLE_CLASS =
  "type-display m-0 mb-8 text-[32px] font-semibold leading-[1.12] tracking-[-0.03em] text-[var(--t1)] max-[720px]:mb-6 max-[720px]:text-[26px]";
const MARKET_HEAD_SIDES_CLASS =
  "mt-auto grid grid-cols-2 gap-3 border-t border-[var(--hairline)] pt-5";
const MARKET_HEAD_SIDE_CLASS =
  "min-w-0 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-3.5";
const MARKET_HEAD_SIDE_DOT_CLASS = "h-2.5 w-2.5 shrink-0 rounded-full";
const MARKET_HEAD_SIDE_NAME_CLASS =
  "text-xs font-semibold text-[var(--t1)] leading-tight";
const MARKET_HEAD_SIDE_SUB_CLASS =
  "font-mono whitespace-nowrap text-[10px] text-[var(--t3)] leading-tight [font-variant-numeric:tabular-nums]";
const MARKET_HEAD_PRICE_CLASS =
  "font-mono mt-3 whitespace-nowrap text-[26px] font-semibold leading-none tracking-[-0.04em] [font-variant-numeric:tabular-nums] max-[720px]:text-[22px] [&_small]:ml-1 [&_small]:text-[13px] [&_small]:font-semibold [&_small]:tracking-normal";

export default function MarketHead({ market, categoryName }: MarketHeadProps) {
  const { t } = useTranslation("prediction");
  const { t: contentT } = useTranslation("market-content");
  const displayMarket = localizedMarket(contentT, market);
  const displayCategory = categoryName
    ? categoryLabel(contentT, categoryName)
    : "";
  const closeAtMs = useMemo(
    () => new Date(displayMarket.closeAt).getTime(),
    [displayMarket.closeAt],
  );
  const [now, setNow] = useState<number>(() => Date.now());
  // Live-dot beat (1C motion doctrine): the dot beats ONCE per real
  // market event — price or volume actually changed — never on a loop.
  // First render is a mount, not a movement.
  const [dotBeat, setDotBeat] = useState(false);
  const beatSnapshotRef = useRef<string | null>(null);
  useEffect(() => {
    const snapshot = `${market.yesPricePoints}|${market.noPricePoints}|${market.volumePoints}`;
    if (beatSnapshotRef.current === null) {
      beatSnapshotRef.current = snapshot;
      return;
    }
    if (beatSnapshotRef.current === snapshot) return;
    beatSnapshotRef.current = snapshot;
    setDotBeat(true);
    const timer = window.setTimeout(() => setDotBeat(false), 650);
    return () => window.clearTimeout(timer);
  }, [market.yesPricePoints, market.noPricePoints, market.volumePoints]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const countdown = formatCountdown(closeAtMs - now, t);
  const isLive = isOpenMarketStatus(displayMarket.status);
  const isSettled = displayMarket.status === "settled";
  const lifecycleLabel = marketStatusLabel(displayMarket.status, t);
  const settledLabel = isSettled
    ? displayMarket.result === "yes"
      ? t("SETTLED_YES_WINS")
      : displayMarket.result === "no"
        ? t("SETTLED_NO_WINS")
        : t("SETTLED")
    : null;

  // Step 3 / UAT-006 (Settlement 12a/12b): once settled, the sides strip
  // is a HISTORICAL RECORD — final settlement prices (100/0), never the
  // last-traded probabilities, which read as a still-live market. Voids
  // have no settlement price and keep the last trade as the record.
  const finalYes =
    displayMarket.result === "yes"
      ? 100
      : displayMarket.result === "no"
        ? 0
        : null;
  const yes =
    isSettled && finalYes !== null ? finalYes : displayMarket.yesPricePoints;
  const no =
    isSettled && finalYes !== null ? 100 - finalYes : displayMarket.noPricePoints;

  return (
    <section className={MARKET_HEAD_CLASS}>
      <div className={MARKET_HEAD_EYEBROW_CLASS}>
        {isLive && (
          <span className={MARKET_HEAD_LIVE_CLASS}>
            <span
              className={`${MARKET_HEAD_LIVE_DOT_CLASS} ${dotBeat ? "live-dot-beat" : ""}`}
              aria-hidden="true"
            />
            {t("LIVE")}
          </span>
        )}
        {/* settledLabel already reads "Settled · NO wins" — render it alone
            so the eyebrow shows exactly one status token. */}
        {isSettled && settledLabel && (
          <span className={MARKET_HEAD_SETTLED_CLASS}>{settledLabel}</span>
        )}
        {displayCategory && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-[var(--accent-text)]">{displayCategory}</span>
          </>
        )}
        {/* For settled markets the settled badge above already carries the
            status — repeating lifecycleLabel here rendered a third
            "Settled" token. Other non-live statuses (halted/closed/…) keep
            the lifecycle label as their only status. */}
        {!isSettled && (
          <>
            <span aria-hidden="true">·</span>
            <span className={MARKET_HEAD_COUNTDOWN_CLASS}>
              {isLive ? (
                <>
                  {countdown}
                  <span className="mx-1.5 text-[var(--t4)]">·</span>
                  {formatCloseDate(displayMarket.closeAt)}
                </>
              ) : (
                lifecycleLabel
              )}
            </span>
          </>
        )}
      </div>

      <h1 className={MARKET_HEAD_TITLE_CLASS}>{displayMarket.title}</h1>

      {/* biome-ignore lint/a11y/useSemanticElements: labeled control group; fieldset/legend swap is queued for the P2 primitives pass */}
      <div
        role="group"
        className={MARKET_HEAD_SIDES_CLASS}
        aria-label={
          isSettled
            ? t("FINAL_PRICES", {
                yes,
                no,
                defaultValue: `Final prices: Yes ${yes} points, No ${no} points`,
              })
            : t("YES_NO_PRICES", {
                yes,
                no,
                defaultValue: `Yes ${yes} points, No ${no} points`,
              })
        }
      >
        <div className={MARKET_HEAD_SIDE_CLASS}>
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`${MARKET_HEAD_SIDE_DOT_CLASS} bg-[var(--yes-bar)]`}
              aria-hidden="true"
            />
            <span className={MARKET_HEAD_SIDE_NAME_CLASS}>{t("YES")}</span>
          </div>
          <div className={`${MARKET_HEAD_PRICE_CLASS} text-[var(--yes-text)]`}>
            {yes}
            <small>{t("PTS", "pts")}</small>
          </div>
          <span className={`${MARKET_HEAD_SIDE_SUB_CLASS} mt-1 block`}>
            {yes}% {t("PROB")}
          </span>
        </div>
        <div className={`${MARKET_HEAD_SIDE_CLASS} text-right`}>
          <div className="flex min-w-0 items-center justify-end gap-2">
            <span className={MARKET_HEAD_SIDE_NAME_CLASS}>{t("NO")}</span>
            <span
              className={`${MARKET_HEAD_SIDE_DOT_CLASS} bg-[var(--no-bar)]`}
              aria-hidden="true"
            />
          </div>
          <div className={`${MARKET_HEAD_PRICE_CLASS} text-[var(--no-text)]`}>
            {no}
            <small>{t("PTS", "pts")}</small>
          </div>
          <span className={`${MARKET_HEAD_SIDE_SUB_CLASS} mt-1 block`}>
            {no}% {t("PROB")}
          </span>
        </div>
      </div>
    </section>
  );
}
