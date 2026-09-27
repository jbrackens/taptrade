"use client";

/**
 * ActivityRail — proof of life on the board: the day's biggest movers and
 * the latest real fills, from GET /api/v1/activity/recent. Renders nothing
 * at all when the exchange is quiet; it never invents a signal.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getRecentActivity, type RecentActivity } from "../../lib/api/activity-client";

const REFRESH_MS = 30_000;
const MAX_TRADES = 6;
const MAX_MOVERS = 4;

function ago(iso: string, now: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return t("ACTIVITY_JUST_NOW", { defaultValue: "just now" });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("ACTIVITY_MIN_AGO", { count: minutes, defaultValue: `${minutes}m ago` });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("ACTIVITY_HOUR_AGO", { count: hours, defaultValue: `${hours}h ago` });
  const days = Math.round(hours / 24);
  return t("ACTIVITY_DAY_AGO", { count: days, defaultValue: `${days}d ago` });
}

export function ActivityRail() {
  const { t } = useTranslation("prediction");
  const { data } = useQuery<RecentActivity>({
    queryKey: ["activity", "recent"],
    queryFn: () => getRecentActivity(20),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  });
  const trades = data?.trades ?? [];
  const movers = data?.movers ?? [];
  if (trades.length === 0 && movers.length === 0) return null;
  const now = Date.now();

  return (
    <section
      data-testid="activity-rail"
      aria-labelledby="activity-rail-heading"
      className="mb-8 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-3.5 shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-[var(--live)]" aria-hidden="true" />
        <h2 id="activity-rail-heading" className="m-0 text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--t2)]">
          {t("ACTIVITY_TITLE", "Live now")}
        </h2>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-2 max-[900px]:grid-cols-1">
        {movers.length > 0 && (
          <ul className="m-0 flex list-none flex-col divide-y divide-[var(--border-1)] p-0">
            <li className="pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--t3)]">
              {t("ACTIVITY_MOVERS", "Moving today")}
            </li>
            {movers.slice(0, MAX_MOVERS).map((m) => {
              const up = m.changePoints > 0;
              return (
                <li key={m.marketId} className="flex items-center gap-3 py-1.5">
                  <Link href={`/market/${m.ticker}`} className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--t1)] no-underline hover:underline">
                    {m.title}
                  </Link>
                  <span className="shrink-0 text-[13px] tabular-nums text-[var(--t2)]">
                    {m.yesFrom}% → <span className="font-semibold text-[var(--t1)]">{m.yesTo}%</span>
                  </span>
                  <span className={`shrink-0 text-[12px] font-semibold tabular-nums ${up ? "text-[var(--yes-text)]" : "text-[var(--no-text)]"}`}>
                    <span aria-hidden="true">{up ? "▲" : "▼"} {Math.abs(m.changePoints)}</span>
                    <span className="sr-only">
                      {t(up ? "ACTIVITY_UP_BY" : "ACTIVITY_DOWN_BY", { count: Math.abs(m.changePoints), defaultValue: `${up ? "up" : "down"} ${Math.abs(m.changePoints)}` })}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {trades.length > 0 && (
          <ul className="m-0 flex list-none flex-col divide-y divide-[var(--border-1)] p-0">
            <li className="pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--t3)]">
              {t("ACTIVITY_RECENT", "Recent calls")}
            </li>
            {trades.slice(0, MAX_TRADES).map((tr) => (
              <li key={`${tr.marketId}-${tr.tradedAt}-${tr.pricePoints}-${tr.quantity}`} className="flex items-center gap-3 py-1.5">
                <span
                  className={`shrink-0 rounded-[var(--r-rh-md)] px-1.5 py-0.5 text-[12px] font-semibold tabular-nums ${
                    tr.side === "yes" ? "bg-[var(--yes-soft)] text-[var(--yes-text)]" : "bg-[var(--no-soft)] text-[var(--no-text)]"
                  }`}
                >
                  {tr.side === "yes" ? t("YES") : t("NO")} {tr.pricePoints}%
                </span>
                <Link href={`/market/${tr.ticker}`} className="min-w-0 flex-1 truncate text-[13px] text-[var(--t1)] no-underline hover:underline">
                  {tr.title}
                </Link>
                <span className="shrink-0 text-[12px] tabular-nums text-[var(--t3)]">{ago(tr.tradedAt, now, t)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
