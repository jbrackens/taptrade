"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card } from "../components/ui";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { ActiveBonusesControl } from "./ActiveBonusesControl";
import { getActiveBonuses, type PlayerBonus } from "../lib/api/bonus-client";
import {
  getLoyaltyStanding,
  getLoyaltyLedger,
  getLoyaltyTiers,
  type LoyaltyStanding,
  type LoyaltyLedgerEntry,
  type LoyaltyTier,
} from "../lib/api/loyalty-client";
import {
  claimDailyPoints,
  claimMission,
  claimPointPack,
  claimStreak,
  getBadges,
  getBalance,
  getMissions,
  getPointPacks,
  getRewardLimitStatus,
  getStreaks,
  type Badge,
  type Mission,
  type PointPack,
  type RewardLimitStatus,
  type Streak,
} from "../lib/api/wallet-client";
import { logger } from "../lib/logger";
import { formatPointsAmount } from "../lib/points";
import { useAppDispatch } from "../lib/store/hooks";
import { setCurrentBalance } from "../lib/store/pointBalanceSlice";

// /rewards — Predict-native loyalty center. Layout follows PLAN-loyalty-
// leaderboards.md §5: horizontal tier ladder strip at top, 2fr/1fr grid of
// tier card + ledger table below. No illustrations, no centered hero, no
// tier-circle icons, no "Congrats!" copy. Points render whole (unit model
// 2026-07-07: wire integers ARE whole Points — never ÷100) via lib/points.

const LEDGER_LIMIT = 20;

const WRAP_CLASS = "mx-auto max-w-[1120px] pb-[60px] max-[768px]:px-4";
const HEAD_CLASS = "mb-[22px] flex items-end justify-between gap-4";
// Micro-label eyebrow: mono, uppercase, tracked wide (DESIGN.md §4).
const KICKER_CLASS =
  "mb-1.5 inline-block text-[12px] font-semibold text-[var(--t3)]";
const TITLE_CLASS =
  "type-poster m-0 text-[28px] text-[var(--t1)] max-[768px]:text-[24px]";
const CROSS_LINK_CLASS =
  "border-b border-[var(--border-1)] pb-0.5 text-[13px] text-[var(--t2)] hover:border-[var(--accent)] hover:text-[var(--t1)]";
const LADDER_CLASS =
  "mb-[22px] grid grid-cols-5 gap-2 max-[768px]:grid-flow-col max-[768px]:auto-cols-[140px] max-[768px]:grid-cols-none max-[768px]:overflow-x-auto max-[768px]:[scroll-snap-type:x_mandatory]";
const LADDER_STEP_BASE_CLASS =
  "relative flex flex-col gap-1.5 rounded-[var(--r-rh-md)] border-x border-b border-x-[var(--border-1)] border-b-[var(--border-1)] border-t-[3px] bg-[var(--surface-1)] px-3.5 pb-3.5 pt-4 max-[768px]:[scroll-snap-align:start]";
const LADDER_NAME_CLASS = "text-sm font-bold text-[var(--t1)]";
const LADDER_THRESHOLD_CLASS =
  "text-xs text-[var(--t3)] tabular-nums font-mono";
const GRID_CLASS =
  "grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-[18px] max-[1024px]:grid-cols-1";
// Surface cards now render via the Card primitive (padding="lg").
const TIER_CARD_HEAD_CLASS =
  "mb-[18px] flex items-baseline justify-between gap-3";
const TIER_PILL_BASE_CLASS =
  "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-bold tracking-[0.04em] text-[var(--t1)]";
const BALANCE_CLASS =
  "mono-wide m-0 text-[34px] font-extrabold tracking-[-0.02em] text-[var(--t1)] tabular-nums font-mono max-[768px]:text-[28px]";
const BALANCE_UNIT_CLASS = "ml-1 text-sm font-medium text-[var(--t3)]";
const PROGRESS_CLASS = "mb-5";
const PROGRESS_HEAD_CLASS =
  "mb-2 flex justify-between text-[13px] text-[var(--t2)]";
const PROGRESS_PCT_CLASS =
  "font-bold text-[var(--t1)] tabular-nums font-mono";
const PROGRESS_TRACK_CLASS =
  "block h-2 w-full overflow-hidden rounded-full border border-[var(--border-1)] bg-[var(--surface-2)] [appearance:none] [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-[var(--reward)] [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-[var(--reward)] [&::-webkit-progress-value]:transition-all [&::-webkit-progress-value]:duration-[240ms] [&::-webkit-progress-value]:ease-out";
const TOPPED_OUT_CLASS = "m-0 mb-5 text-sm text-[var(--t2)]";
const BENEFITS_TITLE_CLASS =
  "m-0 mb-2.5 text-[13px] font-semibold text-[var(--t3)]";
const BENEFITS_LIST_CLASS = "m-0 flex list-none flex-col gap-2.5 p-0";
const BENEFIT_CLASS =
  "grid grid-cols-[10px_1fr_auto] items-center gap-2.5 text-sm text-[var(--t1)]";
const BENEFIT_DOT_BASE_CLASS = "size-2.5 rounded-full";
const BENEFIT_SOURCE_CLASS =
  "text-[12px] text-[var(--t3)]";
const CLAIM_WRAP_CLASS =
  "mb-5 mt-6 border-t border-[var(--border-1)] pt-5 text-left";
const CLAIM_TITLE_CLASS =
  "m-0 mb-1 text-[13px] font-semibold text-[var(--t3)]";
const CLAIM_BODY_CLASS = "m-0 mb-3 text-sm leading-[1.55] text-[var(--t2)]";
const CLAIM_STATUS_CLASS = "mt-3 text-xs leading-[1.5] text-[var(--t2)]";
const PACKS_LIST_CLASS = "mt-3 flex flex-col gap-2";
const PACK_ROW_CLASS =
  "flex items-center justify-between gap-3 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-3";
const PACK_NAME_CLASS = "m-0 text-sm font-bold text-[var(--t1)]";
const PACK_DESC_CLASS = "m-0 mt-0.5 text-xs leading-[1.45] text-[var(--t3)]";
// Generic point balance — ink, not the reward pink (pink is reserved for
// progress bars and streak highlights, DESIGN.md §3.2 + the Kilig brief).
const PACK_AMOUNT_CLASS =
  "whitespace-nowrap text-sm font-bold text-[var(--t1)] tabular-nums font-mono";
const MISSION_PROGRESS_CLASS =
  "mt-1 text-xs text-[var(--t3)] tabular-nums font-mono";
// Streak highlight: the one progress figure licensed to read in Kilig pink.
const STREAK_PROGRESS_CLASS =
  "mt-1 text-xs font-semibold text-[var(--reward-text)] tabular-nums font-mono";
const BADGE_GRID_CLASS = "mt-3 grid grid-cols-3 gap-2 max-[768px]:grid-cols-1";
const BADGE_CARD_BASE_CLASS = "rounded-[var(--r-rh-md)] border p-3 text-left";
// Earned = the raised-well selection treatment (ink), never pink — badges
// are a status marker, not a progress/streak signal.
const BADGE_EARNED_CLASS = "border-[var(--border-2)] bg-[var(--surface-2)]";
const BADGE_LOCKED_CLASS =
  "border-[var(--border-1)] bg-[var(--surface-1)] opacity-60";
const BADGE_STATUS_CLASS =
  "mt-2 text-[12px] font-semibold text-[var(--t3)]";
const LIMIT_CLASS =
  "mb-5 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-3 text-left";
const LEDGER_HEAD_CLASS = "mb-3.5 flex items-baseline justify-between";
const LEDGER_TITLE_CLASS = "m-0 text-base font-bold text-[var(--t1)]";
const LEDGER_META_CLASS = "text-xs text-[var(--t3)]";
const LEDGER_EMPTY_CLASS = "py-10 text-center text-[13px] text-[var(--t3)]";
const LEDGER_TABLE_CLASS =
  "w-full border-collapse text-[13px] [&_td]:border-b [&_td]:border-[var(--border-1)] [&_td]:px-1.5 [&_td]:py-2.5 [&_td]:align-top [&_th]:border-b [&_th]:border-[var(--border-1)] [&_th]:px-1.5 [&_th]:py-2.5 [&_th]:align-top [&_th]:text-[11px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.08em] [&_th]:text-[var(--t3)]";
const TEXT_LEFT_CLASS = "text-left";
const NUM_CLASS = "text-right";
const MONO_CLASS =
  "tabular-nums font-mono";
const DATE_CLASS = `${MONO_CLASS} whitespace-nowrap text-[var(--t2)]`;
const EVENT_CLASS = "text-[var(--t1)]";
const REASON_CLASS = "mt-0.5 text-xs text-[var(--t3)]";
// Ledger deltas are generic point-balance changes, not market P&L — ink
// carries the signal (weight), not colour.
const POS_CLASS = "font-semibold text-[var(--t1)]";
const NEG_CLASS = "text-[var(--t2)]";
const SUBTLE_CLASS = "text-[var(--t3)]";
const STATE_CLASS = "flex min-h-[60vh] items-center justify-center px-6";
const PREFIRST_CARD_CLASS = "w-full max-w-[440px] text-center";
const PREFIRST_TITLE_CLASS = "type-poster m-0 mb-2.5 text-[22px] text-[var(--t1)]";
const PREFIRST_BODY_CLASS = "m-0 mb-5 text-sm leading-[1.6] text-[var(--t2)]";
// CTA / claim-button / state-card recipes migrated to the Button and Card
// primitives (primary lg; lift-hover and 13px text unified away).
const STATE_MESSAGE_CLASS = "m-0 mb-3.5 leading-[1.6] text-[var(--t2)]";

function tierColorClass(tier: number, target: "ladder" | "pill" | "dot") {
  switch (tier) {
    case 1:
      if (target === "ladder") return "[border-top-color:var(--tier-1)]";
      if (target === "pill")
        return "border bg-[color-mix(in_srgb,var(--tier-1)_14%,transparent)] [border-color:color-mix(in_srgb,var(--tier-1)_30%,transparent)]";
      return "bg-[var(--tier-1)]";
    case 2:
      if (target === "ladder") return "[border-top-color:var(--tier-2)]";
      if (target === "pill")
        return "border bg-[color-mix(in_srgb,var(--tier-2)_14%,transparent)] [border-color:color-mix(in_srgb,var(--tier-2)_30%,transparent)]";
      return "bg-[var(--tier-2)]";
    case 3:
      if (target === "ladder") return "[border-top-color:var(--tier-3)]";
      if (target === "pill")
        return "border bg-[color-mix(in_srgb,var(--tier-3)_14%,transparent)] [border-color:color-mix(in_srgb,var(--tier-3)_30%,transparent)]";
      return "bg-[var(--tier-3)]";
    case 4:
      if (target === "ladder") return "[border-top-color:var(--tier-4)]";
      if (target === "pill")
        return "border bg-[color-mix(in_srgb,var(--tier-4)_14%,transparent)] [border-color:color-mix(in_srgb,var(--tier-4)_30%,transparent)]";
      return "bg-[var(--tier-4)]";
    case 5:
      if (target === "ladder") return "[border-top-color:var(--tier-5)]";
      if (target === "pill")
        return "border bg-[color-mix(in_srgb,var(--tier-5)_14%,transparent)] [border-color:color-mix(in_srgb,var(--tier-5)_30%,transparent)]";
      return "bg-[var(--tier-5)]";
    default:
      if (target === "ladder") return "[border-top-color:var(--border-2)]";
      if (target === "pill")
        return "border border-[var(--border-1)] bg-[var(--surface-2)]";
      return "bg-[var(--border-2)]";
  }
}

function currentTierBorderClass(tier: number) {
  switch (tier) {
    case 1:
      return "[border-bottom-color:var(--tier-1)] [border-left-color:var(--tier-1)] [border-right-color:var(--tier-1)]";
    case 2:
      return "[border-bottom-color:var(--tier-2)] [border-left-color:var(--tier-2)] [border-right-color:var(--tier-2)]";
    case 3:
      return "[border-bottom-color:var(--tier-3)] [border-left-color:var(--tier-3)] [border-right-color:var(--tier-3)]";
    case 4:
      return "[border-bottom-color:var(--tier-4)] [border-left-color:var(--tier-4)] [border-right-color:var(--tier-4)]";
    case 5:
      return "[border-bottom-color:var(--tier-5)] [border-left-color:var(--tier-5)] [border-right-color:var(--tier-5)]";
    default:
      return "[border-bottom-color:var(--border-1)] [border-left-color:var(--border-1)] [border-right-color:var(--border-1)]";
  }
}

export default function RewardsPage() {
  const { t } = useTranslation("rewards");
  const { user, isLoading: authLoading } = useAuth();
  const dispatch = useAppDispatch();
  const [standing, setStanding] = useState<LoyaltyStanding | null>(null);
  const [ledger, setLedger] = useState<LoyaltyLedgerEntry[]>([]);
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dailyClaimLoading, setDailyClaimLoading] = useState(false);
  const [dailyClaimMessage, setDailyClaimMessage] = useState<string | null>(
    null,
  );
  const [pointPacks, setPointPacks] = useState<PointPack[]>([]);
  const [pointPackLoadingId, setPointPackLoadingId] = useState<string | null>(
    null,
  );
  const [pointPackMessage, setPointPackMessage] = useState<string | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionLoadingId, setMissionLoadingId] = useState<string | null>(null);
  const [missionMessage, setMissionMessage] = useState<string | null>(null);
  const [streaks, setStreaks] = useState<Streak[]>([]);
  const [streakLoadingId, setStreakLoadingId] = useState<string | null>(null);
  const [streakMessage, setStreakMessage] = useState<string | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [rewardLimit, setRewardLimit] = useState<RewardLimitStatus | null>(
    null,
  );
  const [activeBonuses, setActiveBonuses] = useState<PlayerBonus[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: t is read only in error paths — depending on it would refetch loyalty data on language switch
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!user?.id) {
        setStanding(null);
        setLedger([]);
        setTiers([]);
        setPointPacks([]);
        setMissions([]);
        setStreaks([]);
        setBadges([]);
        setRewardLimit(null);
        setActiveBonuses([]);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const [
          standingResult,
          ledgerResult,
          tiersResult,
          packsResult,
          missionsResult,
          streaksResult,
          badgesResult,
          rewardLimitResult,
          activeBonusesResult,
        ] = await Promise.all([
          getLoyaltyStanding(),
          getLoyaltyLedger(LEDGER_LIMIT),
          getLoyaltyTiers(),
          getPointPacks(),
          getMissions(),
          getStreaks(),
          getBadges(),
          getRewardLimitStatus(),
          getActiveBonuses(),
        ]);
        if (cancelled) return;
        setStanding(standingResult);
        setLedger(ledgerResult);
        setTiers(tiersResult);
        setPointPacks(packsResult);
        setMissions(missionsResult);
        setStreaks(streaksResult);
        setBadges(badgesResult);
        setRewardLimit(rewardLimitResult);
        setActiveBonuses(activeBonusesResult);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : t("errors.loadRewards", "Failed to load rewards");
        logger.error("Rewards", "loyalty fetch failed", message);
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Visible tier list excludes tier 0 (the "hidden" state before any activity).
  const visibleTiers = useMemo(
    () => tiers.filter((t) => t.rank >= 1).sort((a, b) => a.rank - b.rank),
    [tiers],
  );

  const progressPct = useMemo(() => {
    if (!standing || visibleTiers.length === 0) return 0;
    const curr = visibleTiers.find((t) => t.rank === standing.rank);
    const next = visibleTiers.find((t) => t.rank === standing.nextRank);
    if (!curr || !next) return 100;
    const span = Math.max(1, next.minXpPoints - curr.minXpPoints);
    const advanced = Math.max(0, standing.pointsBalance - curr.minXpPoints);
    return Math.min(100, Math.max(0, (advanced / span) * 100));
  }, [standing, visibleTiers]);

  const dailyClaimed = useMemo(
    () =>
      missions.some(
        (mission) => mission.id === "daily_check_in" && mission.completed,
      ),
    [missions],
  );

  // The claim helpers in wallet-client invalidate the balance cache but the
  // TopBar pill reads Redux — without a dispatch it stayed stale until the
  // next navigation. After any successful claim, fetch the fresh balance
  // (cache was just invalidated) and push it into pointBalanceSlice.
  async function refreshHeaderBalance() {
    if (!user?.id) return;
    try {
      const bal = await getBalance(user.id);
      dispatch(setCurrentBalance(bal.availableBalance));
    } catch (err: unknown) {
      logger.warn("Rewards", "post-claim balance refresh failed", err);
    }
  }

  async function refreshRewardCollections() {
    const [
      packsResult,
      missionsResult,
      streaksResult,
      badgesResult,
      rewardLimitResult,
      activeBonusesResult,
    ] = await Promise.all([
      getPointPacks(),
      getMissions(),
      getStreaks(),
      getBadges(),
      getRewardLimitStatus(),
      getActiveBonuses(),
    ]);
    setPointPacks(packsResult);
    setMissions(missionsResult);
    setStreaks(streaksResult);
    setBadges(badgesResult);
    setRewardLimit(rewardLimitResult);
    setActiveBonuses(activeBonusesResult);
  }

  async function handleDailyClaim() {
    if (!user?.id || dailyClaimLoading || dailyClaimed) return;
    setDailyClaimLoading(true);
    setDailyClaimMessage(null);
    try {
      const result = await claimDailyPoints(user.id);
      if (!result) {
        setDailyClaimMessage(
          t(
            "dailyClaim.error",
            "Daily claim could not be recorded. Try again shortly.",
          ),
        );
        return;
      }
      if (!result.enabled) {
        setDailyClaimMessage(
          t("dailyClaim.disabled", "Daily claim is not available right now."),
        );
        return;
      }
      setDailyClaimMessage(
        t(
          "dailyClaim.success",
          "Today's claim is recorded: {{points}} pts added to your point ledger.",
          {
            points: formatPointsAmount(result.claimPoints ?? 0),
          },
        ),
      );
      if (result.rewardLimit) {
        setRewardLimit(result.rewardLimit);
      }
      void refreshHeaderBalance();
      await refreshRewardCollections();
    } finally {
      setDailyClaimLoading(false);
    }
  }

  async function handlePointPackClaim(packId: string) {
    if (!user?.id || pointPackLoadingId) return;
    setPointPackLoadingId(packId);
    setPointPackMessage(null);
    try {
      const result = await claimPointPack(user.id, packId);
      if (!result?.enabled) {
        setPointPackMessage(
          t(
            "pointPacks.error",
            "Point pack could not be recorded. Try again shortly.",
          ),
        );
        return;
      }
      setPointPackMessage(
        t("pointPacks.success", "{{points}} pts added to your point ledger.", {
          points: formatPointsAmount(result.claimPoints ?? 0),
        }),
      );
      if (result.rewardLimit) {
        setRewardLimit(result.rewardLimit);
      }
      void refreshHeaderBalance();
      await refreshRewardCollections();
    } finally {
      setPointPackLoadingId(null);
    }
  }

  async function handleMissionClaim(missionId: string) {
    if (!user?.id || missionLoadingId) return;
    setMissionLoadingId(missionId);
    setMissionMessage(null);
    try {
      const result = await claimMission(user.id, missionId);
      if (!result?.enabled) {
        setMissionMessage(
          t(
            "missions.error",
            "Mission reward could not be recorded. Try again shortly.",
          ),
        );
        return;
      }
      setMissionMessage(
        t("missions.success", "{{points}} pts added to your point ledger.", {
          points: formatPointsAmount(result.claimPoints ?? 0),
        }),
      );
      if (result.mission) {
        setMissions((current) =>
          current.map((mission) =>
            mission.id === result.mission?.id ? result.mission : mission,
          ),
        );
      }
      if (result.rewardLimit) {
        setRewardLimit(result.rewardLimit);
      }
      void refreshHeaderBalance();
      void refreshRewardCollections();
    } finally {
      setMissionLoadingId(null);
    }
  }

  async function handleStreakClaim(streakId: string) {
    if (!user?.id || streakLoadingId) return;
    setStreakLoadingId(streakId);
    setStreakMessage(null);
    try {
      const result = await claimStreak(user.id, streakId);
      if (!result?.enabled) {
        setStreakMessage(
          t(
            "streaks.error",
            "Streak reward could not be recorded. Try again shortly.",
          ),
        );
        return;
      }
      setStreakMessage(
        t("streaks.success", "{{points}} pts added to your point ledger.", {
          points: formatPointsAmount(result.claimPoints ?? 0),
        }),
      );
      if (result.streak) {
        setStreaks((current) =>
          current.map((streak) =>
            streak.id === result.streak?.id ? result.streak : streak,
          ),
        );
      }
      if (result.rewardLimit) {
        setRewardLimit(result.rewardLimit);
      }
      void refreshHeaderBalance();
      void refreshRewardCollections();
    } finally {
      setStreakLoadingId(null);
    }
  }

  if (authLoading || loading) {
    return <PageState message={t("state.loading", "Loading rewards…")} />;
  }
  if (!user?.id) {
    return (
      <PageState
        message={t(
          "state.signIn",
          "Sign in to view your tier, points balance, and recent activity.",
        )}
        cta={{ href: "/auth/login", label: t("state.login", "Log in") }}
      />
    );
  }
  if (error) {
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

  // Pre-first-settle: full-page empty state with a CTA. Plan §3.
  if (!standing || standing.rank === 0) {
    return (
      <PreFirstSettleState
        dailyClaim={{
          loading: dailyClaimLoading,
          claimed: dailyClaimed,
          message: dailyClaimMessage,
          onClaim: handleDailyClaim,
        }}
        pointPacks={{
          packs: pointPacks,
          loadingPackId: pointPackLoadingId,
          message: pointPackMessage,
          onClaim: handlePointPackClaim,
        }}
        missions={{
          missions,
          loadingMissionId: missionLoadingId,
          message: missionMessage,
          onClaim: handleMissionClaim,
        }}
        streaks={{
          streaks,
          loadingStreakId: streakLoadingId,
          message: streakMessage,
          onClaim: handleStreakClaim,
        }}
        badges={badges}
        rewardLimit={rewardLimit}
        activeBonuses={activeBonuses}
      />
    );
  }

  return (
    <div className={WRAP_CLASS}>
      <header className={HEAD_CLASS}>
        <div>
          <span className={KICKER_CLASS}>{t("kickerShort", "Rewards")}</span>
          <h1 className={TITLE_CLASS}>{t("loyaltyTitle", "Loyalty")}</h1>
        </div>
        <Link href="/leaderboards" className={CROSS_LINK_CLASS}>
          {t("viewLeaderboards", "View leaderboards")} →
        </Link>
      </header>

      <TierLadder tiers={visibleTiers} current={standing.rank} />

      <div className={GRID_CLASS}>
        <Card
          as="section"
          padding="lg"
          className="relative"
          aria-labelledby="rw-tier-title"
        >
          <header className={TIER_CARD_HEAD_CLASS}>
            <span
              className={`${TIER_PILL_BASE_CLASS} ${tierColorClass(
                standing.rank,
                "pill",
              )}`}
            >
              {standing.rankName}
            </span>
            <h2 id="rw-tier-title" className={BALANCE_CLASS}>
              {formatPointsAmount(standing.pointsBalance)}
              <span className={BALANCE_UNIT_CLASS}>
                {" "}
                {t("pointsShort", "pts")}
              </span>
            </h2>
          </header>

          {standing.nextRankName ? (
            <div className={PROGRESS_CLASS}>
              <div className={PROGRESS_HEAD_CLASS}>
                <span>
                  {t("progress.pointsTo", "{{points}} pts to", {
                    points: formatPointsAmount(standing.xpToNextRank),
                  })}{" "}
                  <strong>{standing.nextRankName}</strong>
                </span>
                <span className={PROGRESS_PCT_CLASS}>
                  {Math.round(progressPct)}%
                </span>
              </div>
              <progress
                className={PROGRESS_TRACK_CLASS}
                value={progressPct}
                max={100}
                aria-label={t("progress.label", "Tier progress")}
              />
            </div>
          ) : (
            <p className={TOPPED_OUT_CLASS}>
              {t(
                "progress.topTier",
                "Top tier reached — thanks for trading with us.",
              )}
            </p>
          )}

          <BenefitsList tiers={visibleTiers} current={standing.rank} />
          <StoreCrossLink />
          <RewardLimitControl status={rewardLimit} />
          <ActiveBonusesControl bonuses={activeBonuses} />
          <DailyClaimControl
            loading={dailyClaimLoading}
            claimed={dailyClaimed}
            message={dailyClaimMessage}
            onClaim={handleDailyClaim}
          />
          <PointPacksControl
            packs={pointPacks}
            loadingPackId={pointPackLoadingId}
            message={pointPackMessage}
            onClaim={handlePointPackClaim}
          />
          <MissionsControl
            missions={missions}
            loadingMissionId={missionLoadingId}
            message={missionMessage}
            onClaim={handleMissionClaim}
          />
          <StreaksControl
            streaks={streaks}
            loadingStreakId={streakLoadingId}
            message={streakMessage}
            onClaim={handleStreakClaim}
          />
          <BadgesControl badges={badges} />
        </Card>

        <Card
          as="section"
          padding="lg"
          className="relative"
          aria-labelledby="rw-ledger-title"
        >
          <header className={LEDGER_HEAD_CLASS}>
            <h3 id="rw-ledger-title" className={LEDGER_TITLE_CLASS}>
              {t("ledger.title", "Recent activity")}
            </h3>
            <span className={LEDGER_META_CLASS}>
              {t("ledger.entries", "{{count}} entries", {
                count: ledger.length,
              })}
            </span>
          </header>
          {ledger.length === 0 ? (
            <div className={LEDGER_EMPTY_CLASS}>
              {t(
                "ledger.empty",
                "No activity yet — settle a market to start earning.",
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className={LEDGER_TABLE_CLASS}>
              <caption className="sr-only">
                {t(
                  "ledger.caption",
                  "Recent loyalty ledger entries for {{name}}",
                  { name: user.username || user.id },
                )}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={TEXT_LEFT_CLASS}>
                    {t("ledger.date", "Date")}
                  </th>
                  <th scope="col" className={TEXT_LEFT_CLASS}>
                    {t("ledger.event", "Event")}
                  </th>
                  <th scope="col" className={NUM_CLASS}>
                    {t("ledger.change", "Change")}
                  </th>
                  <th scope="col" className={NUM_CLASS}>
                    {t("ledger.balance", "Balance")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id}>
                    <td className={DATE_CLASS}>
                      {formatDate(entry.createdAt)}
                    </td>
                    <td>
                      <div className={EVENT_CLASS}>
                        {labelForEntry(entry, t)}
                      </div>
                      {shouldShowReason(entry) && (
                        <div className={REASON_CLASS}>{entry.reason}</div>
                      )}
                    </td>
                    <td
                      className={`${MONO_CLASS} ${NUM_CLASS} ${
                        entry.deltaPoints >= 0 ? POS_CLASS : NEG_CLASS
                      }`}
                    >
                      {entry.deltaPoints >= 0 ? "+" : ""}
                      {formatPointsAmount(entry.deltaPoints)}
                    </td>
                    <td
                      className={`${MONO_CLASS} ${NUM_CLASS} ${SUBTLE_CLASS}`}
                    >
                      {formatPointsAmount(entry.balanceAfter)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

interface DailyClaimControlProps {
  loading: boolean;
  claimed: boolean;
  message: string | null;
  onClaim: () => void;
}

interface PointPacksControlProps {
  packs: PointPack[];
  loadingPackId: string | null;
  message: string | null;
  onClaim: (packId: string) => void;
}

interface MissionsControlProps {
  missions: Mission[];
  loadingMissionId: string | null;
  message: string | null;
  onClaim: (missionId: string) => void;
}

interface StreaksControlProps {
  streaks: Streak[];
  loadingStreakId: string | null;
  message: string | null;
  onClaim: (streakId: string) => void;
}

// Cross-link into the purchasable Point Store (a separate surface from the
// free claimable packs above — those stay operator-granted).
function StoreCrossLink() {
  const { t } = useTranslation("store");
  return (
    <div className={LIMIT_CLASS}>
      <h3 className={CLAIM_TITLE_CLASS}>
        {t("entry.needMore", "Need more points?")}
      </h3>
      <Link
        href="/store"
        className={CROSS_LINK_CLASS}
        data-testid="add-points-rewards"
      >
        {t("entry.visitStore", "Visit the Point Store")} →
      </Link>
    </div>
  );
}

function RewardLimitControl({ status }: { status: RewardLimitStatus | null }) {
  const { t } = useTranslation("rewards");
  if (!status?.enabled) return null;
  return (
    <div className={LIMIT_CLASS}>
      <h3 className={CLAIM_TITLE_CLASS}>
        {t("rewardLimit.title", "Daily reward limit")}
      </h3>
      <p className={CLAIM_BODY_CLASS}>
        {t(
          "rewardLimit.body",
          "{{remaining}} of {{limit}} reward pts remain for today.",
          {
            remaining: formatPointsAmount(status.remainingPoints),
            limit: formatPointsAmount(status.limitPoints),
          },
        )}
      </p>
      <div className={MISSION_PROGRESS_CLASS}>
        {t("rewardLimit.reset", "Resets {{date}}", {
          date: new Date(status.nextResetAt).toLocaleString(),
        })}
      </div>
    </div>
  );
}

function DailyClaimControl({
  loading,
  claimed,
  message,
  onClaim,
}: DailyClaimControlProps) {
  const { t } = useTranslation("rewards");
  return (
    <div className={CLAIM_WRAP_CLASS}>
      <h3 className={CLAIM_TITLE_CLASS}>
        {t("dailyClaim.title", "Daily claim")}
      </h3>
      <p className={CLAIM_BODY_CLASS}>
        {t(
          "dailyClaim.body",
          "Claim non-redeemable gameplay points once per day for predictions only.",
        )}
      </p>
      <Button
        variant="primary"
        size="lg"
        disabled={loading || claimed}
        onClick={onClaim}
      >
        {loading
          ? t("dailyClaim.claiming", "Claiming")
          : claimed
            ? t("dailyClaim.claimed", "Claimed today")
            : t("dailyClaim.cta", "Claim today")}
      </Button>
      {message && <div className={CLAIM_STATUS_CLASS}>{message}</div>}
    </div>
  );
}

function PointPacksControl({
  packs,
  loadingPackId,
  message,
  onClaim,
}: PointPacksControlProps) {
  const { t } = useTranslation("rewards");
  if (packs.length === 0) return null;
  return (
    <div className={CLAIM_WRAP_CLASS}>
      <h3 className={CLAIM_TITLE_CLASS}>
        {t("pointPacks.title", "Point packs")}
      </h3>
      <p className={CLAIM_BODY_CLASS}>
        {t(
          "pointPacks.body",
          "Claim configured one-time gameplay point packs for predictions only.",
        )}
      </p>
      <p className={CLAIM_BODY_CLASS}>
        {t(
          "pointPacks.disclosure",
          "Points are non-redeemable gameplay points with no cashout, withdrawal, crypto, fiat, or prize path.",
        )}
      </p>
      <div className={PACKS_LIST_CLASS}>
        {packs.map((pack) => (
          <div key={pack.id} className={PACK_ROW_CLASS}>
            <div>
              <p className={PACK_NAME_CLASS}>{pack.name}</p>
              <p className={PACK_DESC_CLASS}>{pack.description}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={PACK_AMOUNT_CLASS}>
                {formatPointsAmount(pack.amountPoints)}
              </span>
              <Button
                variant="primary"
                size="lg"
                disabled={
                  !pack.enabled ||
                  Boolean(pack.claimed) ||
                  loadingPackId !== null
                }
                onClick={() => onClaim(pack.id)}
              >
                {loadingPackId === pack.id
                  ? t("pointPacks.claiming", "Claiming")
                  : pack.claimed
                    ? t("pointPacks.claimed", "Claimed")
                    : pack.enabled
                      ? t("pointPacks.cta", "Claim")
                      : t("pointPacks.unavailable", "Unavailable")}
              </Button>
            </div>
          </div>
        ))}
      </div>
      {message && <div className={CLAIM_STATUS_CLASS}>{message}</div>}
    </div>
  );
}

function MissionsControl({
  missions,
  loadingMissionId,
  message,
  onClaim,
}: MissionsControlProps) {
  const { t } = useTranslation("rewards");
  if (missions.length === 0) return null;
  return (
    <div className={CLAIM_WRAP_CLASS}>
      <h3 className={CLAIM_TITLE_CLASS}>{t("missions.title", "Missions")}</h3>
      <p className={CLAIM_BODY_CLASS}>
        {t(
          "missions.body",
          "Complete gameplay missions to earn non-redeemable reward points.",
        )}
      </p>
      <div className={PACKS_LIST_CLASS}>
        {missions.map((mission) => (
          <div key={mission.id} className={PACK_ROW_CLASS}>
            <div>
              <p className={PACK_NAME_CLASS}>{mission.name}</p>
              <p className={PACK_DESC_CLASS}>{mission.description}</p>
              <div className={MISSION_PROGRESS_CLASS}>
                {t("missions.progress", "{{progress}} / {{target}} complete", {
                  progress: mission.progress,
                  target: mission.target,
                })}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={PACK_AMOUNT_CLASS}>
                {formatPointsAmount(mission.rewardPoints)}
              </span>
              <Button
                variant="primary"
                size="lg"
                disabled={
                  !mission.enabled ||
                  !mission.completed ||
                  mission.claimed ||
                  loadingMissionId !== null
                }
                onClick={() => onClaim(mission.id)}
              >
                {loadingMissionId === mission.id
                  ? t("missions.claiming", "Claiming")
                  : mission.claimed
                    ? t("missions.claimed", "Claimed")
                    : mission.completed
                      ? t("missions.cta", "Claim")
                      : t("missions.incomplete", "Incomplete")}
              </Button>
            </div>
          </div>
        ))}
      </div>
      {message && <div className={CLAIM_STATUS_CLASS}>{message}</div>}
    </div>
  );
}

function StreaksControl({
  streaks,
  loadingStreakId,
  message,
  onClaim,
}: StreaksControlProps) {
  const { t } = useTranslation("rewards");
  if (streaks.length === 0) return null;
  return (
    <div className={CLAIM_WRAP_CLASS}>
      <h3 className={CLAIM_TITLE_CLASS}>{t("streaks.title", "Streaks")}</h3>
      <p className={CLAIM_BODY_CLASS}>
        {t(
          "streaks.body",
          "Keep daily gameplay-point claims going to earn non-redeemable streak rewards.",
        )}
      </p>
      <div className={PACKS_LIST_CLASS}>
        {streaks.map((streak) => (
          <div key={streak.id} className={PACK_ROW_CLASS}>
            <div>
              <p className={PACK_NAME_CLASS}>{streak.name}</p>
              <p className={PACK_DESC_CLASS}>{streak.description}</p>
              <div className={STREAK_PROGRESS_CLASS}>
                {t("streaks.progress", "{{current}} / {{target}} days", {
                  current: streak.currentStreak,
                  target: streak.target,
                })}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={PACK_AMOUNT_CLASS}>
                {formatPointsAmount(streak.rewardPoints)}
              </span>
              <Button
                variant="primary"
                size="lg"
                disabled={
                  !streak.enabled ||
                  !streak.completed ||
                  streak.claimed ||
                  loadingStreakId !== null
                }
                onClick={() => onClaim(streak.id)}
              >
                {loadingStreakId === streak.id
                  ? t("streaks.claiming", "Claiming")
                  : streak.claimed
                    ? t("streaks.claimed", "Claimed")
                    : streak.completed
                      ? t("streaks.cta", "Claim")
                      : t("streaks.incomplete", "Incomplete")}
              </Button>
            </div>
          </div>
        ))}
      </div>
      {message && <div className={CLAIM_STATUS_CLASS}>{message}</div>}
    </div>
  );
}

function BadgesControl({ badges }: { badges: Badge[] }) {
  const { t } = useTranslation("rewards");
  if (badges.length === 0) return null;
  return (
    <div className={CLAIM_WRAP_CLASS}>
      <h3 className={CLAIM_TITLE_CLASS}>{t("badges.title", "Badges")}</h3>
      <p className={CLAIM_BODY_CLASS}>
        {t(
          "badges.body",
          "Unlock cosmetic badges from gameplay milestones. Badges are non-redeemable status markers.",
        )}
      </p>
      <div className={BADGE_GRID_CLASS}>
        {badges.map((badge) => (
          <div
            key={badge.id}
            className={`${BADGE_CARD_BASE_CLASS} ${
              badge.earned ? BADGE_EARNED_CLASS : BADGE_LOCKED_CLASS
            }`}
          >
            <p className={PACK_NAME_CLASS}>{badge.name}</p>
            <p className={PACK_DESC_CLASS}>{badge.description}</p>
            <div className={BADGE_STATUS_CLASS}>
              {badge.earned
                ? t("badges.earned", "Earned")
                : t("badges.locked", "Locked")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TierLadder({
  tiers,
  current,
}: {
  tiers: LoyaltyTier[];
  current: number;
}) {
  const { t } = useTranslation("rewards");
  return (
    <ul className={LADDER_CLASS} aria-label={t("ladder.aria", "Tier ladder")}>
      {tiers.map((t) => {
        const isCurrent = t.rank === current;
        const isPast = t.rank < current;
        return (
          <li
            key={t.rank}
            className={`${LADDER_STEP_BASE_CLASS} ${tierColorClass(
              t.rank,
              "ladder",
            )} ${
              isCurrent
                ? `bg-[var(--surface-2)] ${currentTierBorderClass(t.rank)}`
                : isPast
                  ? ""
                  : "opacity-[0.45]"
            }`}
            aria-current={isCurrent ? "step" : undefined}
          >
            <span className={LADDER_NAME_CLASS}>{t.rankName}</span>
            <span className={LADDER_THRESHOLD_CLASS}>
              {formatPointsAmount(t.minXpPoints)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function BenefitsList({
  tiers,
  current,
}: {
  tiers: LoyaltyTier[];
  current: number;
}) {
  const { t } = useTranslation("rewards");
  // Benefits are cumulative — show every benefit from tier 1 up through the
  // user's current tier. Matches plan §2.Tiers.
  const rows: Array<{ key: string; tier: number; name: string; copy: string }> =
    [];
  for (const t of tiers) {
    if (t.rank > current) continue;
    const benefits = t.benefits ?? [];
    for (let i = 0; i < benefits.length; i++) {
      rows.push({
        key: `${t.rank}-${i}`,
        tier: t.rank,
        name: t.rankName,
        copy: benefits[i],
      });
    }
  }
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className={BENEFITS_TITLE_CLASS}>
        {t("benefits.unlocked", "Unlocked")}
      </h3>
      <ul className={BENEFITS_LIST_CLASS}>
        {rows.map((row) => (
          <li key={row.key} className={BENEFIT_CLASS}>
            <span
              className={`${BENEFIT_DOT_BASE_CLASS} ${tierColorClass(
                row.tier,
                "dot",
              )}`}
              aria-hidden="true"
            />
            <span>{row.copy}</span>
            <span className={BENEFIT_SOURCE_CLASS}>{row.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreFirstSettleState({
  dailyClaim,
  pointPacks,
  missions,
  streaks,
  badges,
  rewardLimit,
  activeBonuses,
}: {
  dailyClaim: DailyClaimControlProps;
  pointPacks: PointPacksControlProps;
  missions: MissionsControlProps;
  streaks: StreaksControlProps;
  badges: Badge[];
  rewardLimit: RewardLimitStatus | null;
  activeBonuses: PlayerBonus[];
}) {
  const { t } = useTranslation("rewards");
  return (
    <div className={STATE_CLASS}>
      <div className={PREFIRST_CARD_CLASS}>
        <span className={KICKER_CLASS}>{t("kickerShort", "Rewards")}</span>
        <h1 className={PREFIRST_TITLE_CLASS}>
          {t("prefirst.title", "No activity yet")}
        </h1>
        <p className={PREFIRST_BODY_CLASS}>
          {t(
            "prefirst.body",
            "Settle your first trade to start earning points and climb the tier ladder.",
          )}
        </p>
        <StoreCrossLink />
        <RewardLimitControl status={rewardLimit} />
        <ActiveBonusesControl bonuses={activeBonuses} />
        <DailyClaimControl {...dailyClaim} />
        <MissionsControl {...missions} />
        <StreaksControl {...streaks} />
        <BadgesControl badges={badges} />
        <PointPacksControl {...pointPacks} />
        <Button variant="primary" size="lg" render={<Link href="/predict" />}>
          {t("prefirst.browse", "Browse markets")} →
        </Button>
      </div>
    </div>
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
        padding="lg"
        className="relative w-full max-w-[440px] text-center"
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

function labelForEntry(
  e: LoyaltyLedgerEntry,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (e.eventType) {
    case "accrual": {
      // Backend reason is "settled trade (won)" / "settled trade (lost)".
      // Fold the outcome into the label so the reason row doesn't duplicate it.
      const r = e.reason ?? "";
      if (r.includes("(won)"))
        return t("ledger.settledWon", "Settled trade · won");
      if (r.includes("(lost)"))
        return t("ledger.settledLost", "Settled trade · lost");
      return t("ledger.settledTrade", "Settled trade");
    }
    case "adjustment":
      return t("ledger.adjustment", "Adjustment");
    case "promotion":
      return t("ledger.promotion", "Tier promotion");
    case "migration":
      return t("ledger.migration", "Imported from legacy");
    default:
      return e.eventType;
  }
}

// shouldShowReason decides whether to render the reason line under the event
// label. For accruals we fold the win/loss outcome into the label itself, so
// rendering the reason ("settled trade (won)") would just duplicate. Other
// event types carry free-form operator notes worth surfacing.
function shouldShowReason(e: LoyaltyLedgerEntry): boolean {
  if (!e.reason) return false;
  if (e.eventType === "accrual") return false;
  return true;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
