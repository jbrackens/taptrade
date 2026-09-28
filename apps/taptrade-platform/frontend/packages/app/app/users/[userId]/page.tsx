"use client";

/**
 * PublicUserPage — another player's public profile (linked from market
 * discussions). Same identity card as the player's own Account page, and
 * an activity list whose rows carry the market's image tile and title
 * instead of raw ids.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { CheckCircleIcon as CheckCircle2 } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { GiftIcon as Gift } from "@phosphor-icons/react/dist/csr/Gift";
import { ChatCircleIcon as MessageCircle } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { TrophyIcon as Trophy } from "@phosphor-icons/react/dist/csr/Trophy";
import { UserPlusIcon as UserPlus } from "@phosphor-icons/react/dist/csr/UserPlus";
import { IconTile } from "../../components/account/IconTile";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import { useAuth } from "../../hooks/useAuth";
import { Button } from "../../components/ui";
import { ProfileAvatar } from "../../components/account/ProfileAvatar";
import { MarketThumb } from "../../components/prediction/MarketThumb";
import { localizedMarket } from "../../components/prediction/market-content";
import {
  followSocialUser,
  getPublicUserProfile,
  getUserActivity,
  type PublicUserProfile,
  type SocialActivityItem,
} from "../../lib/api/market-social-client";
import { logger } from "../../lib/logger";

const api = createPredictionClient();

const CARD_CLASS =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] shadow-[var(--shadow-card)]";
const STATE_CLASS = "py-12 text-center text-sm text-[var(--t3)]";

const ACTIVITY_ICON: Record<SocialActivityItem["type"], typeof MessageCircle> = {
  comment: MessageCircle,
  follow: UserPlus,
  trade: CheckCircle2,
  settlement: CheckCircle2,
  reward: Gift,
  leaderboard: Trophy,
};

export default function PublicUserPage() {
  const { t } = useTranslation("prediction");
  const params = useParams() ?? {};
  const userId = decodeURIComponent((params.userId as string | undefined) ?? "");
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [activity, setActivity] = useState<SocialActivityItem[]>([]);
  const [markets, setMarkets] = useState<Map<string, PredictionMarket>>(new Map());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!userId) return;
      try {
        setLoading(true);
        const [profileResult, activityResult] = await Promise.all([
          getPublicUserProfile(userId),
          getUserActivity(userId, 50),
        ]);
        if (cancelled) return;
        setProfile(profileResult);
        setActivity(activityResult);
        const ids = [...new Set(activityResult.map((a) => a.marketId).filter((id): id is string => Boolean(id)))].slice(0, 50);
        if (ids.length > 0) {
          const res = await api
            .getMarkets({ ids, pageSize: ids.length, sort: "newest" })
            .catch((err: unknown) => {
              logger.warn("PublicUserPage", "market hydrate failed", err);
              return null;
            });
          if (!cancelled && res) setMarkets(new Map(res.data.map((m) => [m.id, m])));
        }
      } catch (err) {
        logger.warn("PublicUserPage", "profile load failed", err);
        if (!cancelled) setMessage(t("SOCIAL_PROFILE_LOAD_FAILED", "Profile could not load."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, t]);

  async function follow() {
    if (!userId || !isAuthenticated || authLoading) return;
    try {
      setProfile(await followSocialUser(userId));
      setMessage(null);
    } catch (err) {
      logger.warn("PublicUserPage", "follow failed", err);
      setMessage(t("SOCIAL_FOLLOW_FAILED", "Follow could not be recorded."));
    }
  }

  if (loading) {
    return <div className={STATE_CLASS}>{t("SOCIAL_LOADING", "Loading profile.")}</div>;
  }
  if (!profile) {
    return <div className={STATE_CLASS}>{message ?? t("SOCIAL_PROFILE_EMPTY", "Profile unavailable.")}</div>;
  }

  const name = profile.displayName || profile.userId;
  const stats: [number, string][] = [
    [profile.commentCount, t("SOCIAL_COMMENTS_LABEL", "comments")],
    [profile.followerCount, t("SOCIAL_FOLLOWERS_LABEL", "followers")],
    [profile.followingCount, t("SOCIAL_FOLLOWING_LABEL", "following")],
  ];

  return (
    <main className="mx-auto max-w-[880px] px-6 pb-16 pt-6 text-[var(--t1)] max-[640px]:px-4">
      <section className={`${CARD_CLASS} p-5`} aria-labelledby="public-profile-name">
        <div className="flex items-start gap-4">
          <ProfileAvatar name={name} />
          <div className="min-w-0 flex-1 pt-1">
            <h1 id="public-profile-name" className="m-0 truncate text-[22px] font-semibold leading-tight tracking-[-0.02em]">
              {name}
            </h1>
            {profile.lastActiveAt && (
              <p className="m-0 mt-1 text-[13px] text-[var(--t3)]">
                {t("SOCIAL_LAST_ACTIVE", {
                  when: relativeTime(profile.lastActiveAt, t),
                  defaultValue: `Active ${relativeTime(profile.lastActiveAt, t)}`,
                })}
              </p>
            )}
          </div>
          <Button
            variant={profile.viewerFollowing ? "secondary" : "primary"}
            size="sm"
            disabled={!isAuthenticated || authLoading || profile.viewerFollowing}
            onClick={follow}
          >
            {profile.viewerFollowing ? t("SOCIAL_FOLLOWING_CTA", "Following") : t("SOCIAL_FOLLOW_CTA", "Follow")}
          </Button>
        </div>
        <dl className="m-0 mt-5 grid grid-cols-3 divide-x divide-[var(--border-1)] border-t border-[var(--border-1)] pt-4 text-center">
          {stats.map(([value, label]) => (
            <div key={label} className="flex flex-col-reverse">
              <dt className="mt-0.5 text-[12px] text-[var(--t3)]">{label}</dt>
              <dd className="m-0 text-[17px] font-semibold tabular-nums">{value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        {message && (
          <p className="m-0 mt-3 text-[13px] text-[var(--danger)]" role="alert">
            {message}
          </p>
        )}
      </section>

      <section className="mt-8" aria-labelledby="public-activity-heading">
        <h2 id="public-activity-heading" className="m-0 mb-3 text-[17px] font-semibold">
          {t("SOCIAL_ACTIVITY", "Activity")}
        </h2>
        {activity.length === 0 ? (
          <div className="rounded-[var(--r-rh-lg)] border border-dashed border-[var(--border-2)] px-6 py-10 text-center text-[14px] text-[var(--t3)]">
            {t("SOCIAL_NO_ACTIVITY", "No activity yet.")}
          </div>
        ) : (
          <ul className={`${CARD_CLASS} m-0 list-none divide-y divide-[var(--border-1)] overflow-hidden p-0`}>
            {activity.map((item) => (
              <ActivityRow key={item.id} item={item} market={item.marketId ? markets.get(item.marketId) : undefined} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ActivityRow({ item, market }: { item: SocialActivityItem; market?: PredictionMarket }) {
  const { t } = useTranslation("prediction");
  const { t: tm } = useTranslation("market-content");
  const display = market ? localizedMarket(tm, market) : undefined;
  const Icon = ACTIVITY_ICON[item.type] ?? MessageCircle;
  const photo = display ? display.imagePath || display.imageUrl || display.image_url : undefined;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      {display ? (
        <MarketThumb categorySlug={display.categorySlug} imageUrl={photo} size={40} />
      ) : (
        <IconTile icon={Icon} />
      )}
      <div className="min-w-0 flex-1">
        {display && (
          <Link
            href={`/market/${display.ticker}`}
            className="line-clamp-2 text-[14px] font-semibold leading-[1.3] text-[var(--t1)] no-underline hover:underline"
          >
            {display.title}
          </Link>
        )}
        <p className={`m-0 text-[13px] leading-[1.5] ${display ? "mt-0.5 text-[var(--t2)]" : "text-[var(--t1)]"}`}>
          {activityLabel(item, t)}
        </p>
      </div>
      <span className="shrink-0 pt-0.5 text-[12px] tabular-nums text-[var(--t3)]">{relativeTime(item.createdAt, t)}</span>
    </li>
  );
}

type Translate = TFunction<"prediction">;

// Comments and trades carry their own text; the other kinds get a plain
// sentence rather than the raw ids they reference.
function activityLabel(item: SocialActivityItem, t: Translate): string {
  if (item.body) return item.body;
  if (item.type === "follow") return t("SOCIAL_ACTIVITY_FOLLOW", "Followed a player");
  if (item.type === "trade") return t("SOCIAL_ACTIVITY_TRADE", "Made a call");
  if (item.type === "settlement") return t("SOCIAL_ACTIVITY_SETTLEMENT", "A market they held settled");
  if (item.type === "reward") return t("SOCIAL_ACTIVITY_REWARD", "Earned reward points");
  if (item.type === "leaderboard") return t("SOCIAL_ACTIVITY_LEADERBOARD", "Placed on a leaderboard");
  return t("SOCIAL_ACTIVITY_COMMENT", "Commented");
}

function relativeTime(iso: string, t: Translate): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return t("ACTIVITY_JUST_NOW", "just now");
  if (minutes < 60) return t("ACTIVITY_MIN_AGO", { count: minutes, defaultValue: `${minutes}m ago` });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("ACTIVITY_HOUR_AGO", { count: hours, defaultValue: `${hours}h ago` });
  const days = Math.round(hours / 24);
  return t("ACTIVITY_DAY_AGO", { count: days, defaultValue: `${days}d ago` });
}
