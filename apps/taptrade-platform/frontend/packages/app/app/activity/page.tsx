"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "../components/ui";
import { useTranslation } from "react-i18next";
import {
  getGlobalActivity,
  type SocialActivityItem,
} from "../lib/api/market-social-client";
import { ApiError } from "../lib/api/client";
import { logger } from "../lib/logger";

const WRAP_CLASS = "mx-auto max-w-[920px] px-4 pb-16 text-[var(--t1)]";
const HEADER_CLASS = "mb-6 flex items-end justify-between gap-4";
const TITLE_CLASS = "type-poster m-0 text-[28px] max-[640px]:text-[24px] text-[var(--t1)]";
const LINK_CLASS =
  "text-[13px] font-semibold text-[var(--t2)] underline-offset-4 hover:text-[var(--t1)] hover:underline";
// Card shell (padding="lg") replaced the p-6 section recipe.
const LIST_CLASS = "flex flex-col gap-3";
const ITEM_CLASS =
  "border-t border-[var(--border-1)] pt-3 first:border-t-0 first:pt-0";
// Dates are comparable numerals — mono, per DESIGN.md §4.
const META_CLASS = "mb-1 font-mono text-[11px] text-[var(--t3)]";
const BODY_CLASS = "m-0 text-sm leading-[1.55] text-[var(--t1)]";
const STATE_CLASS = "py-12 text-center text-sm text-[var(--t3)]";

export default function ActivityPage() {
  const { t } = useTranslation("prediction");
  const [items, setItems] = useState<SocialActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // QA fix ISSUE-003 (2026-07-26): signed-out visitors used to get the
  // generic "Activity could not load." error (plus a console 401) —
  // reading as an outage, not an auth gate. A 401 now renders a sign-in
  // prompt like the rest of the gated surfaces.
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const result = await getGlobalActivity(50);
        if (!cancelled) setItems(result);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          if (!cancelled) setAuthRequired(true);
          return;
        }
        logger.warn("ActivityPage", "activity load failed", err);
        if (!cancelled)
          setError(
            t("SOCIAL_ACTIVITY_LOAD_FAILED", "Activity could not load."),
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <main className={WRAP_CLASS}>
      <header className={HEADER_CLASS}>
        <h1 className={TITLE_CLASS}>{t("SOCIAL_ACTIVITY", "Activity")}</h1>
        <Link href="/predict" className={LINK_CLASS}>
          {t("BACK_TO_MARKETS", "Back to markets")}
        </Link>
      </header>
      <Card as="section" padding="lg">
        {loading ? (
          <div className={STATE_CLASS}>
            {t("SOCIAL_LOADING_ACTIVITY", "Loading activity.")}
          </div>
        ) : authRequired ? (
          <div className={STATE_CLASS}>
            {t("SOCIAL_ACTIVITY_SIGN_IN", "Sign in to see market activity.")}{" "}
            <Link
              href={`/auth/login?returnUrl=${encodeURIComponent("/activity")}`}
              className={LINK_CLASS}
            >
              {t("LOG_IN", "Log in")}
            </Link>
          </div>
        ) : error ? (
          <div className={STATE_CLASS}>{error}</div>
        ) : items.length === 0 ? (
          <div className={STATE_CLASS}>
            {t("SOCIAL_NO_ACTIVITY", "No activity yet.")}
          </div>
        ) : (
          <div className={LIST_CLASS}>
            {items.map((item) => (
              <article key={item.id} className={ITEM_CLASS}>
                <div className={META_CLASS}>
                  <Link
                    href={`/users/${encodeURIComponent(item.userId)}`}
                    className={LINK_CLASS}
                  >
                    {item.userId}
                  </Link>{" "}
                  · {formatActivityMeta(item)}
                </div>
                <p className={BODY_CLASS}>{activityLabel(item)}</p>
              </article>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}

function activityLabel(item: SocialActivityItem): string {
  if (item.type === "follow") return `followed ${item.targetId}`;
  if (item.type === "trade") return item.body || "traded";
  if (item.type === "settlement") return item.body || "settled a market";
  if (item.type === "reward") return item.body || "earned reward points";
  if (item.type === "leaderboard")
    return item.body || "appeared on a leaderboard";
  return item.body || "commented";
}

function formatActivityMeta(item: SocialActivityItem): string {
  const d = new Date(item.createdAt);
  const when = Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
  return item.marketId
    ? `${item.type} · ${item.marketId} · ${when}`
    : `${item.type} · ${when}`;
}
