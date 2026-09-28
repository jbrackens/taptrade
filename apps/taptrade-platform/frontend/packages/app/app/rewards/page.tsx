"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Award, CheckCircle2, Lock, SlidersHorizontal, Sparkles, TrendingUp, XCircle } from "lucide-react";
import { Button } from "../components/ui";
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

// /rewards — the rewards hub on the board's card recipe: the tier card (tier,
// loyalty points, progress and the ladder) beside a "Today" card (daily
// claim, streak, today's reward limit), then missions, streaks, point packs,
// bonuses and badges as card grids, and the benefits and recent activity at
// the foot. A player with no tier yet sees the same page with a start card.
// Points render whole (unit model 2026-07-07: wire integers ARE whole Points —
// never ÷100) via lib/points. Pink is for progress and streaks only.

const LEDGER_LIMIT = 20;

const CARD_CLASS =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] shadow-[var(--shadow-card)]";
const GRID_CLASS = "grid grid-cols-3 gap-3 max-[1024px]:grid-cols-2 max-[640px]:grid-cols-1";
const ITEM_CLASS = `${CARD_CLASS} flex flex-col p-4`;
const ITEM_NAME_CLASS = "m-0 text-[14px] font-semibold text-[var(--t1)]";
const ITEM_DESC_CLASS = "m-0 mt-1 text-[13px] leading-[1.45] text-[var(--t3)]";
const REWARD_CHIP_CLASS =
  "shrink-0 rounded-[var(--r-pill)] bg-[var(--surface-2)] px-2 py-0.5 text-[12px] font-semibold tabular-nums text-[var(--t1)]";
const STATUS_CLASS = "mt-3 text-[13px] leading-[1.5] text-[var(--t2)]";
const CROSS_LINK_CLASS =
  "inline-flex min-h-10 items-center text-[13px] font-semibold text-[var(--t2)] no-underline hover:text-[var(--t1)] hover:underline";

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

  // Before the first settled market the player has no tier: the same page,
  // with a start card where the tier card goes.
  const started = Boolean(standing && standing.rank > 0);
  const dailyStreak = streaks.find((streak) => streak.currentStreak > 0) ?? streaks[0];

  return (
    <div className="mx-auto max-w-[1080px] px-6 pb-16 pt-6 max-[640px]:px-4">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="type-poster m-0 text-[28px] text-[var(--t1)] max-[640px]:text-[24px]">
            {t("kickerShort", "Rewards")}
          </h1>
          <p className="m-0 mt-1 max-w-[560px] text-[14px] text-[var(--t3)]">
            {t(
              "PAGE_SUBTITLE",
              "Earn points from every settled trade, climb the tier ladder, and unlock benefits.",
            )}
          </p>
        </div>
        <Link href="/leaderboards" className={`${CROSS_LINK_CLASS} shrink-0`}>
          {t("viewLeaderboards", "View leaderboards")} →
        </Link>
      </header>

      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-4 max-[900px]:grid-cols-1">
        {started && standing ? (
          <TierCard standing={standing} tiers={visibleTiers} progressPct={progressPct} />
        ) : (
          <StartCard tiers={visibleTiers} />
        )}
        <section className={`${CARD_CLASS} flex flex-col p-5`} aria-labelledby="rw-today-title">
          <h2 id="rw-today-title" className="m-0 text-[16px] font-semibold text-[var(--t1)]">
            {t("today.title", "Today")}
          </h2>
          <DailyClaimControl
            loading={dailyClaimLoading}
            claimed={dailyClaimed}
            message={dailyClaimMessage}
            onClaim={handleDailyClaim}
          />
          {dailyStreak && dailyStreak.currentStreak > 0 && (
            <p className="m-0 mt-3 text-[13px] font-semibold text-[var(--reward-text)]">
              {t("today.streak", {
                count: dailyStreak.currentStreak,
                defaultValue: `${dailyStreak.currentStreak}-day streak`,
              })}
            </p>
          )}
          <RewardLimitControl status={rewardLimit} />
          <div className="mt-auto pt-3">
            <StoreCrossLink />
          </div>
        </section>
      </div>

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
      <ActiveBonusesControl bonuses={activeBonuses} />
      <PointPacksControl
        packs={pointPacks}
        loadingPackId={pointPackLoadingId}
        message={pointPackMessage}
        onClaim={handlePointPackClaim}
      />
      <BadgesControl badges={badges} />

      <div
        className={`mt-8 grid gap-4 max-[900px]:grid-cols-1 ${
          started ? "grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]" : "grid-cols-1"
        }`}
      >
        {started && standing && <BenefitsList tiers={visibleTiers} current={standing.rank} />}
        <LedgerCard ledger={ledger} name={user.username || user.id} />
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

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8" aria-labelledby={id}>
      <h2 id={id} className="m-0 text-[17px] font-semibold text-[var(--t1)]">
        {title}
      </h2>
      {description && <p className="m-0 mt-1 text-[13px] text-[var(--t3)]">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Progress({ value, max, tone = "ink" }: { value: number; max: number; tone?: "ink" | "reward" }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]" aria-hidden="true">
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${
          tone === "reward" ? "bg-[var(--reward)]" : "bg-[var(--ink)]"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function TierCard({
  standing,
  tiers,
  progressPct,
}: {
  standing: LoyaltyStanding;
  tiers: LoyaltyTier[];
  progressPct: number;
}) {
  const { t } = useTranslation("rewards");
  return (
    <section className={`${CARD_CLASS} p-5`} aria-labelledby="rw-tier-title">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`inline-flex items-center rounded-[var(--r-pill)] px-3 py-1 text-[12px] font-semibold text-[var(--t1)] ${tierColorClass(
            standing.rank,
            "pill",
          )}`}
        >
          {standing.rankName}
        </span>
        <span className="text-[12px] text-[var(--t3)]">{t("TIER_BADGE_PREFIX", "Current Tier")}</span>
      </div>
      <h2 id="rw-tier-title" className="m-0 mt-4 text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--t1)] max-[640px]:text-[28px]">
        {formatPointsAmount(standing.pointsBalance)}
        <span className="ml-1.5 text-[14px] font-medium tracking-normal text-[var(--t3)]">
          {t("pointsShort", "pts")}
        </span>
      </h2>
      {standing.nextRankName ? (
        <div className="mt-4">
          <div className="mb-2 flex justify-between text-[13px] text-[var(--t2)]">
            <span>
              {t("progress.pointsTo", "{{points}} pts to", {
                points: formatPointsAmount(standing.xpToNextRank),
              })}{" "}
              <strong className="font-semibold text-[var(--t1)]">{standing.nextRankName}</strong>
            </span>
            <span className="font-semibold tabular-nums text-[var(--t1)]">{Math.round(progressPct)}%</span>
          </div>
          <Progress value={progressPct} max={100} tone="reward" />
          <span className="sr-only">{t("progress.label", "Tier progress")}</span>
        </div>
      ) : (
        <p className="m-0 mt-4 text-[14px] text-[var(--t2)]">
          {t("progress.topTier", "Top tier reached — thanks for trading with us.")}
        </p>
      )}
      <TierLadder tiers={tiers} current={standing.rank} />
    </section>
  );
}

function StartCard({ tiers }: { tiers: LoyaltyTier[] }) {
  const { t } = useTranslation("rewards");
  return (
    <section className={`${CARD_CLASS} flex flex-col p-5`} aria-labelledby="rw-start-title">
      <h2 id="rw-start-title" className="m-0 text-[20px] font-semibold tracking-[-0.015em] text-[var(--t1)]">
        {t("prefirst.title", "No activity yet")}
      </h2>
      <p className="m-0 mt-1.5 max-w-[440px] text-[14px] leading-[1.55] text-[var(--t2)]">
        {t(
          "prefirst.body",
          "Settle your first trade to start earning points and climb the tier ladder.",
        )}
      </p>
      <div className="mt-4">
        <Button variant="primary" size="md" render={<Link href="/predict" />}>
          {t("prefirst.browse", "Browse markets")} →
        </Button>
      </div>
      <TierLadder tiers={tiers} current={0} />
    </section>
  );
}

// Cross-link into the purchasable Point Store (a separate surface from the
// free claimable packs below — those stay operator-granted).
function StoreCrossLink() {
  const { t } = useTranslation("store");
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13px] text-[var(--t3)]">
      {t("entry.needMore", "Need more points?")}
      <Link href="/store" className={CROSS_LINK_CLASS} data-testid="add-points-rewards">
        {t("entry.visitStore", "Visit the Point Store")} →
      </Link>
    </p>
  );
}

function RewardLimitControl({ status }: { status: RewardLimitStatus | null }) {
  const { t } = useTranslation("rewards");
  if (!status?.enabled) return null;
  return (
    <div className="mt-4 border-t border-[var(--border-1)] pt-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[13px] font-semibold text-[var(--t2)]">
          {t("rewardLimit.title", "Daily reward limit")}
        </h3>
        <span className="text-[12px] text-[var(--t3)]">
          {t("rewardLimit.reset", "Resets {{date}}", {
            date: new Date(status.nextResetAt).toLocaleString(),
          })}
        </span>
      </div>
      <Progress value={status.remainingPoints} max={status.limitPoints} />
      <p className="m-0 mt-2 text-[13px] text-[var(--t2)]">
        {t("rewardLimit.body", "{{remaining}} of {{limit}} reward pts remain for today.", {
          remaining: formatPointsAmount(status.remainingPoints),
          limit: formatPointsAmount(status.limitPoints),
        })}
      </p>
    </div>
  );
}

function DailyClaimControl({ loading, claimed, message, onClaim }: DailyClaimControlProps) {
  const { t } = useTranslation("rewards");
  return (
    <div className="mt-3">
      <p className="m-0 mb-3 text-[13px] leading-[1.55] text-[var(--t3)]">
        {t(
          "dailyClaim.body",
          "Claim non-redeemable gameplay points once per day for predictions only.",
        )}
      </p>
      <Button variant="primary" size="lg" className="w-full" disabled={loading || claimed} onClick={onClaim}>
        {loading
          ? t("dailyClaim.claiming", "Claiming")
          : claimed
            ? t("dailyClaim.claimed", "Claimed today")
            : t("dailyClaim.cta", "Claim today")}
      </Button>
      {message && (
        <p className={STATUS_CLASS} role="status">
          {message}
        </p>
      )}
    </div>
  );
}

function ClaimButton({
  label,
  claimable,
  busy,
  onClick,
}: {
  label: string;
  claimable: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={claimable ? "primary" : "secondary"}
      size="sm"
      className="w-full"
      disabled={!claimable || busy}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function PointPacksControl({ packs, loadingPackId, message, onClaim }: PointPacksControlProps) {
  const { t } = useTranslation("rewards");
  if (packs.length === 0) return null;
  return (
    <Section
      id="rw-packs"
      title={t("pointPacks.title", "Point packs")}
      description={t(
        "pointPacks.body",
        "Claim configured one-time gameplay point packs for predictions only.",
      )}
    >
      <div className={GRID_CLASS}>
        {packs.map((pack) => (
          <article key={pack.id} className={ITEM_CLASS}>
            <div className="flex items-start justify-between gap-3">
              <p className={ITEM_NAME_CLASS}>{pack.name}</p>
              <span className={REWARD_CHIP_CLASS}>+{formatPointsAmount(pack.amountPoints)}</span>
            </div>
            <p className={ITEM_DESC_CLASS}>{pack.description}</p>
            <div className="mt-auto pt-4">
              <ClaimButton
                claimable={pack.enabled && !pack.claimed}
                busy={loadingPackId !== null}
                onClick={() => onClaim(pack.id)}
                label={
                  loadingPackId === pack.id
                    ? t("pointPacks.claiming", "Claiming")
                    : pack.claimed
                      ? t("pointPacks.claimed", "Claimed")
                      : pack.enabled
                        ? t("pointPacks.cta", "Claim")
                        : t("pointPacks.unavailable", "Unavailable")
                }
              />
            </div>
          </article>
        ))}
      </div>
      <p className="m-0 mt-3 text-[12px] leading-normal text-[var(--t3)]">
        {t(
          "pointPacks.disclosure",
          "Points are non-redeemable gameplay points with no cashout, withdrawal, crypto, fiat, or prize path.",
        )}
      </p>
      {message && (
        <p className={STATUS_CLASS} role="status">
          {message}
        </p>
      )}
    </Section>
  );
}

function MissionsControl({ missions, loadingMissionId, message, onClaim }: MissionsControlProps) {
  const { t } = useTranslation("rewards");
  if (missions.length === 0) return null;
  return (
    <Section
      id="rw-missions"
      title={t("missions.title", "Missions")}
      description={t(
        "missions.body",
        "Complete gameplay missions to earn non-redeemable reward points.",
      )}
    >
      <div className={GRID_CLASS}>
        {missions.map((mission) => (
          <article key={mission.id} className={ITEM_CLASS}>
            <div className="flex items-start justify-between gap-3">
              <p className={ITEM_NAME_CLASS}>{mission.name}</p>
              <span className={REWARD_CHIP_CLASS}>+{formatPointsAmount(mission.rewardPoints)}</span>
            </div>
            <p className={ITEM_DESC_CLASS}>{mission.description}</p>
            <div className="mt-auto pt-4">
              <div className="mb-1.5 flex justify-between text-[12px] tabular-nums text-[var(--t3)]">
                <span>
                  {t("missions.progress", "{{progress}} / {{target}} complete", {
                    progress: mission.progress,
                    target: mission.target,
                  })}
                </span>
              </div>
              <Progress value={mission.progress} max={mission.target} />
              <div className="mt-3">
                <ClaimButton
                  claimable={mission.enabled && mission.completed && !mission.claimed}
                  busy={loadingMissionId !== null}
                  onClick={() => onClaim(mission.id)}
                  label={
                    loadingMissionId === mission.id
                      ? t("missions.claiming", "Claiming")
                      : mission.claimed
                        ? t("missions.claimed", "Claimed")
                        : mission.completed
                          ? t("missions.cta", "Claim")
                          : t("missions.incomplete", "Incomplete")
                  }
                />
              </div>
            </div>
          </article>
        ))}
      </div>
      {message && (
        <p className={STATUS_CLASS} role="status">
          {message}
        </p>
      )}
    </Section>
  );
}

function StreaksControl({ streaks, loadingStreakId, message, onClaim }: StreaksControlProps) {
  const { t } = useTranslation("rewards");
  if (streaks.length === 0) return null;
  return (
    <Section
      id="rw-streaks"
      title={t("streaks.title", "Streaks")}
      description={t(
        "streaks.body",
        "Keep daily gameplay-point claims going to earn non-redeemable streak rewards.",
      )}
    >
      <div className={GRID_CLASS}>
        {streaks.map((streak) => (
          <article key={streak.id} className={ITEM_CLASS}>
            <div className="flex items-start justify-between gap-3">
              <p className={ITEM_NAME_CLASS}>{streak.name}</p>
              <span className={REWARD_CHIP_CLASS}>+{formatPointsAmount(streak.rewardPoints)}</span>
            </div>
            <p className={ITEM_DESC_CLASS}>{streak.description}</p>
            <div className="mt-auto pt-4">
              {/* Streaks are the one progress figure licensed to read in pink. */}
              <div className="mb-1.5 text-[12px] font-semibold tabular-nums text-[var(--reward-text)]">
                {t("streaks.progress", "{{current}} / {{target}} days", {
                  current: streak.currentStreak,
                  target: streak.target,
                })}
              </div>
              <Progress value={streak.currentStreak} max={streak.target} tone="reward" />
              <div className="mt-3">
                <ClaimButton
                  claimable={streak.enabled && streak.completed && !streak.claimed}
                  busy={loadingStreakId !== null}
                  onClick={() => onClaim(streak.id)}
                  label={
                    loadingStreakId === streak.id
                      ? t("streaks.claiming", "Claiming")
                      : streak.claimed
                        ? t("streaks.claimed", "Claimed")
                        : streak.completed
                          ? t("streaks.cta", "Claim")
                          : t("streaks.incomplete", "Incomplete")
                  }
                />
              </div>
            </div>
          </article>
        ))}
      </div>
      {message && (
        <p className={STATUS_CLASS} role="status">
          {message}
        </p>
      )}
    </Section>
  );
}

function BadgesControl({ badges }: { badges: Badge[] }) {
  const { t } = useTranslation("rewards");
  if (badges.length === 0) return null;
  return (
    <Section
      id="rw-badges"
      title={t("badges.title", "Badges")}
      description={t(
        "badges.body",
        "Unlock cosmetic badges from gameplay milestones. Badges are non-redeemable status markers.",
      )}
    >
      <div className="grid grid-cols-4 gap-3 max-[1024px]:grid-cols-3 max-[640px]:grid-cols-2">
        {badges.map((badge) => (
          <article
            key={badge.id}
            className={`${CARD_CLASS} flex flex-col items-center px-3 py-4 text-center ${badge.earned ? "" : "opacity-60"}`}
          >
            <span
              className={`grid h-11 w-11 place-items-center rounded-full ${
                badge.earned ? "bg-[var(--ink)] text-[var(--on-ink)]" : "bg-[var(--surface-2)] text-[var(--t3)]"
              }`}
              aria-hidden="true"
            >
              {badge.earned ? <Award size={20} /> : <Lock size={18} />}
            </span>
            <p className="m-0 mt-2.5 text-[13px] font-semibold text-[var(--t1)]">{badge.name}</p>
            <p className="m-0 mt-0.5 text-[12px] leading-[1.4] text-[var(--t3)]">{badge.description}</p>
            <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--t3)]">
              {badge.earned ? t("badges.earned", "Earned") : t("badges.locked", "Locked")}
            </span>
          </article>
        ))}
      </div>
    </Section>
  );
}

// The ladder as a stepper: reached tiers filled in their colour, the
// current one ringed, later ones hollow.
function TierLadder({ tiers, current }: { tiers: LoyaltyTier[]; current: number }) {
  const { t } = useTranslation("rewards");
  if (tiers.length === 0) return null;
  return (
    <ol
      className="m-0 mt-5 flex list-none gap-2 overflow-x-auto border-t border-[var(--border-1)] p-0 pt-4"
      aria-label={t("ladder.aria", "Tier ladder")}
    >
      {tiers.map((tier) => {
        const reached = tier.rank <= current;
        const isCurrent = tier.rank === current;
        return (
          <li
            key={tier.rank}
            className="flex min-w-[76px] flex-1 flex-col items-center text-center"
            aria-current={isCurrent ? "step" : undefined}
          >
            <span
              className={`h-3 w-3 rounded-full ${
                reached ? tierColorClass(tier.rank, "dot") : "border-2 border-[var(--border-2)] bg-[var(--surface-1)]"
              } ${isCurrent ? "ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--surface-1)]" : ""}`}
              aria-hidden="true"
            />
            <span
              className={`mt-2 text-[12px] font-semibold ${reached ? "text-[var(--t1)]" : "text-[var(--t3)]"}`}
            >
              {tier.rankName}
            </span>
            <span className="text-[11px] tabular-nums text-[var(--t3)]">{formatPointsAmount(tier.minXpPoints)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function BenefitsList({ tiers, current }: { tiers: LoyaltyTier[]; current: number }) {
  const { t } = useTranslation("rewards");
  // Benefits are cumulative — every benefit from tier 1 up through the
  // player's current tier. Matches plan §2.Tiers.
  const rows: Array<{ key: string; tier: number; name: string; copy: string }> = [];
  for (const tier of tiers) {
    if (tier.rank > current) continue;
    const benefits = tier.benefits ?? [];
    for (let i = 0; i < benefits.length; i++) {
      rows.push({ key: `${tier.rank}-${i}`, tier: tier.rank, name: tier.rankName, copy: benefits[i] });
    }
  }
  return (
    <section className={`${CARD_CLASS} p-5`} aria-labelledby="rw-benefits-title">
      <h2 id="rw-benefits-title" className="m-0 text-[16px] font-semibold text-[var(--t1)]">
        {t("benefits.unlocked", "Unlocked")}
      </h2>
      {rows.length === 0 ? (
        <p className="m-0 mt-2 text-[13px] text-[var(--t3)]">
          {t("BENEFITS_EMPTY", "No benefits configured for this tier yet.")}
        </p>
      ) : (
        <ul className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0">
          {rows.map((row) => (
            <li key={row.key} className="grid grid-cols-[10px_1fr_auto] items-center gap-2.5 text-[14px] text-[var(--t1)]">
              <span className={`size-2.5 rounded-full ${tierColorClass(row.tier, "dot")}`} aria-hidden="true" />
              <span>{row.copy}</span>
              <span className="text-[12px] text-[var(--t3)]">{row.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const LEDGER_ICON: Record<string, typeof Sparkles> = {
  won: CheckCircle2,
  lost: XCircle,
  accrual: TrendingUp,
  promotion: Sparkles,
  adjustment: SlidersHorizontal,
};

function LedgerCard({ ledger, name }: { ledger: LoyaltyLedgerEntry[]; name: string }) {
  const { t } = useTranslation("rewards");
  return (
    <section className={`${CARD_CLASS} overflow-hidden`} aria-labelledby="rw-ledger-title">
      <header className="flex items-baseline justify-between gap-3 border-b border-[var(--border-1)] px-5 py-4">
        <h2 id="rw-ledger-title" className="m-0 text-[16px] font-semibold text-[var(--t1)]">
          {t("ledger.title", "Recent activity")}
        </h2>
        <span className="text-[12px] text-[var(--t3)]">
          {t("ledger.entries", "{{count}} entries", { count: ledger.length })}
        </span>
      </header>
      {ledger.length === 0 ? (
        <p className="m-0 px-5 py-10 text-center text-[13px] text-[var(--t3)]">
          {t("ledger.empty", "No activity yet — settle a market to start earning.")}
        </p>
      ) : (
        <ul
          className="m-0 list-none divide-y divide-[var(--border-1)] p-0"
          aria-label={t("ledger.caption", "Recent loyalty ledger entries for {{name}}", { name })}
        >
          {ledger.map((entry) => {
            const outcome = entry.reason?.includes("(won)") ? "won" : entry.reason?.includes("(lost)") ? "lost" : entry.eventType;
            const Icon = LEDGER_ICON[outcome] ?? Sparkles;
            return (
              <li key={entry.id} className="flex items-center gap-3 px-5 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--t2)]" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-[var(--t1)]">{labelForEntry(entry, t)}</span>
                  <span className="block truncate text-[12px] text-[var(--t3)]">
                    {formatDate(entry.createdAt)}
                    {shouldShowReason(entry) ? ` · ${entry.reason}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {/* Ledger deltas are point-balance changes, not market
                   * results — weight carries the signal, not colour. */}
                  <span
                    className={`block text-[14px] tabular-nums ${
                      entry.deltaPoints >= 0 ? "font-semibold text-[var(--t1)]" : "text-[var(--t2)]"
                    }`}
                  >
                    {entry.deltaPoints >= 0 ? "+" : ""}
                    {formatPointsAmount(entry.deltaPoints)}
                  </span>
                  <span className="block text-[12px] tabular-nums text-[var(--t3)]">
                    {formatPointsAmount(entry.balanceAfter)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
      <div className={`${CARD_CLASS} w-full max-w-[440px] p-7 text-center`}>
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
