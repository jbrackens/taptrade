"use client";

/**
 * AccountPage — the player's profile (the avatar menu's "Account").
 *
 * Laid out like Polymarket's profile, on TapTrade's own data:
 *   [identity: avatar, name, joined; available points, positions value,
 *    predictions; settled result and accuracy]  [settled-result chart]
 *   [Positions (active / closed) | Activity] — rows carry the market's
 *    image tile, as the board's cards do
 *   [Settings shortcuts]
 *
 * Every number is real: wallet balance, positions valued at today's price,
 * the settled history (which also draws the chart), and recent orders.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BellRingingIcon as Bell } from "@phosphor-icons/react/dist/csr/BellRinging";
import { HandHeartIcon as HeartHandshake } from "@phosphor-icons/react/dist/csr/HandHeart";
import { ShieldCheckIcon as Lock } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { PencilSimpleIcon as Pencil } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { ReceiptIcon as ReceiptText } from "@phosphor-icons/react/dist/csr/Receipt";
import { UserCircleIcon as UserRound } from "@phosphor-icons/react/dist/csr/UserCircle";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type {
  PortfolioSummary,
  Position,
  PredictionMarket,
  PredictionOrder,
  SettledPositionResult,
} from "@taptrade-ui/api-client/src/prediction-types";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import { useAuth } from "../hooks/useAuth";
import { logger } from "../lib/logger";
import { getBalance } from "../lib/api/wallet-client";
import type { Balance } from "../lib/api/wallet-client";
import { getProfile } from "../lib/api/user-client";
import type { UserProfile } from "../lib/api/user-client";
import { FEATURE_RG } from "../lib/features";
import { formatPoints } from "../lib/points";
import { IconTile } from "../components/account/IconTile";
import { ProfileAvatar } from "../components/account/ProfileAvatar";
import { ProfileTabs } from "../components/account/ProfileTabs";
import { ResultChart } from "../components/account/ResultChart";
import {
  positionMark,
  type ResultPeriod,
  seriesForPeriod,
  settledResultSeries,
} from "../components/account/profile-data";

const api = createPredictionClient();

// Cards share the board's recipe: 12px radius, hairline, a whisper of shadow.
const CARD_CLASS =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] shadow-[var(--shadow-card)]";
const HISTORY_PAGE_SIZE = 200;
const HISTORY_MAX_PAGES = 5;

export default function AccountPage() {
  const { t } = useTranslation("account");
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [history, setHistory] = useState<SettledPositionResult[]>([]);
  const [orders, setOrders] = useState<PredictionOrder[]>([]);
  const [marketsById, setMarketsById] = useState<Map<string, PredictionMarket>>(new Map());
  const [loading, setLoading] = useState(true);
  const [positionsFailed, setPositionsFailed] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const userId = user.id;

    async function loadHistory(): Promise<SettledPositionResult[]> {
      const rows: SettledPositionResult[] = [];
      for (let page = 1; page <= HISTORY_MAX_PAGES; page++) {
        const res = await api.getSettledPositions(page, HISTORY_PAGE_SIZE);
        rows.push(...res.data);
        if (!res.meta?.hasNext) break;
      }
      return rows;
    }

    async function load() {
      const [profileRes, balanceRes, summaryRes, positionsRes, historyRes, ordersRes] =
        await Promise.allSettled([
          getProfile(userId),
          getBalance(userId),
          api.getPortfolioSummary(),
          api.getPositions(),
          loadHistory(),
          api.getOrders({ page: 1, pageSize: 25 }),
        ]);
      if (cancelled) return;

      const settled = <T,>(res: PromiseSettledResult<T>, what: string): T | null => {
        if (res.status === "fulfilled") return res.value;
        logger.warn("Account", `${what} fetch failed`, res.reason);
        return null;
      };
      const nextPositions = settled(positionsRes, "positions") ?? [];
      setPositionsFailed(positionsRes.status === "rejected");
      const nextHistory = settled(historyRes, "settled history") ?? [];
      const nextOrders = settled(ordersRes, "orders")?.data ?? [];
      setProfile(settled(profileRes, "profile"));
      setBalance(settled(balanceRes, "balance"));
      setSummary(settled(summaryRes, "portfolio summary"));
      setPositions(nextPositions);
      setHistory(nextHistory);
      setOrders(nextOrders);

      // One GET /markets?ids= per 50 ids (the gateway cap) so every row can
      // show its market's title and image tile.
      const ids = [
        ...new Set([
          ...nextPositions.filter((p) => p.quantity > 0).map((p) => p.marketId),
          ...nextHistory.map((h) => h.marketId),
          ...nextOrders.map((o) => o.marketId),
        ]),
      ];
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
      const pages = await Promise.all(
        chunks.map((chunk) =>
          api
            .getMarkets({ ids: chunk, pageSize: chunk.length, sort: "newest" })
            .catch((err: unknown) => {
              logger.warn("Account", "market hydrate failed", err);
              return null;
            }),
        ),
      );
      if (cancelled) return;
      const map = new Map<string, PredictionMarket>();
      for (const page of pages) for (const m of page?.data ?? []) map.set(m.id, m);
      setMarketsById(map);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const displayName = useMemo(() => {
    const full = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim();
    return full || profile?.username || user?.username || "";
  }, [profile, user?.username]);

  // Positions valued at today's price; a market that failed to load counts
  // at cost rather than vanishing from the total, and if the positions
  // themselves failed, the summary's cost basis stands in.
  const positionsValue = useMemo(() => {
    if (positionsFailed) return summary ? summary.totalValuePoints : undefined;
    let sum = 0;
    for (const p of positions) {
      if (!(p.quantity > 0)) continue;
      sum += positionMark(p, marketsById.get(p.marketId)).value ?? p.totalCostPoints;
    }
    return sum;
  }, [positions, marketsById, positionsFailed, summary]);

  return (
    <div className="mx-auto max-w-[1080px] px-6 pb-16 pt-6 max-[640px]:px-4">
      <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
        <IdentityCard
          name={displayName}
          handle={profile?.username || user?.username || ""}
          joinedAt={profile?.createdAt}
          available={balance?.availableBalance}
          positionsValue={loading ? undefined : positionsValue}
          summary={summary}
        />
        <ResultCard history={history} loading={loading} />
      </div>

      <div className="mt-8">
        <ProfileTabs
          positions={positions}
          history={history}
          orders={orders}
          marketsById={marketsById}
          loading={loading}
        />
      </div>

      <section className="mt-10" aria-labelledby="account-settings-heading">
        <h2 id="account-settings-heading" className="m-0 mb-3 text-[17px] font-semibold text-[var(--t1)]">
          {t("hub.settings", "Settings")}
        </h2>
        {/* A 1px gap over the hairline colour draws the dividers; an odd last
         * tile spans both columns so no empty cell shows. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--border-1)] shadow-[var(--shadow-card)] max-[720px]:grid-cols-1">
          <SettingsLink
            href="/account/settings"
            icon={UserRound}
            title={t("actions.profile.title", "Profile")}
            desc={t("actions.profile.desc", "Your details, language and privacy")}
          />
          <SettingsLink
            href="/account/transactions"
            icon={ReceiptText}
            title={t("actions.points.title", "Clout history")}
            desc={t("actions.points.desc", "Starter grants, predictions, and rewards")}
          />
          <SettingsLink
            href="/account/security"
            icon={Lock}
            title={t("actions.security.title", "Security")}
            desc={t("actions.security.desc", "Password, sessions, and sign-in protection")}
          />
          <SettingsLink
            href="/account/notifications"
            icon={Bell}
            title={t("actions.alerts.title", "Alerts")}
            desc={t("actions.alerts.desc", "Control market and account notifications")}
          />
          {FEATURE_RG && (
            <SettingsLink
              href="/responsible-gaming"
              icon={HeartHandshake}
              title={t("actions.responsible.title", "Play responsibly")}
              desc={t("actions.responsible.desc", "Play limits, cool-offs, and self-exclusion")}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function IdentityCard({
  name,
  handle,
  joinedAt,
  available,
  positionsValue,
  summary,
}: {
  name: string;
  handle: string;
  joinedAt?: string;
  available?: number;
  positionsValue?: number;
  summary: PortfolioSummary | null;
}) {
  const { t, i18n } = useTranslation("account");
  const joined = joinedAt ? new Date(joinedAt) : null;
  const joinedLabel =
    joined && !Number.isNaN(joined.getTime())
      ? t("profile.joined", {
          date: joined.toLocaleDateString(i18n.language || "en", { month: "short", year: "numeric" }),
          defaultValue: `Joined ${joined.toLocaleDateString("en", { month: "short", year: "numeric" })}`,
        })
      : null;
  const settled = summary ? summary.realizedPoints : 0;
  const settledUp = settled >= 0;
  const hasSettled = (summary?.totalPredictions ?? 0) > 0;

  return (
    <section className={`${CARD_CLASS} flex flex-col p-5`} aria-labelledby="profile-name">
      <div className="flex items-start gap-4">
        <ProfileAvatar name={name || handle} />
        <div className="min-w-0 flex-1 pt-1">
          <h1 id="profile-name" className="m-0 truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[var(--t1)]">
            {name || "—"}
          </h1>
          <p className="m-0 mt-1 truncate text-[13px] text-[var(--t3)]">
            {[name !== handle ? handle : null, joinedLabel].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Link
          href="/account/settings"
          aria-label={t("profile.edit", "Edit profile")}
          title={t("profile.edit", "Edit profile")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--r-rh-md)] border border-[var(--border-1)] text-[var(--t2)] transition-colors duration-150 hover:border-[var(--border-2)] hover:text-[var(--t1)] max-[640px]:h-11 max-[640px]:w-11"
        >
          <Pencil size={16} weight="duotone" aria-hidden="true" />
        </Link>
      </div>

      <dl className="m-0 mt-5 grid grid-cols-3 divide-x divide-[var(--border-1)] text-center">
        <Stat label={t("stats.available", "Available")} value={available !== undefined ? formatPoints(available) : "—"} />
        <Stat
          label={t("stats.positionsValue", "Positions value")}
          value={positionsValue !== undefined ? formatPoints(positionsValue) : "—"}
        />
        <Stat
          label={t("stats.predictions", "Predictions")}
          value={summary ? summary.totalPredictions.toLocaleString() : "—"}
        />
      </dl>

      <dl className="m-0 mt-5 border-t border-[var(--border-1)] pt-3 text-[13px]">
        <div className="flex items-center justify-between py-1">
          <dt className="text-[var(--t2)]">{t("stats.realizedPnl", "Settled result")}</dt>
          {/* The one direction colour in this card: a settled result is an
           * outcome. Everything else is a neutral magnitude. */}
          <dd
            className={`m-0 font-semibold tabular-nums ${
              hasSettled ? (settledUp ? "text-[var(--yes-text)]" : "text-[var(--no-text)]") : "text-[var(--t1)]"
            }`}
          >
            {hasSettled ? `${settledUp ? "+" : "−"}${formatPoints(Math.abs(settled))}` : "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between py-1">
          <dt className="text-[var(--t2)]">{t("stats.accuracy", "Accuracy")}</dt>
          <dd className="m-0 font-semibold tabular-nums text-[var(--t1)]">
            {summary && hasSettled
              ? t("stats.accuracyValue", {
                  pct: summary.accuracyPct.toFixed(0),
                  correct: summary.correctPredictions,
                  total: summary.totalPredictions,
                  defaultValue: `${summary.accuracyPct.toFixed(0)}% · ${summary.correctPredictions} of ${summary.totalPredictions}`,
                })
              : t("stats.noSettledMarkets", "No settled markets yet")}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    // Value above label, visually; the markup keeps dt before dd.
    <div className="flex min-w-0 flex-col-reverse px-2 first:pl-0 last:pr-0">
      <dt className="mt-0.5 truncate text-[12px] text-[var(--t3)]">{label}</dt>
      <dd className="m-0 truncate text-[17px] font-semibold tabular-nums tracking-[-0.01em] text-[var(--t1)]">{value}</dd>
    </div>
  );
}

const PERIODS: { id: ResultPeriod; key: string; fallback: string; caption: string; captionFallback: string }[] = [
  { id: "1w", key: "chart.period.1w", fallback: "1W", caption: "chart.caption.1w", captionFallback: "Past week" },
  { id: "1m", key: "chart.period.1m", fallback: "1M", caption: "chart.caption.1m", captionFallback: "Past month" },
  { id: "all", key: "chart.period.all", fallback: "All", caption: "chart.caption.all", captionFallback: "All time" },
];

function ResultCard({ history, loading }: { history: SettledPositionResult[]; loading: boolean }) {
  const { t } = useTranslation("account");
  const [period, setPeriod] = useState<ResultPeriod>("all");
  const series = useMemo(() => settledResultSeries(history), [history]);
  const { points, change } = useMemo(() => seriesForPeriod(series, period, Date.now()), [series, period]);
  const up = change >= 0;
  const current = PERIODS.find((p) => p.id === period) ?? PERIODS[2];

  return (
    <section className={`${CARD_CLASS} flex flex-col p-5`} aria-labelledby="result-card-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="result-card-title" className="m-0 flex items-center gap-1.5 text-[13px] font-medium text-[var(--t2)]">
            <span
              className={`h-2 w-2 rounded-full ${series.length === 0 ? "bg-[var(--t4)]" : up ? "bg-[var(--dir-yes)]" : "bg-[var(--dir-no)]"}`}
              aria-hidden="true"
            />
            {t("stats.realizedPnl", "Settled result")}
          </h2>
          <p
            className={`m-0 mt-1 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${
              series.length === 0 ? "text-[var(--t1)]" : up ? "text-[var(--yes-text)]" : "text-[var(--no-text)]"
            }`}
          >
            {loading ? "—" : `${up ? "+" : "−"}${formatPoints(Math.abs(change))}`}
          </p>
          <p className="m-0 mt-1.5 text-[12px] text-[var(--t3)]">{t(current.caption, current.captionFallback)}</p>
        </div>
        <fieldset className="m-0 inline-flex min-w-0 gap-0.5 rounded-[var(--r-rh-md)] border-0 bg-[var(--surface-2)] p-0.5">
          <legend className="sr-only">{t("chart.periodLabel", "Period")}</legend>
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={period === p.id}
              onClick={() => setPeriod(p.id)}
              className={`min-h-7 pointer-coarse:min-h-11 cursor-pointer rounded-[var(--r-rh-sm)] border-0 px-2.5 text-[12px] font-semibold transition-colors duration-150 max-[640px]:min-h-9 ${
                period === p.id
                  ? "bg-[var(--surface-1)] text-[var(--t1)] shadow-[var(--shadow-card)]"
                  : "bg-transparent text-[var(--t3)] hover:text-[var(--t1)]"
              }`}
            >
              {t(p.key, p.fallback)}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="mt-auto pt-5">
        {loading ? (
          <div className="h-[120px] animate-pulse rounded-[var(--r-rh-md)] bg-[var(--surface-2)]" aria-hidden="true" />
        ) : points.length >= 2 ? (
          <ResultChart points={points} up={up} label={t("chart.label", "Settled result over time")} />
        ) : (
          <div className="grid h-[120px] place-items-center rounded-[var(--r-rh-md)] bg-[var(--surface-2)] px-6 text-center text-[13px] text-[var(--t3)]">
            {t("chart.empty", "Your result charts here once a market you hold settles.")}
          </div>
        )}
      </div>
    </section>
  );
}

function SettingsLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: PhosphorIcon;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center gap-3 bg-[var(--surface-1)] px-5 py-4 no-underline transition-colors duration-150 last:odd:col-span-2 hover:bg-[var(--surface-2)] max-[720px]:last:odd:col-span-1"
    >
      <IconTile icon={icon} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--t1)]">{title}</span>
        <span className="block truncate text-xs leading-normal text-[var(--t3)]">{desc}</span>
      </span>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-[var(--t3)]">
        <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
