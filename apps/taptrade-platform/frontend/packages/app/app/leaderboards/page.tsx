"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { Button, Card } from "../components/ui";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import {
  getLeaderboards,
  getLeaderboardEntries,
  getUserStanding,
  type LeaderboardDefinition,
  type LeaderboardEntry,
} from "../lib/api/leaderboards-client";
import { logger } from "../lib/logger";
import { formatPoints } from "../lib/points";

// /leaderboards — Predict-native boards. Layout follows PLAN-loyalty-
// leaderboards.md §5: left sidebar with all boards + the viewer's rank on
// each; right pane shows the active board as a semantic <table>. The viewer
// row is highlighted with --accent-soft and #N You prefix.
//
// Category Champions boards share one slot in the sidebar via a <select>.
// Mobile: standing summary card above active board (responsive Tailwind classes).

const ENTRIES_LIMIT = 25;

const WRAP_CLASS = "mx-auto max-w-[1180px] pb-[60px] max-[720px]:px-4";
const HEAD_CLASS = "mb-[22px] flex items-end justify-between gap-4";
// Micro-label eyebrow: mono, uppercase, tracked wide (DESIGN.md §4).
const KICKER_CLASS =
  "mb-1.5 inline-block text-[12px] font-semibold text-[var(--t3)]";
// Page title: the sentence-case heading voice (DESIGN.md §4).
const TITLE_CLASS =
  "type-poster m-0 text-[28px] text-[var(--t1)] max-[720px]:text-[24px]";
const CROSS_LINK_CLASS =
  "border-b border-[var(--border-1)] pb-0.5 text-[13px] text-[var(--t2)] hover:border-[var(--accent)] hover:text-[var(--t1)]";
const GRID_CLASS =
  "grid grid-cols-[280px_minmax(0,1fr)] items-start gap-[18px] max-[1024px]:grid-cols-1";
// Surface shell (rounded/border/surface-1) now comes from the Card
// primitive; sidebar/detail/state cards keep their density inline.
const TAB_BASE_CLASS =
  "grid cursor-pointer grid-cols-[1fr_auto] grid-rows-[auto_auto] items-center gap-x-3 gap-y-0.5 rounded-[var(--r-rh-md)] border p-3.5 text-left text-[var(--t2)] transition-[background,border-color] duration-[120ms] ease-[ease] [font-family:inherit] hover:bg-[var(--surface-2)] max-[1024px]:flex-[0_0_220px] max-[1024px]:[scroll-snap-align:start]";
const TAB_ACTIVE_CLASS =
  "border-[var(--accent)] bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)]";
const TAB_INACTIVE_CLASS = "border-transparent bg-transparent";
const TAB_NAME_CLASS =
  "col-start-1 row-start-1 text-sm font-bold text-[var(--t1)]";
const TAB_SUB_CLASS =
  "col-start-1 row-start-2 text-[12px] text-[var(--t3)]";
const TAB_RANK_BASE_CLASS =
  "col-start-2 row-span-2 row-start-1 self-center text-base font-bold text-[var(--t1)] tabular-nums font-mono";
const TAB_RANK_ACTIVE_CLASS = "text-[var(--accent)]";
const CATEGORY_CLASS = `${TAB_BASE_CLASS} cursor-default max-[1024px]:flex-[0_0_280px]`;
const CATEGORY_SELECT_CLASS =
 "col-start-1 row-start-2 mt-1 cursor-pointer appearance-none rounded-[var(--r-rh-sm)] border border-[var(--border-1)] bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--t1)] focus-visible:[outline:2px_solid_var(--accent)] focus-visible:outline-offset-2 [font-family:inherit] max-[1024px]:min-h-9 max-[1024px]:w-full max-[1024px]:px-2.5 max-[1024px]:py-2 max-[1024px]:text-[13px]";
const DETAIL_HEAD_CLASS =
 "mb-[18px] flex items-start justify-between gap-[18px] max-[720px]:flex-col max-[720px]:gap-2";
const DETAIL_TITLE_CLASS =
 "m-0 mb-1.5 text-[22px] font-extrabold text-[var(--t1)]";
const DETAIL_BODY_CLASS =
 "m-0 max-w-[540px] text-[13px] leading-[1.6] text-[var(--t2)]";
const DETAIL_WINDOW_CLASS =
 "text-[11px] text-[var(--t3)] tabular-nums font-mono";
const EMPTY_CLASS = "py-[60px] text-center text-sm text-[var(--t2)]";
const EMPTY_SUB_CLASS = "mt-1.5 text-xs text-[var(--t3)]";
const TABLE_CLASS =
 "w-full border-collapse text-[13px] [&_td]:border-b [&_td]:border-[var(--border-1)] [&_td]:px-1.5 [&_td]:py-2.5 [&_td]:align-middle [&_th]:border-b [&_th]:border-[var(--border-1)] [&_th]:px-1.5 [&_th]:py-2.5 [&_th]:text-[12px] [&_th]:font-bold [&_th]:text-[var(--t3)]";
const TEXT_LEFT_CLASS = "text-left";
const NUM_CLASS = "text-right";
const MONO_CLASS =
 "tabular-nums font-mono";
const HIDE_SM_CLASS = "max-[720px]:hidden";
const TRADER_CLASS = "font-medium text-[var(--t1)]";
const SUBTLE_CLASS = "text-[var(--t3)]";
const VIEWER_ROW_CLASS =
 "bg-[var(--accent-soft)] [&>td]:font-semibold [&>td]:text-[var(--t1)]";
const VIEWER_CELL_CLASS = "p-3 text-center text-[var(--t1)]";
const STATE_CLASS = "flex min-h-[60vh] items-center justify-center px-6";
const STATE_MESSAGE_CLASS = "m-0 mb-3.5 leading-[1.6] text-[var(--t2)]";
// State CTA migrated to Button primary lg (same unification as rewards).

export default function LeaderboardsPage() {
 const { t } = useTranslation("leaderboards");
 const { user, isLoading: authLoading } = useAuth();
 const router = useRouter();
 const searchParams = useSearchParams();
 const boardQuery = searchParams?.get("board") ?? "";

 const [boards, setBoards] = useState<LeaderboardDefinition[]>([]);
 const [selectedId, setSelectedId] = useState<string>("");
 const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
 const [viewerEntry, setViewerEntry] = useState<LeaderboardEntry | null>(null);
 const [userStanding, setUserStanding] = useState<LeaderboardEntry[]>([]);
 const [loading, setLoading] = useState(true);
 const [detailLoading, setDetailLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);

 // Initial: board catalog + user's standing across all boards. Parallel fetch.
 // biome-ignore lint/correctness/useExhaustiveDependencies: initial-load effect: boardQuery/t are deliberately read once — re-running on URL query changes would clobber the user's manual board selection
 useEffect(() => {
 let cancelled = false;

 async function load() {
 try {
 setLoading(true);
 const [boardsResult, standingResult] = await Promise.all([
 getLeaderboards(),
 user?.id
 ? getUserStanding().catch(() => [] as LeaderboardEntry[])
 : Promise.resolve([] as LeaderboardEntry[]),
 ]);
 if (cancelled) return;
 setBoards(boardsResult);
 setUserStanding(standingResult);

 const initial =
 boardQuery && boardsResult.some((b) => b.id === boardQuery)
 ? boardQuery
 : (standingResult[0]?.boardId ?? boardsResult[0]?.id ?? "");
 setSelectedId(initial);
 setError(null);
 } catch (err) {
 if (cancelled) return;
 const message =
 err instanceof Error
 ? err.message
 : t("errors.loadBoards", "Failed to load leaderboards");
 logger.error("Leaderboards", "board list fetch failed", message);
 setError(message);
 } finally {
 if (!cancelled) setLoading(false);
 }
 }

 void load();
 return () => {
 cancelled = true;
 };
 // We intentionally don't re-run when boardQuery changes — selection is
 // state-driven after the first render. Change-via-URL only applies on mount.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [user?.id]);

 // Detail fetch: entries for the selected board.
 // biome-ignore lint/correctness/useExhaustiveDependencies: t is read only in the catch path — depending on it would refetch standings on every language switch
 useEffect(() => {
 let cancelled = false;

 async function loadDetail() {
 if (!selectedId) {
 setEntries([]);
 setViewerEntry(null);
 return;
 }
 try {
 setDetailLoading(true);
 const result = await getLeaderboardEntries(selectedId, ENTRIES_LIMIT);
 if (cancelled) return;
 setEntries(result.items ?? []);
 setViewerEntry(result.viewerEntry ?? null);
 } catch (err) {
 if (cancelled) return;
 const message =
 err instanceof Error
 ? err.message
 : t("errors.loadStandings", "Failed to load standings");
 logger.error("Leaderboards", "entries fetch failed", message);
 setError(message);
 } finally {
 if (!cancelled) setDetailLoading(false);
 }
 }

 void loadDetail();
 return () => {
 cancelled = true;
 };
 }, [selectedId]);

 // Keep the URL in sync with the active board so the tab is shareable.
 const selectBoard = useCallback(
 (id: string) => {
 setSelectedId(id);
 const params = new URLSearchParams(searchParams?.toString() ?? "");
 params.set("board", id);
 router.replace(`/leaderboards?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const selectedBoard = useMemo(
    () => boards.find((b) => b.id === selectedId) ?? null,
    [boards, selectedId],
  );

  // Sidebar renders: static boards explicitly, then Category Champions as a
  // single group with a <select>. Matches plan §2 "multi-board but renders
  // as one board with a category dropdown".
  const { staticBoards, categoryBoards } = useMemo(() => {
    const statics: LeaderboardDefinition[] = [];
    const categories: LeaderboardDefinition[] = [];
    for (const b of boards) {
      // Defensive: tolerate a legacy sportsbook response shape that lacks id.
      // The board is unusable either way, so drop it rather than crash.
      if (typeof b?.id !== "string") continue;
      if (b.id.startsWith("category:")) categories.push(b);
      else statics.push(b);
    }
    return { staticBoards: statics, categoryBoards: categories };
  }, [boards]);

  // Map boardId → user's entry for fast sidebar lookup.
  const standingByBoard = useMemo(() => {
    const map = new Map<string, LeaderboardEntry>();
    for (const e of userStanding) map.set(e.boardId, e);
    return map;
  }, [userStanding]);

  if (authLoading || loading) {
    return <PageState message={t("state.loading", "Loading leaderboards…")} />;
  }
  if (error && boards.length === 0) {
    return (
      <PageState
        message={error}
        cta={{
          href: "/portfolio",
          label: t("state.backToPortfolio", "Back to portfolio"),
        }}
      />
    );
  }
  if (boards.length === 0) {
    return (
      <PageState
        message={t("state.none", "No leaderboards have been set up yet.")}
        cta={{
          href: "/predict",
          label: t("state.browseMarkets", "Browse markets"),
        }}
      />
    );
  }

  return (
    <div className={WRAP_CLASS}>
      <header className={HEAD_CLASS}>
        <div>
          <span className={KICKER_CLASS}>{t("kicker", "Leaderboards")}</span>
          <h1 className={TITLE_CLASS}>{t("title", "Rankings")}</h1>
        </div>
        <Link href="/rewards" className={CROSS_LINK_CLASS}>
          {t("viewTier", "View your tier")} →
        </Link>
      </header>

      <div className={GRID_CLASS}>
        <Card
          as="div"
          padding="none"
          className="relative flex flex-col gap-1.5 p-2.5 max-[1024px]:flex-row max-[1024px]:overflow-x-auto max-[1024px]:[scroll-snap-type:x_mandatory]"
          role="tablist"
          aria-label={t("boardsAria", "Boards")}
        >
          {staticBoards.map((board) => (
            <BoardTab
              key={board.id}
              board={board}
              active={board.id === selectedId}
              userEntry={standingByBoard.get(board.id) ?? null}
              onClick={() => selectBoard(board.id)}
            />
          ))}

          {categoryBoards.length > 0 && (
            <CategoryPicker
              boards={categoryBoards}
              selectedId={selectedId}
              userStanding={standingByBoard}
              onSelect={selectBoard}
            />
          )}
        </Card>

        <Card
          as="section"
          padding="none"
          className="relative min-h-[420px] p-[22px]"
          aria-labelledby="lb-detail-title"
        >
          {selectedBoard ? (
            <DetailPanel
              board={selectedBoard}
              entries={entries}
              viewerEntry={viewerEntry}
              loading={detailLoading}
              currentUserId={user?.id ?? ""}
            />
          ) : (
            <div className={EMPTY_CLASS}>
              {t("state.pickBoard", "Pick a board to see rankings.")}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function BoardTab({
  board,
  active,
  userEntry,
  onClick,
}: {
  board: LeaderboardDefinition;
  active: boolean;
  userEntry: LeaderboardEntry | null;
  onClick: () => void;
}) {
  const { t } = useTranslation("leaderboards");
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`${TAB_BASE_CLASS} ${
        active ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS
      }`}
      onClick={onClick}
    >
      <span className={TAB_NAME_CLASS}>{boardName(board, t)}</span>
      <span className={TAB_SUB_CLASS}>{metricLabel(board, t)}</span>
      <span
        className={`${TAB_RANK_BASE_CLASS} ${
          active ? TAB_RANK_ACTIVE_CLASS : ""
        }`}
      >
        {userEntry ? `#${userEntry.rank}` : "—"}
      </span>
    </button>
  );
}

function CategoryPicker({
  boards,
  selectedId,
  userStanding,
  onSelect,
}: {
  boards: LeaderboardDefinition[];
  selectedId: string;
  userStanding: Map<string, LeaderboardEntry>;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation("leaderboards");
  const activeInCategory = boards.some((b) => b.id === selectedId);
  const currentValue = activeInCategory ? selectedId : (boards[0]?.id ?? "");
  const userEntry = userStanding.get(currentValue) ?? null;

  return (
    <div
      className={`${CATEGORY_CLASS} ${
        activeInCategory ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS
      }`}
    >
      <span className={TAB_NAME_CLASS}>
        {t("categoryChampions", "Category Champions")}
      </span>
      <select
        className={CATEGORY_SELECT_CLASS}
        value={currentValue}
        onChange={(e) => onSelect(e.target.value)}
        aria-label={t("chooseCategory", "Choose a category")}
      >
        {boards.map((b) => (
          <option key={b.id} value={b.id}>
            {categoryLabel(b, t)}
          </option>
        ))}
      </select>
      <span
        className={`${TAB_RANK_BASE_CLASS} ${
          activeInCategory ? TAB_RANK_ACTIVE_CLASS : ""
        }`}
      >
        {userEntry ? `#${userEntry.rank}` : "—"}
      </span>
    </div>
  );
}

function DetailPanel({
  board,
  entries,
  viewerEntry,
  loading,
  currentUserId,
}: {
  board: LeaderboardDefinition;
  entries: LeaderboardEntry[];
  viewerEntry: LeaderboardEntry | null;
  loading: boolean;
  currentUserId: string;
}) {
  const { t } = useTranslation("leaderboards");
  return (
    <>
      <header className={DETAIL_HEAD_CLASS}>
        <div>
          <h2 id="lb-detail-title" className={DETAIL_TITLE_CLASS}>
            {boardName(board, t)}
          </h2>
          <p className={DETAIL_BODY_CLASS}>{boardDescription(board, t)}</p>
        </div>
        <div className={DETAIL_WINDOW_CLASS}>
          {windowLabel(board.window, t)}
        </div>
      </header>

      {loading ? (
        <div className={EMPTY_CLASS}>
          {t("state.loadingRankings", "Loading rankings…")}
        </div>
      ) : entries.length === 0 ? (
        <div className={EMPTY_CLASS}>
          <p>{qualificationMessage(board, t)}</p>
          {viewerEntry === null && (
            <p className={EMPTY_SUB_CLASS}>
              {t(
                "state.noQualified",
                "Nobody has qualified for this board yet.",
              )}
            </p>
          )}
        </div>
      ) : (
        <table
          className={TABLE_CLASS}
          aria-label={t("table.rankingsAria", "{{board}} rankings", {
            board: boardName(board, t),
          })}
        >
          <caption className="sr-only">
            {t("table.caption", "{{board}} rankings — {{window}}", {
              board: boardName(board, t),
              window: windowLabel(board.window, t),
            })}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={NUM_CLASS}>
                {t("table.rank", "Rank")}
              </th>
              <th scope="col" className={TEXT_LEFT_CLASS}>
                {t("table.trader", "Trader")}
              </th>
              <th scope="col" className={NUM_CLASS}>
                {metricLabel(board, t)}
              </th>
              <th scope="col" className={`${NUM_CLASS} ${HIDE_SM_CLASS}`}>
                {t("table.settled", "Settled")}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const isViewer = e.userId === currentUserId;
              return (
                <tr
                  key={`${e.boardId}:${e.userId}`}
                  className={isViewer ? VIEWER_ROW_CLASS : ""}
                  aria-current={isViewer ? "true" : undefined}
                >
                  <td className={`${NUM_CLASS} ${MONO_CLASS}`}>
                    {isViewer
                      ? t("table.youRank", "#{{rank}} You", { rank: e.rank })
                      : `#${e.rank}`}
                  </td>
                  <td className={TRADER_CLASS}>{e.displayName}</td>
                  <td className={`${NUM_CLASS} ${MONO_CLASS}`}>
                    {formatMetric(board, e.metricValue)}
                  </td>
                  <td className={`${NUM_CLASS} ${HIDE_SM_CLASS} ${MONO_CLASS}`}>
                    {typeof e.settledCount === "number" ? (
                      e.settledCount
                    ) : (
                      <span className={SUBTLE_CLASS}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {viewerEntry &&
              !entries.some((e) => e.userId === currentUserId) && (
                <tr className={VIEWER_ROW_CLASS} aria-current="true">
                  <td colSpan={4} className={VIEWER_CELL_CLASS}>
                    {t("table.viewerRow", "#{{rank}} You · {{metric}}", {
                      rank: viewerEntry.rank,
                      metric: formatMetric(board, viewerEntry.metricValue),
                    })}
                  </td>
                </tr>
              )}
          </tbody>
        </table>
      )}
    </>
  );
}

function PageState({
  message,
  cta,
}: {
  message: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className={STATE_CLASS}>
      <Card
        as="div"
        padding="none"
        className="relative max-w-[440px] p-7 text-center"
      >
        <p className={STATE_MESSAGE_CLASS}>{message}</p>
        {cta && (
          <Button
            variant="primary"
            size="lg"
            render={<Link href={cta.href} />}
          >
            {cta.label}
          </Button>
        )}
      </Card>
    </div>
  );
}

function windowLabel(
  window: string,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (window === "weekly") return t("windows.weekly", "This week");
  if (window === "rolling_30d") return t("windows.rolling30d", "Last 30 days");
  return window;
}

function boardName(
  board: LeaderboardDefinition,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (board.id === "accuracy") return t("boards.accuracy.name", "Accuracy");
  if (board.id === "pnl_weekly")
    return t("boards.pnlWeekly.name", "Weekly Points");
  if (board.id === "sharpness") return t("boards.sharpness.name", "Sharpness");
  if (board.id.startsWith("category:")) {
    return t("boards.category.name", "{{category}} Champions", {
      category: categoryLabel(board, t),
    });
  }
  return board.name;
}

function boardDescription(
  board: LeaderboardDefinition,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (board.id === "accuracy")
    return t("boards.accuracy.description", board.description);
  if (board.id === "pnl_weekly")
    return t("boards.pnlWeekly.description", board.description);
  if (board.id === "sharpness")
    return t("boards.sharpness.description", board.description);
  if (board.id.startsWith("category:")) {
    return t("boards.category.description", board.description, {
      category: categoryLabel(board, t),
    });
  }
  return board.description;
}

function metricLabel(
  board: LeaderboardDefinition,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (board.id === "accuracy") return t("metrics.accuracy", "Accuracy");
  if (board.id === "pnl_weekly") return t("metrics.pnl", "Net points");
  if (board.id === "sharpness") return t("metrics.sharpness", "Sharpness");
  if (board.id.startsWith("category:"))
    return t("metrics.category", "Net points");
  return board.pointMetricKey || board.metricKey;
}

function qualificationMessage(
  board: LeaderboardDefinition,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (board.id === "accuracy")
    return t("qualification.accuracy", board.rewardSummary);
  if (board.id === "pnl_weekly")
    return t("qualification.pnlWeekly", board.rewardSummary);
  if (board.id === "sharpness")
    return t("qualification.sharpness", board.rewardSummary);
  if (board.id.startsWith("category:"))
    return t("qualification.category", board.rewardSummary);
  return board.rewardSummary;
}

function categoryLabel(
  board: LeaderboardDefinition,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const slug = board.categorySlug || board.id.replace("category:", "");
  const fallback = slug
    ? slug.charAt(0).toUpperCase() + slug.slice(1)
    : board.name;
  return t(`categories.${slug}`, fallback);
}

function formatMetric(board: LeaderboardDefinition, value: number): string {
  switch (board.id) {
    case "accuracy":
      return `${value.toFixed(1)}%`;
    case "pnl_weekly":
      return formatPoints(value);
    case "sharpness":
      return `${(value * 100).toFixed(2)}%`;
    default:
      if (board.id.startsWith("category:")) return formatPoints(value);
      return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 2,
      }).format(value);
  }
}

// Points display goes through lib/points (whole-Points unit model — wire
// integers ARE whole Points; never ÷100). formatPoints preserves sign for
// negative point results.
