"use client";

/**
 * MarketHead — the identity block at the top of /market/[ticker].
 *
 *   Row 1: market image · status dot · category · closes-in
 *   Row 2: market question
 *   Row 3: the YES chance as the hero number, with both side prices
 *
 * Settled markets swap the status for the outcome and show final
 * settlement prices (100/0) as the historical record.
 *
 * Live countdown to closeAt — updates every 30s for a fresh but cheap
 * "closes in …" string.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { categoryLabel, localizedMarket } from "./market-content";
import { isOpenMarketStatus, marketStatusLabel } from "./market-display";
import { MarketThumb } from "./MarketThumb";

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

const MARKET_HEAD_CLASS = "flex flex-col";
const MARKET_HEAD_META_CLASS =
  "m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-[var(--t3)]";
const MARKET_HEAD_LIVE_CLASS =
  "inline-flex items-center gap-1.5 font-semibold text-[var(--live-text)]";
const MARKET_HEAD_LIVE_DOT_CLASS =
  "h-[7px] w-[7px] rounded-full bg-[var(--live)]";
const MARKET_HEAD_SETTLED_CLASS =
  "inline-flex items-center gap-1.5 font-semibold text-[var(--t1)]";
const MARKET_HEAD_COUNTDOWN_CLASS = "tabular-nums";
const MARKET_HEAD_TITLE_CLASS =
  "type-display m-0 mt-1 text-[28px] font-semibold leading-[1.2] tracking-[-0.025em] text-[var(--t1)] max-[720px]:text-[22px]";
const MARKET_HEAD_SIDES_CLASS =
  "mt-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3";
const MARKET_HEAD_CHANCE_CLASS =
  "text-[44px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-[var(--t1)] max-[720px]:text-[36px]";
const MARKET_HEAD_LEGEND_CLASS =
  "flex items-center gap-5 pb-1 text-[14px] text-[var(--t2)]";
const MARKET_HEAD_SIDE_DOT_CLASS = "h-2 w-2 shrink-0 rounded-full";

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

  const chance = Math.max(0, Math.min(100, Math.round(yes)));

  return (
    <section className={MARKET_HEAD_CLASS}>
      <div className="flex items-start gap-4">
        <MarketThumb
          categorySlug={displayMarket.categorySlug}
          imageUrl={displayMarket.imagePath || displayMarket.imageUrl || displayMarket.image_url}
          size={56}
          className="max-[720px]:hidden"
        />
        <div className="min-w-0 flex-1">
          <p className={MARKET_HEAD_META_CLASS}>
            {isLive && (
              <span className={MARKET_HEAD_LIVE_CLASS}>
                <span
                  className={`${MARKET_HEAD_LIVE_DOT_CLASS} ${dotBeat ? "live-dot-beat" : ""}`}
                  aria-hidden="true"
                />
                {t("LIVE")}
              </span>
            )}
            {/* settledLabel already reads "Settled · NO wins" — render it
                alone so the line shows exactly one status token. */}
            {isSettled && settledLabel && (
              <span className={MARKET_HEAD_SETTLED_CLASS}>{settledLabel}</span>
            )}
            {displayCategory && (
              <>
                <span aria-hidden="true">·</span>
                <span>{displayCategory}</span>
              </>
            )}
            {/* Settled markets already carry their status above; other
                non-live statuses (halted/closed/…) show the lifecycle
                label as their only status. */}
            {!isSettled && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={MARKET_HEAD_COUNTDOWN_CLASS}
                  title={isLive ? formatCloseDate(displayMarket.closeAt) : undefined}
                >
                  {isLive ? countdown : lifecycleLabel}
                </span>
              </>
            )}
          </p>
          <h1 className={MARKET_HEAD_TITLE_CLASS}>{displayMarket.title}</h1>
        </div>
      </div>

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
        <div className="flex items-baseline gap-2">
          <span className={MARKET_HEAD_CHANCE_CLASS}>{chance}%</span>
          <span className="text-[15px] font-medium text-[var(--t3)]">
            {t("CHANCE", "chance")}
          </span>
        </div>
        <div className={MARKET_HEAD_LEGEND_CLASS}>
          <span className="inline-flex items-center gap-2">
            <span
              className={`${MARKET_HEAD_SIDE_DOT_CLASS} bg-[var(--yes)]`}
              aria-hidden="true"
            />
            {t("YES")}
            <strong className="font-semibold tabular-nums text-[var(--yes-text)]">
              {t("PTS_COUNT", { count: yes })}
            </strong>
          </span>
          <span className="inline-flex items-center gap-2">
            <span
              className={`${MARKET_HEAD_SIDE_DOT_CLASS} bg-[var(--no)]`}
              aria-hidden="true"
            />
            {t("NO")}
            <strong className="font-semibold tabular-nums text-[var(--no-text)]">
              {t("PTS_COUNT", { count: no })}
            </strong>
          </span>
        </div>
      </div>
    </section>
  );
}
