"use client";

/**
 * PortfolioPage — positions, orders, settled results.
 *
 * Layout (matches DESIGN.md tokens):
 *   [summary strip — 4 stat cards]
 *   [tab bar — Positions · Orders · History]
 *   [table for the active tab]
 *
 * Positions and orders reference markets by UUID; we hydrate the
 * distinct set of IDs once per load so the table shows ticker + title
 * instead of a truncated hex string.
 *
 * Any of the four fetches may 401 on a fresh session (the gateway
 * protects portfolio/orders). We surface a single friendly empty
 * state rather than cascading errors.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card } from "../components/ui";
import { PointsFlow } from "../components/ui/PointsFlow";
import { useTranslation } from "react-i18next";
import { logger } from "../lib/logger";
import type {
  Position,
  PortfolioSummary,
  PredictionOrder,
  PredictionMarket,
  SettledPositionResult,
  OrderStatus,
} from "@taptrade-ui/api-client/src/prediction-types";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import {
  getUserStanding,
  type LeaderboardEntry,
} from "../lib/api/leaderboards-client";
import { useToast } from "../components/ToastProvider";
import { localizedMarket } from "../components/prediction/market-content";
import { formatPoints } from "../lib/points";

const api = createPredictionClient();

type TabKey = "positions" | "orders" | "history";

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const MONO =
  "font-mono [font-variant-numeric:tabular-nums]";
// Stat-tile shell lives on the Card primitive now; the tile's own density
// (px-[18px] py-4) and layout stay per-usage below.
const STAT_TILE_LAYOUT =
  "relative flex min-w-0 flex-col gap-1 px-[18px] py-4 text-[var(--t1)] no-underline font-sans";
// Micro-label: mono, uppercase, tracked wide (DESIGN.md §4 eyebrow spec).
const STAT_LABEL =
  "font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--t3)]";
// Hero figure: mono-wide (112.5 width axis) — every comparable numeral in
// the summary strip is Martian Mono, and this is the page's headline data.
const STAT_VALUE = cx(
  MONO,
  "mono-wide truncate text-[22px] font-semibold tracking-normal text-[var(--t1)]",
);
const STAT_SUB = "text-[11px] text-[var(--t3)]";
const DIM_TEXT = "text-[var(--t3)]";
// Step 4 (11a-c): the 6-8 column tables are cards now — the audience is
// mobile-majority, and a table that wide never fit 390px.
const CARD_GRID = "grid grid-cols-2 gap-3 max-[900px]:grid-cols-1";
// Phosphor "lock-fill", copied VERBATIM from
// design_handoff_taptrade/logos/phosphor-paths.json (MIT; filled 256 grid).
const PHOSPHOR_LOCK_FILL =
  "M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80Zm-80,84a12,12,0,1,1,12-12A12,12,0,0,1,128,164Zm32-84H96V56a32,32,0,0,1,64,0Z";
// Login CTA and Add Points moved onto the Button primitive (bespoke
// gradient/glow recipes dropped deliberately).

export default function PortfolioPage() {
  const { t } = useTranslation("portfolio");
  const { t: tStore } = useTranslation("store");
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<PredictionOrder[]>([]);
  const [history, setHistory] = useState<SettledPositionResult[]>([]);
  const [marketsById, setMarketsById] = useState<Map<string, PredictionMarket>>(
    () => new Map(),
  );
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("positions");
  const [authError, setAuthError] = useState(false);
  // Loyalty surfaces: bestRank drives the rank chip. Settlement-history point
  // totals come from the portfolio history settlement row itself.
  const [bestRank, setBestRank] = useState<LeaderboardEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const results = await Promise.allSettled([
        api.getPositions(),
        api.getPortfolioSummary(),
        api.getOrders({ page: 1, pageSize: 50 }),
        api.getSettledPositions(1, 20),
        // Loyalty surfaces are ambient: failures never block the portfolio.
        getUserStanding().catch(() => [] as LeaderboardEntry[]),
      ]);
      if (cancelled) return;

      let sawAuthError = false;
      const [posRes, sumRes, ordRes, histRes, standingRes] = results;

      if (posRes.status === "fulfilled") setPositions(posRes.value);
      else if (is401(posRes.reason)) sawAuthError = true;
      else logger.warn("Portfolio", "positions fetch failed", posRes.reason);

      if (sumRes.status === "fulfilled") setSummary(sumRes.value);
      else if (is401(sumRes.reason)) sawAuthError = true;
      else logger.warn("Portfolio", "summary fetch failed", sumRes.reason);

      if (ordRes.status === "fulfilled") setOrders(ordRes.value.data);
      else if (is401(ordRes.reason)) sawAuthError = true;
      else logger.warn("Portfolio", "orders fetch failed", ordRes.reason);

      if (histRes.status === "fulfilled") setHistory(histRes.value.data);
      else if (is401(histRes.reason)) sawAuthError = true;
      else logger.warn("Portfolio", "history fetch failed", histRes.reason);

      // Rank chip: plan §1 says "user's best board rank". Entries are
      // already sorted rank-ascending by the server.
      if (standingRes.status === "fulfilled" && standingRes.value.length > 0) {
        setBestRank(standingRes.value[0]);
      }

      if (sawAuthError) setAuthError(true);

      // Hydrate distinct market IDs so the tables can render titles.
      const ids = new Set<string>();
      if (posRes.status === "fulfilled")
        posRes.value.forEach((p) => {
          ids.add(p.marketId);
        });
      if (ordRes.status === "fulfilled")
        ordRes.value.data.forEach((o) => {
          ids.add(o.marketId);
        });
      if (histRes.status === "fulfilled")
        histRes.value.data.forEach((h) => {
          ids.add(h.marketId);
        });

      if (ids.size > 0) {
        // Batched hydration: one GET /markets?ids= per 50 distinct ids (the
        // gateway cap) instead of one GET /markets/{id} per market — a single
        // request for typical portfolios. sort=newest keeps the query on the
        // cheap non-ranking shape; no status filter so settled markets
        // referenced by History still hydrate.
        const idList = [...ids];
        const chunks: string[][] = [];
        for (let i = 0; i < idList.length; i += 50) {
          chunks.push(idList.slice(i, i + 50));
        }
        const results = await Promise.all(
          chunks.map((chunk) =>
            api
              .getMarkets({
                ids: chunk,
                pageSize: chunk.length,
                sort: "newest",
              })
              .catch((err: unknown) => {
                logger.warn("Portfolio", "market hydrate failed", err);
                return null;
              }),
          ),
        );
        if (cancelled) return;
        const map = new Map<string, PredictionMarket>();
        for (const res of results) {
          for (const m of res?.data ?? []) map.set(m.id, m);
        }
        setMarketsById(map);
      }

      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeOrders = useMemo(
    () => orders.filter((o) => o.status === "open" || o.status === "partial"),
    [orders],
  );

  // Step 4: portfolio-level unrealized total for the summary strip.
  const totalUnrealized = useMemo(() => {
    if (positions.length === 0 || marketsById.size === 0) return null;
    let sum = 0;
    let sawMark = false;
    for (const p of positions) {
      const m = marketsById.get(p.marketId);
      if (!m) continue;
      sawMark = true;
      // Voided markets refund at cost: they contribute 0 unrealized.
      if (m.status === "voided") continue;
      const mark = p.side === "yes" ? m.yesPricePoints : m.noPricePoints;
      sum += p.quantity * mark - p.totalCostPoints;
    }
    return sawMark ? sum : null;
  }, [positions, marketsById]);

  const counts = useMemo(
    () => ({
      positions: positions.length,
      orders: activeOrders.length,
      history: history.length,
    }),
    [positions, activeOrders.length, history],
  );

  if (loading) {
    return <PageState>{t("state.loading", "Loading portfolio…")}</PageState>;
  }

  if (authError && !summary && positions.length === 0 && orders.length === 0) {
    return (
      <PageState>
        <div className="text-center">
          <p className="mb-3 text-[var(--t2)]">
            {t("state.signIn", "Sign in to see your portfolio.")}
          </p>
          <Button
            variant="primary"
            size="lg"
            render={<Link href="/auth/login" />}
          >
            {t("state.login", "Log in")}
          </Button>
        </div>
      </PageState>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] pb-[60px]">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="type-poster m-0 mb-1 text-[32px] text-[var(--t1)] max-[640px]:text-[26px]">
            {t("title", "Portfolio")}
          </h1>
          <p className="m-0 text-[13px] text-[var(--t3)]">
            {t("subtitle", "Open positions, active orders, settled results.")}
          </p>
        </div>
        <Button
          size="lg"
          className="shrink-0 text-[13px]"
          render={<Link href="/store" data-testid="add-points-portfolio" />}
        >
          {tStore("entry.addPoints", "Add Points")}
        </Button>
      </header>

      <SummaryStrip
        summary={summary}
        bestRank={bestRank}
        unrealized={totalUnrealized}
      />

      <TabBar tab={tab} setTab={setTab} counts={counts} />

      {tab === "positions" && (
        <PositionsTable positions={positions} marketsById={marketsById} />
      )}
      {tab === "orders" && (
        <OrdersTable
          orders={activeOrders}
          marketsById={marketsById}
          onCancelled={(orderID) =>
            setOrders((prev) =>
              prev.map((o) =>
                o.id === orderID
                  ? { ...o, status: "cancelled" as OrderStatus }
                  : o,
              ),
            )
          }
        />
      )}
      {tab === "history" && (
        <HistoryTable history={history} marketsById={marketsById} />
      )}
    </div>
  );
}

// ── Page-level state ────────────────────────────────────────────────────────

function PageState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-[13px] text-[var(--t3)]">
      {children}
    </div>
  );
}

// ── Summary strip ───────────────────────────────────────────────────────────

function SummaryStrip({
  summary,
  bestRank,
  unrealized,
}: {
  summary: PortfolioSummary | null;
  bestRank: LeaderboardEntry | null;
  /** Σ(qty × mark − cost) over hydrated positions; null until marks load. */
  unrealized: number | null;
}) {
  const { t } = useTranslation("portfolio");
  const s = summary;
  const pnl = s?.realizedPoints ?? 0;
  const pnlUp = pnl >= 0;
  const unrealUp = (unrealized ?? 0) >= 0;
  return (
    <section className="mb-6 grid grid-cols-5 gap-[14px] max-lg:grid-cols-3 max-[720px]:grid-cols-2">
      <StatCard
        label={t("summary.invested", "Invested")}
        value={s ? <PointsFlow value={s.totalValuePoints} suffix=" pts" /> : "—"}
      />
      {/* Step 4 (11a): Unrealized answers "am I up?" — the question the
          old Open-positions COUNT (redundant with the tab badge) didn't. */}
      <StatCard
        label={t("summary.unrealized", "Unrealized")}
        value={
          unrealized !== null
            ? `${unrealUp ? "+" : "−"}${formatPoints(Math.abs(unrealized))}`
            : "—"
        }
        tone={unrealized !== null ? (unrealUp ? "yes" : "no") : undefined}
      />
      <StatCard
        label={t("summary.realizedPnl", "Realized point result")}
        value={s ? `${pnlUp ? "+" : "−"}${formatPoints(Math.abs(pnl))}` : "—"}
        tone={s ? (pnlUp ? "yes" : "no") : undefined}
      />
      <StatCard
        label={t("summary.accuracy", "Accuracy")}
        value={
          s && s.totalPredictions > 0 ? `${s.accuracyPct.toFixed(1)}%` : "—"
        }
        sub={
          s && s.totalPredictions > 0
            ? t("summary.correctCount", "{{correct}}/{{total}} correct", {
                correct: s.correctPredictions,
                total: s.totalPredictions,
              })
            : t("summary.noSettledPredictions", "No settled predictions yet")
        }
      />
      <RankChip entry={bestRank} />
    </section>
  );
}

// RankChip — 5th stat slot in the portfolio summary strip. Plan §1: user's
// best-board rank, linking to /leaderboards pre-opened on that board. Plan §3
// "pre-qualified" state shows a muted "Not ranked yet" card rather than
// omitting the slot (keeps the grid stable across users).
function RankChip({ entry }: { entry: LeaderboardEntry | null }) {
  const { t } = useTranslation("portfolio");
  const href = entry
    ? `/leaderboards?board=${encodeURIComponent(entry.boardId)}`
    : "/leaderboards";
  return (
    <Link
      href={href}
      // Card can't render an anchor, so the interactive tile keeps the
      // shell classes inline on the Link.
      className={cx(
        "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)]",
        STAT_TILE_LAYOUT,
        "border-[var(--pending-border)] bg-[var(--accent-soft)] transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-[var(--accent-lo)] focus-visible:border-[var(--accent-lo)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]",
      )}
      aria-label={rankAriaLabel(entry)}
    >
      <span className={STAT_LABEL}>
        {entry ? formatBoardLabel(entry.boardId, t) : t("rank.label", "Rank")}
      </span>
      {/* 2026-07-12: the card is titled with the board name (e.g. "Weekly
          point result"), so the RESULT is the headline value; the rank
          moves to the sub-line. Previously "#1" rendered as the value of
          a card labeled "Weekly point result". */}
      <span className={STAT_VALUE}>
        {entry
          ? formatBoardMetric(entry, t)
          : t("rank.notRanked", "Not ranked yet")}
      </span>
      <span className={STAT_SUB}>
        {entry
          ? t("rank.standing", "Rank #{{rank}}", { rank: entry.rank })
          : t("rank.qualify", "Settle more markets to qualify")}
      </span>
    </Link>
  );
}

function rankAriaLabel(entry: LeaderboardEntry | null): string {
  if (!entry) return "Not ranked yet. Settle more markets to qualify.";
  return `Rank ${entry.rank}.`;
}

function formatBoardLabel(
  boardId: string,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (boardId.startsWith("category:")) {
    const slug = boardId.slice("category:".length);
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  }
  switch (boardId) {
    case "accuracy":
      return t("boards.accuracy", "Accuracy");
    case "pnl_weekly":
      return t("boards.pnlWeekly", "Weekly point result");
    case "sharpness":
      return t("boards.sharpness", "Sharpness");
    default:
      return boardId;
  }
}

function formatBoardMetric(
  entry: LeaderboardEntry,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (entry.boardId) {
    case "accuracy":
      return t("rank.metricAccuracy", "{{value}}% correct", {
        value: entry.metricValue.toFixed(1),
      });
    case "sharpness":
      return t("rank.metricSharpness", "{{value}}% point efficiency", {
        value: (entry.metricValue * 100).toFixed(2),
      });
    // pnl_weekly is the default metric shape.
    default: {
      const sign = entry.metricValue < 0 ? "−" : "+";
      return t("rank.metricPnl", "{{value}} point result", {
        value: `${sign}${formatPoints(Math.abs(entry.metricValue))}`,
      });
    }
  }
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  // Step 4: "gain" (accent-coloured numbers) retired — a number is a
  // magnitude or a direction, never the brand accent (spec §2).
  tone?: "yes" | "no";
}) {
  const valueTone =
    tone === "yes"
      ? "text-[var(--yes-text)]"
      : tone === "no"
        ? "text-[var(--no-text)]"
        : undefined;
  return (
    <Card as="div" padding="none" className={STAT_TILE_LAYOUT}>
      <span className={STAT_LABEL}>{label}</span>
      <span className={cx(STAT_VALUE, valueTone)}>{value}</span>
      {sub && <span className={STAT_SUB}>{sub}</span>}
    </Card>
  );
}

// ── Tab bar ─────────────────────────────────────────────────────────────────

function TabBar({
  tab,
  setTab,
  counts,
}: {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  counts: { positions: number; orders: number; history: number };
}) {
  const { t } = useTranslation("portfolio");
  const tabs: { key: TabKey; label: string; count: number }[] = [
    {
      key: "positions",
      label: t("tabs.positions", "Positions"),
      count: counts.positions,
    },
    {
      key: "orders",
      label: t("tabs.orders", "Open orders"),
      count: counts.orders,
    },
    {
      key: "history",
      label: t("tabs.history", "History"),
      count: counts.history,
    },
  ];
  // Quiet segmented control: an ink pill marks the active tab, everything
  // else stays text-only until hover. Replaces the old underline track.
  return (
    <div
      className="mb-[18px] inline-flex max-w-full gap-1 overflow-x-auto rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] p-1"
      role="tablist"
      aria-label="Portfolio tabs"
    >
      {tabs.map((t) => (
        <button
          type="button"
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          className={cx(
            "inline-flex min-h-11 flex-none cursor-pointer items-center gap-1.5 rounded-[var(--r-rh-sm)] border-0 px-3.5 text-sm font-semibold whitespace-nowrap transition-colors duration-150",
            tab === t.key
              ? "bg-[var(--accent)] text-[var(--ticket-cta-text)]"
              : "bg-transparent text-[var(--t3)] hover:text-[var(--t1)]",
          )}
          onClick={() => setTab(t.key)}
        >
          <span>{t.label}</span>
          {t.count > 0 && (
            <span
              className={cx(
                MONO,
                "text-[11px]",
                tab === t.key
                  ? "text-[var(--ticket-cta-text)] opacity-80"
                  : "text-[var(--t3)]",
              )}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Positions table ────────────────────────────────────────────────────────

function PositionsTable({
  positions,
  marketsById,
}: {
  positions: Position[];
  marketsById: Map<string, PredictionMarket>;
}) {
  const { t } = useTranslation("portfolio");
  if (positions.length === 0) {
    return (
      <EmptyState
        line={t("positions.empty", "No open positions.")}
        action={
          <Button variant="primary" size="lg" render={<Link href="/predict" />}>
            {t("positions.browse", "Browse markets")}
          </Button>
        }
      />
    );
  }
  // Step 4 (11a): value = qty × mark, unrealized = value − cost. The mark
  // price rides on the market object this page already hydrates for
  // titles — no new endpoint. "Value now" is the headline because it's
  // what changed since the user last looked.
  return (
    <div className={CARD_GRID}>
      {positions.map((p) => {
        const m = marketsById.get(p.marketId);
        // Step 5 carry-over: a voided market refunds at cost — pricing its
        // position off the last trade showed a loss it will never take.
        const isVoided = m?.status === "voided";
        const mark = m
          ? p.side === "yes"
            ? m.yesPricePoints
            : m.noPricePoints
          : null;
        const value = isVoided
          ? p.totalCostPoints
          : mark !== null
            ? p.quantity * mark
            : null;
        const unrealized = isVoided
          ? 0
          : value !== null
            ? value - p.totalCostPoints
            : null;
        const pct =
          unrealized !== null && p.totalCostPoints > 0
            ? (unrealized / p.totalCostPoints) * 100
            : null;
        const up = (unrealized ?? 0) >= 0;
        const reserved = p.reservedQuantity ?? 0;
        const available = Math.max(0, p.quantity - reserved);
        return (
          <Card as="article" padding="none" className="p-4" key={p.id}>
            <div className="flex items-start gap-2.5">
              <SideChip side={p.side} />
              <MarketCell market={m} fallback={p.marketId} link />
            </div>
            <div className="mt-3.5 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[var(--t3)]">
                  {t("positions.valueNow", "Value now")}
                </div>
                <div
                  className={cx(
                    MONO,
                    "mt-px text-[22px] font-semibold leading-[1.1] text-[var(--t1)]",
                  )}
                >
                  {value !== null ? formatPoints(value) : "—"}
                </div>
              </div>
              {unrealized !== null && (
                <div className="flex-none text-right">
                  <div
                    className={cx(
                      MONO,
                      "text-sm font-semibold",
                      up ? "text-[var(--yes-text)]" : "text-[var(--no-text)]",
                    )}
                  >
                    {up ? "+" : "−"}
                    {formatPoints(Math.abs(unrealized))}
                  </div>
                  {pct !== null && (
                    <div className={cx(MONO, "mt-px text-[11px] text-[var(--t3)]")}>
                      {up ? "+" : "−"}
                      {Math.abs(pct).toFixed(1)}%
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3.5 grid grid-cols-3 gap-2.5 border-t border-[var(--border-1)] pt-3">
              <ThreeUp label={t("table.qty", "Qty")} value={String(p.quantity)} />
              <ThreeUp
                label={t("table.avgPrice", "Avg price")}
                value={formatPoints(p.avgPricePoints)}
              />
              <ThreeUp
                label={t("table.cost", "Cost")}
                value={formatPoints(p.totalCostPoints)}
              />
            </div>
            {/* Step 4 (11a): Available demotes from a column that usually
                mirrors Qty to a lock note shown only when shares really
                are reserved by a resting sell. */}
            {reserved > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-[var(--r-rh-md)] bg-[var(--surface-2)] px-3 py-2.5">
                <svg
                  viewBox="0 0 256 256"
                  className="h-3.5 w-3.5 flex-none text-[var(--accent-text)]"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  {/* phosphor lock-fill — verbatim from
                      design_handoff_taptrade/logos/phosphor-paths.json */}
                  <path d={PHOSPHOR_LOCK_FILL} />
                </svg>
                <span className="min-w-0 flex-1 text-[11px] leading-[1.45] text-[var(--t2)]">
                  {t(
                    "positions.locked",
                    "{{locked}} of {{total}} shares are locked by a resting sell order. {{available}} available to sell now.",
                    { locked: reserved, total: p.quantity, available },
                  )}
                </span>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ── Orders table ───────────────────────────────────────────────────────────

function OrdersTable({
  orders,
  marketsById,
  onCancelled,
}: {
  orders: PredictionOrder[];
  marketsById: Map<string, PredictionMarket>;
  onCancelled: (orderID: string) => void;
}) {
  const { t } = useTranslation("portfolio");
  const toast = useToast();
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);

  if (orders.length === 0) {
    return (
      <EmptyState
        line={t("orders.empty", "No open orders.")}
        action={
          <Button variant="primary" size="lg" render={<Link href="/predict" />}>
            {t("positions.browse", "Browse markets")}
          </Button>
        }
      />
    );
  }

  const handleCancel = async (orderID: string, marketTicker: string) => {
    setPendingCancel(orderID);
    try {
      await api.cancelOrder(orderID);
      onCancelled(orderID);
      toast.success(
        t("orders.cancelled", "Order cancelled"),
        t("orders.released", "Reserved points unlocked on {{ticker}}", {
          ticker: marketTicker,
        }),
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : t("orders.cancelFailed", "Cancel failed");
      logger.warn("Portfolio", "cancel order failed", message);
      toast.error(t("orders.cancelFailed", "Cancel failed"), message);
    } finally {
      setPendingCancel(null);
    }
  };

  return (
    <div className={CARD_GRID}>
      {orders.map((o) => {
        const m = marketsById.get(o.marketId);
        const isCancelling = pendingCancel === o.id;
        const ticker = m?.ticker ?? o.marketId;
        const filled = o.filledQuantity ?? 0;
        const isPartial = o.status === "partial" && filled > 0;
        return (
          <Card as="article" padding="none" className="p-4" key={o.id}>
            <div className="flex items-start gap-2.5">
              <SideChip side={o.side} />
              <MarketCell market={m} fallback={o.marketId} link />
              <StatusChip status={o.status} failureReason={o.failureReason} />
            </div>
            {isPartial && (
              <div className="mt-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-medium text-[var(--t3)]">
                    {t("orders.filled", "Filled")}
                  </span>
                  <span className={cx(MONO, "text-xs text-[var(--t2)]")}>
                    {t("orders.fillLabel", "{{filled}} of {{qty}}", {
                      filled,
                      qty: o.quantity,
                    })}
                  </span>
                </div>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  {/* Fill progress is neutral (ink), not a YES-side signal —
                      it tracks quantity filled, not market direction. */}
                  <span
                    className="block h-full rounded-full bg-[var(--accent)]"
                    style={{
                      width: `${Math.min(100, Math.round((filled / Math.max(1, o.quantity)) * 100))}%`,
                    }}
                  />
                </span>
              </div>
            )}
            <div className="mt-3.5 grid grid-cols-3 gap-2.5 border-t border-[var(--border-1)] pt-3">
              <ThreeUp label={t("table.qty", "Qty")} value={String(o.quantity)} />
              <ThreeUp
                label={t("table.cost", "Cost")}
                value={formatPoints(o.totalCostPoints)}
              />
              <ThreeUp
                label={t("table.placed", "Placed")}
                value={formatDate(o.createdAt)}
              />
            </div>
            {/* Step 4 (11b): Cancel is a full-width 44px button — the old
                11px row control was an accessibility miss on the one
                destructive action this screen owns. */}
            <button
              type="button"
              className="mt-3 flex min-h-11 w-full cursor-pointer items-center justify-center rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] text-[13px] font-semibold text-[var(--danger)] transition-[border-color] duration-150 hover:border-[var(--danger)] disabled:cursor-default disabled:opacity-50"
              disabled={isCancelling}
              onClick={() => void handleCancel(o.id, ticker)}
            >
              {isCancelling
                ? t("orders.cancelling", "Cancelling…")
                : t("orders.cancelOrder", "Cancel order")}
            </button>
          </Card>
        );
      })}
    </div>
  );
}

// ── History table ──────────────────────────────────────────────────────────

function HistoryTable({
  history,
  marketsById,
}: {
  history: SettledPositionResult[];
  marketsById: Map<string, PredictionMarket>;
}) {
  const { t } = useTranslation("portfolio");
  if (history.length === 0) {
    // Step 4 (18b): an empty history is a statement about time, not a
    // problem to solve — no action button.
    return (
      <EmptyState
        line={t(
          "history.empty",
          "Settled positions will appear here after markets resolve.",
        )}
      />
    );
  }
  return (
    <div className={CARD_GRID}>
      {history.map((h) => {
        const m = marketsById.get(h.marketId);
        const up = h.realizedPoints >= 0;
        const rawPoints = h.settlementPoints;
        return (
          <Card as="article" padding="none" className="p-4" key={h.id}>
            <div className="flex items-start gap-2.5">
              <SideChip side={h.side} />
              <MarketCell market={m} fallback={h.marketId} link />
            </div>
            <div className="mt-3.5 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[var(--t3)]">
                  {t("table.pnl", "Point result")}
                </div>
                <div
                  className={cx(
                    MONO,
                    "mt-px text-[22px] font-semibold leading-[1.1]",
                    up ? "text-[var(--yes-text)]" : "text-[var(--no-text)]",
                  )}
                >
                  {up ? "+" : "−"}
                  {formatPoints(Math.abs(h.realizedPoints))}
                </div>
              </div>
              <div className={cx(MONO, "flex-none text-right text-[11px] text-[var(--t3)]")}>
                {t("history.settledOn", "Settled {{date}}", {
                  date: formatDate(h.paidAt),
                })}
              </div>
            </div>
            <div className="mt-3.5 grid grid-cols-3 gap-2.5 border-t border-[var(--border-1)] pt-3">
              <ThreeUp
                label={t("table.entry", "Entry")}
                value={formatPoints(h.entryPricePoints)}
              />
              <ThreeUp
                label={t("table.exit", "Exit")}
                value={formatPoints(h.exitPricePoints)}
              />
              <ThreeUp
                label={t("history.paid", "Paid")}
                value={
                  rawPoints && rawPoints > 0 ? formatPoints(rawPoints) : "0 pts"
                }
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────────

function MarketCell({
  market,
  fallback,
  link = false,
}: {
  market: PredictionMarket | undefined;
  fallback: string;
  /** Card layouts link via the title (whole-card links would swallow the
   * Cancel button); table rows keep their own row-level href. */
  link?: boolean;
}) {
  const { t } = useTranslation("market-content");
  if (!market) {
    return <span className={cx(MONO, DIM_TEXT)}>{fallback.slice(0, 8)}…</span>;
  }
  const displayMarket = localizedMarket(t, market);
  const title = link ? (
    <Link
      href={`/market/${market.ticker}`}
      className="truncate text-[14px] font-medium leading-[1.35] text-[var(--t1)] no-underline hover:underline font-sans"
    >
      {displayMarket.title}
    </Link>
  ) : (
    <span className="truncate text-[13px] font-semibold text-[var(--t1)] font-sans">
      {displayMarket.title}
    </span>
  );
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      {title}
      <span
        className={cx(
          MONO,
          "text-[10px] uppercase tracking-normal text-[var(--t3)]",
        )}
      >
        {displayMarket.ticker}
      </span>
    </div>
  );
}

function ThreeUp({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium text-[var(--t3)]">{label}</div>
      <div className={cx(MONO, "mt-0.5 truncate text-[13px] font-medium text-[var(--t2)]")}>
        {value}
      </div>
    </div>
  );
}

function SideChip({ side }: { side: "yes" | "no" }) {
  const { t } = useTranslation("portfolio");
  return (
    <span
      className={cx(
        "inline-block rounded-[var(--r-sm)] px-2 py-[3px] text-[10px] font-bold tracking-normal",
        side === "yes"
          ? "bg-[var(--yes-soft)] text-[var(--yes-text)]"
          : "bg-[var(--no-soft)] text-[var(--no-text)]",
      )}
    >
      {side === "yes" ? t("side.yes", "YES") : t("side.no", "NO")}
    </span>
  );
}

/**
 * Map raw failure_reason enum values from the gateway into short
 * user-readable phrases. Mirrors the Go-side `Failure*` constants in
 * internal/prediction/types.go. Unknown reasons fall through as-is so
 * future additions don't render blank.
 */
const FAILURE_REASON_TEXT: Record<string, string> = {
  price_band_violation: "price out of bounds (1–99 pts)",
  post_only_would_take: "post-only would have crossed the book",
  self_match_rejected: "blocked: would have crossed your own order",
  closed_market: "market is no longer open",
  insufficient_balance: "insufficient balance",
  insufficient_position: "not enough shares to sell",
  notional_cap_missing: "market order needs a notional cap",
  notional_cap_exceeded: "notional cap exceeded",
  fok_unavailable: "fill-or-kill couldn't fully fill",
};

function StatusChip({
  status,
  failureReason,
}: {
  status: OrderStatus;
  failureReason?: string;
}) {
  const phrase = failureReason
    ? FAILURE_REASON_TEXT[failureReason] || failureReason
    : undefined;
  // Step 4: a resting order is the palette's INFO state (§4f), not an
  // accent state; terminal-era white/black literals go to tokens.
  // "filled" is a system success state, not a YES-side signal — YES/NO
  // colour stays reserved for market direction only.
  const statusTone =
    status === "filled"
      ? "border-[color-mix(in_srgb,var(--success)_32%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success)]"
      : status === "open" || status === "partial"
        ? "border-[var(--info-dot)] bg-[var(--info-soft)] text-[var(--info-text)]"
        : status === "cancelled" || status === "expired"
          ? "border-[var(--border-1)] bg-[var(--surface-2)] text-[var(--t3)]"
          : "border-[var(--border-1)] bg-[var(--surface-2)] text-[var(--t2)]";
  return (
    <span
      className={cx(
        "inline-block rounded-[var(--r-pill)] border px-[10px] py-[3px] text-[10px] font-semibold capitalize tracking-normal",
        statusTone,
        phrase && "cursor-help",
      )}
      title={phrase}
    >
      {status}
    </span>
  );
}

// Step 4: DataTable and its Column/Row plumbing retired — all three
// tabs render cards (Position and Orders 11a-c).

function EmptyState({
  line,
  action,
}: {
  line: string;
  action?: React.ReactNode;
}) {
  // Step 4 (18b): dashed Card variant; an action renders only when the
  // user can DO something about the emptiness.
  return (
    <Card
      as="div"
      variant="dashed"
      padding="none"
      className="flex flex-col items-center gap-[10px] px-[18px] py-[26px] text-center text-[13px] text-[var(--t2)]"
    >
      <span>{line}</span>
      {action}
    </Card>
  );
}

// ── Utilities ──────────────────────────────────────────────────────────────

function is401(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("401") ||
    msg.includes("unauthorized") ||
    msg.includes("authentication required")
  );
}

// Points display goes through lib/points (whole-Points unit model — wire
// integers ARE whole Points; never ÷100).

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
