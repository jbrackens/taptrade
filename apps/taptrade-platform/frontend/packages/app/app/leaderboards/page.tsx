"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "../components/ui";
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
import { ProfileAvatar } from "../components/account/ProfileAvatar";

// /leaderboards — the boards, laid out like Polymarket's leaderboard on the
// board's card recipe: board tabs across the top (Category Champions opens a
// category picker beside them), the active board as a ranked list with
// avatars, and the viewer's standing on every board in a side panel. The
// viewer's row is marked "You" on a raised well, never lavender.

const ENTRIES_LIMIT = 25;

const CARD_CLASS =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] shadow-[var(--shadow-card)]";
const TAB_CLASS = (active: boolean) =>
  `inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-[var(--r-pill)] border px-4 text-[14px] font-semibold transition-colors duration-150 max-[640px]:min-h-10 ${
    active
      ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--on-ink)]"
      : "border-[var(--border-1)] bg-[var(--surface-1)] text-[var(--t2)] hover:border-[var(--border-2)] hover:text-[var(--t1)]"
  }`;
const SELECT_CLASS =
  "min-h-9 cursor-pointer rounded-[var(--r-pill)] border border-[var(--border-2)] bg-[var(--surface-1)] px-3.5 text-[14px] font-semibold text-[var(--t1)] outline-none focus-visible:shadow-[0_0_0_2px_var(--focus-ring)] max-[640px]:min-h-10";

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

  const categoryActive = categoryBoards.some((b) => b.id === selectedId);

  return (
    <div className="mx-auto max-w-[1080px] px-6 pb-16 pt-6 max-[640px]:px-4">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="type-poster m-0 text-[28px] text-[var(--t1)] max-[640px]:text-[24px]">
            {t("kicker", "Leaderboards")}
          </h1>
          <p className="m-0 mt-1 text-[14px] text-[var(--t3)]">
            {t("subtitle", "Rankings update as markets settle.")}
          </p>
        </div>
        <Link
          href="/rewards"
          className="inline-flex min-h-10 shrink-0 items-center text-[13px] font-semibold text-[var(--t2)] no-underline hover:text-[var(--t1)] hover:underline"
        >
          {t("viewTier", "View your tier")} →
        </Link>
      </header>

      <div
        className="-mx-6 mb-5 flex gap-2 overflow-x-auto px-6 pb-1 max-[640px]:-mx-4 max-[640px]:px-4"
        role="tablist"
        aria-label={t("boardsAria", "Boards")}
      >
        {staticBoards.map((board) => (
          <button
            key={board.id}
            type="button"
            role="tab"
            aria-selected={board.id === selectedId}
            className={TAB_CLASS(board.id === selectedId)}
            onClick={() => selectBoard(board.id)}
          >
            {boardName(board, t)}
          </button>
        ))}
        {categoryBoards.length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={categoryActive}
            className={TAB_CLASS(categoryActive)}
            onClick={() => {
              if (!categoryActive && categoryBoards[0]) selectBoard(categoryBoards[0].id);
            }}
          >
            {t("categoryChampions", "Category Champions")}
          </button>
        )}
        {categoryActive && (
          <select
            className={SELECT_CLASS}
            value={selectedId}
            onChange={(e) => selectBoard(e.target.value)}
            aria-label={t("chooseCategory", "Choose a category")}
          >
            {categoryBoards.map((b) => (
              <option key={b.id} value={b.id}>
                {categoryLabel(b, t)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4 max-[1024px]:grid-cols-1">
        <section className={`${CARD_CLASS} min-h-[420px]`} aria-labelledby="lb-detail-title">
          {selectedBoard ? (
            <DetailPanel
              board={selectedBoard}
              entries={entries}
              viewerEntry={viewerEntry}
              loading={detailLoading}
              currentUserId={user?.id ?? ""}
            />
          ) : (
            <div className="px-6 py-16 text-center text-[14px] text-[var(--t3)]">
              {t("state.pickBoard", "Pick a board to see rankings.")}
            </div>
          )}
        </section>

        <StandingPanel
          boards={boards}
          standing={standingByBoard}
          selectedId={selectedId}
          onSelect={selectBoard}
        />
      </div>
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
  const viewerListed = entries.some((e) => e.userId === currentUserId);
  return (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-[var(--border-1)] px-5 py-4 max-[640px]:flex-col max-[640px]:gap-2">
        <div className="min-w-0">
          <h2 id="lb-detail-title" className="m-0 text-[18px] font-semibold tracking-[-0.01em] text-[var(--t1)]">
            {boardName(board, t)}
          </h2>
          <p className="m-0 mt-1 max-w-[540px] text-[13px] leading-normal text-[var(--t3)]">
            {boardDescription(board, t)}
          </p>
        </div>
        <span className="shrink-0 rounded-[var(--r-pill)] bg-[var(--surface-2)] px-2.5 py-1 text-[12px] font-semibold text-[var(--t2)]">
          {windowLabel(board.window, t)}
        </span>
      </header>

      {loading ? (
        <div className="px-5 py-16 text-center text-[14px] text-[var(--t3)]">
          {t("state.loadingRankings", "Loading rankings…")}
        </div>
      ) : entries.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="m-0 text-[15px] font-semibold text-[var(--t1)]">{qualificationMessage(board, t)}</p>
          {viewerEntry === null && (
            <p className="m-0 mt-1 text-[13px] text-[var(--t3)]">
              {t("state.noQualified", "Nobody has qualified for this board yet.")}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[40px_minmax(0,1fr)_72px_104px] items-center gap-3 border-b border-[var(--border-1)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--t3)] max-[640px]:grid-cols-[32px_minmax(0,1fr)_96px]">
            <span>{t("table.rank", "Rank")}</span>
            <span>{t("table.trader", "Trader")}</span>
            <span className="text-right max-[640px]:hidden">{t("table.settled", "Settled")}</span>
            <span className="text-right">{metricLabel(board, t)}</span>
          </div>
          <ol
            className="m-0 list-none divide-y divide-[var(--border-1)] p-0"
            aria-label={t("table.rankingsAria", "{{board}} rankings", { board: boardName(board, t) })}
          >
            {entries.map((e) => (
              <RankRow key={`${e.boardId}:${e.userId}`} board={board} entry={e} isViewer={e.userId === currentUserId} />
            ))}
          </ol>
          {viewerEntry && !viewerListed && (
            <div className="border-t-2 border-dashed border-[var(--border-1)]">
              <RankRow board={board} entry={viewerEntry} isViewer />
            </div>
          )}
        </>
      )}
    </>
  );
}

function RankRow({
  board,
  entry,
  isViewer,
}: {
  board: LeaderboardDefinition;
  entry: LeaderboardEntry;
  isViewer: boolean;
}) {
  const { t } = useTranslation("leaderboards");
  const podium = entry.rank <= 3;
  return (
    <li
      className={`grid grid-cols-[40px_minmax(0,1fr)_72px_104px] items-center gap-3 px-5 py-3 max-[640px]:grid-cols-[32px_minmax(0,1fr)_96px] ${
        isViewer ? "bg-[var(--surface-2)]" : ""
      }`}
      aria-current={isViewer ? "true" : undefined}
    >
      <span
        className={`text-[15px] tabular-nums ${
          podium ? "font-bold text-[var(--t1)]" : "font-medium text-[var(--t3)]"
        }`}
      >
        {entry.rank}
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <ProfileAvatar name={entry.displayName} size={32} />
        <span className="truncate text-[14px] font-semibold text-[var(--t1)]">{entry.displayName}</span>
        {isViewer && (
          <span className="shrink-0 rounded-[var(--r-rh-sm)] bg-[var(--ink)] px-1.5 py-px text-[11px] font-semibold text-[var(--on-ink)]">
            {t("table.you", "You")}
          </span>
        )}
      </span>
      <span className="text-right text-[14px] tabular-nums text-[var(--t2)] max-[640px]:hidden">
        {typeof entry.settledCount === "number" ? entry.settledCount : "—"}
      </span>
      <span className="text-right text-[14px] font-semibold tabular-nums text-[var(--t1)]">
        {formatMetric(board, entry.metricValue)}
      </span>
    </li>
  );
}

function StandingPanel({
  boards,
  standing,
  selectedId,
  onSelect,
}: {
  boards: LeaderboardDefinition[];
  standing: Map<string, LeaderboardEntry>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation("leaderboards");
  const ranked = boards.filter((b) => standing.has(b.id));
  return (
    <aside className={`${CARD_CLASS} p-5`} aria-labelledby="lb-standing-title">
      <h2 id="lb-standing-title" className="m-0 text-[16px] font-semibold text-[var(--t1)]">
        {t("standing.title", "Your standing")}
      </h2>
      {ranked.length === 0 ? (
        <p className="m-0 mt-2 text-[13px] leading-normal text-[var(--t3)]">
          {t("standing.empty", "Settle markets to earn a place on the boards.")}
        </p>
      ) : (
        <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
          {ranked.map((board) => {
            const entry = standing.get(board.id);
            if (!entry) return null;
            const active = board.id === selectedId;
            return (
              <li key={board.id}>
                <button
                  type="button"
                  onClick={() => onSelect(board.id)}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-[var(--r-rh-md)] border-0 px-3 py-2.5 text-left transition-colors duration-150 ${
                    active ? "bg-[var(--surface-2)]" : "bg-transparent hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-[var(--t1)]">{boardName(board, t)}</span>
                    <span className="block text-[12px] tabular-nums text-[var(--t3)]">
                      {formatMetric(board, entry.metricValue)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[18px] font-semibold tabular-nums text-[var(--t1)]">#{entry.rank}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
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
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className={`${CARD_CLASS} max-w-[440px] p-7 text-center`}>
        <p className="m-0 mb-3.5 leading-[1.6] text-[var(--t2)]">{message}</p>
        {cta && (
          <Button variant="primary" size="lg" render={<Link href={cta.href} />}>
            {cta.label}
          </Button>
        )}
      </div>
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
