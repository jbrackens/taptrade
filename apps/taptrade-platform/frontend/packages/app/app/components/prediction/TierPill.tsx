"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  getLoyaltyStanding,
  resetLoyaltyCaches,
  type LoyaltyStanding,
} from "../../lib/api/loyalty-client";
import { subscribePredictWs } from "../../lib/websocket/predict-ws";
import { useAuth } from "../../hooks/useAuth";
import { logger } from "../../lib/logger";

// TierPill — ambient loyalty surface in TopBar.
//
// Plan §1 + §6 + §7:
// - Hidden when tier === 0 (user hasn't earned any points yet).
// - 36px height with tier-N color swatch on border + pill background.
// - Links to /rewards for the detail view.
// - 400ms pink bloom ring (a real tier-promotion event, not a decorative
//   loop — Kilig pink is licensed for a reward moment like this) the first
//   render after a tier promotion. Respects prefers-reduced-motion: reduce.
// - aria-label: "Tier: <name>, <n> points. <m> points to <next>"
// - Below 480px the label truncates to "<Name> · <k-compact>".

interface TierPillProps {
  // Poll interval is low — 60s is fine; standing tier hardly churns.
  refreshMs?: number;
}

// Step 8 (390 header fix): min-w-0/overflow-hidden so a flex-crushed pill
// CLIPS instead of bleeding its nowrap content over the balance chip;
// below 420px the pill is rank-only (separator + points hidden) with the
// rank truncating — the compressed header shows "Newcomer", never
// "New…· 19k" smeared across its neighbours.
const TIER_PILL_BASE_CLASS =
  "inline-flex h-9 min-w-11 items-center overflow-hidden whitespace-nowrap rounded-full border border-[color-mix(in_srgb,var(--tp-color)_30%,transparent)] bg-[color-mix(in_srgb,var(--tp-color)_14%,transparent)] px-[14px] text-xs font-bold tracking-[0.02em] text-[var(--t1)] no-underline [transition:background_120ms_ease,border-color_120ms_ease,box-shadow_400ms_ease] hover:border-[color-mix(in_srgb,var(--tp-color)_48%,transparent)] hover:bg-[color-mix(in_srgb,var(--tp-color)_22%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] max-[480px]:min-w-0 max-[480px]:px-2.5 max-[359px]:hidden";
const TIER_PILL_BLOOM_CLASS =
  "shadow-[0_0_0_4px_var(--live-soft)] motion-reduce:shadow-none motion-reduce:transition-none";
const TIER_SEPARATOR_CLASS = "mx-1.5 text-[var(--t3)] font-medium";
const TIER_POINTS_CLASS =
  "font-mono font-semibold [font-variant-numeric:tabular-nums]";

export function TierPill({ refreshMs = 60_000 }: TierPillProps) {
  const { user } = useAuth();
  const [standing, setStanding] = useState<LoyaltyStanding | null>(null);
  const [bloom, setBloom] = useState(false);
  const previousTierRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStanding() {
      try {
        const result = await getLoyaltyStanding();
        if (cancelled) return;
        // Detect tier-up relative to the last observed state. Ignore the
        // first render (prev === null) — we only bloom on an *increase*.
        const prevTier = previousTierRef.current;
        if (prevTier !== null && result.rank > prevTier) {
          setBloom(true);
          window.setTimeout(() => setBloom(false), 400);
        }
        previousTierRef.current = result.rank;
        setStanding(result);
      } catch (err) {
        // Silent failure per plan §3 — loyalty is ambient, never blocks the UI.
        if (!cancelled) logger.warn("TierPill", "standing fetch failed", err);
      }
    }

    void fetchStanding();
    const interval = window.setInterval(fetchStanding, refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refreshMs]);

  // WebSocket tier-up: plan §8 says post-commit we get a tier_promoted event.
  // Invalidate the standing cache + re-fetch so the pill updates instantly
  // instead of waiting for the next 60s poll. The 60s poll is the fallback
  // when the WS is disconnected (plan's explicit design).
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;
    const unsubscribe = subscribePredictWs(`loyalty:${userId}`, (eventId) => {
      if (eventId !== "tier_promoted") return;
      resetLoyaltyCaches();
      void (async () => {
        try {
          const result = await getLoyaltyStanding();
          const prevTier = previousTierRef.current;
          if (prevTier !== null && result.rank > prevTier) {
            setBloom(true);
            window.setTimeout(() => setBloom(false), 400);
          }
          previousTierRef.current = result.rank;
          setStanding(result);
        } catch (err) {
          logger.warn("TierPill", "WS-triggered refetch failed", err);
        }
      })();
    });
    return unsubscribe;
  }, [user?.id]);

  if (!standing || standing.rank < 1) return null;

  const points = Math.round(standing.pointsBalance);
  const ariaLabel = standing.nextRankName
    ? `Rank: ${standing.rankName}, ${points} points. ${Math.round(standing.xpToNextRank)} points to ${standing.nextRankName}.`
    : `Rank: ${standing.rankName}, ${points} points. Top rank.`;

  return (
    <Link
      href="/rewards"
      aria-label={ariaLabel}
      className={`${TIER_PILL_BASE_CLASS} ${bloom ? TIER_PILL_BLOOM_CLASS : ""}`}
      style={{ ["--tp-color" as string]: `var(--tier-${standing.rank})` }}
    >
      <span className="min-w-0 truncate">{standing.rankName}</span>
      <span
        className={`${TIER_SEPARATOR_CLASS} max-[419px]:hidden`}
        aria-hidden="true"
      >
        ·
      </span>
      <span className={`${TIER_POINTS_CLASS} max-[480px]:hidden`}>
        {formatPoints(points)} pts
      </span>
      <span
        className={`${TIER_POINTS_CLASS} min-[481px]:hidden max-[419px]:hidden`}
      >
        {formatCompact(points)}
      </span>
    </Link>
  );
}

function formatPoints(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
