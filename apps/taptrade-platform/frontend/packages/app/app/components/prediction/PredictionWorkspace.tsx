"use client";

/**
 * Predict discovery workspace.
 *
 * Figma source: TapTrade Design → 06 · Trending Moments →
 * 08 · Predict — Points-led / Desktop (213:870) and Mobile (221:1105).
 *
 * The pageable market grid is deliberately the primary surface. Reward and
 * moment context set the scene, without a featured-price carousel or a
 * persistent trade rail competing with public market discovery.
 */

import Image from "next/image";
import Link from "next/link";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type {
  Category,
  DiscoveryResponse,
} from "@taptrade-ui/api-client/src/prediction-types";
import { AllMarketsSection } from "./AllMarketsSection";
import { TerminalCategoryRail } from "./TerminalCategoryRail";

interface PredictionWorkspaceProps {
  discovery: DiscoveryResponse;
  categories: Category[];
  catalogCategories: Category[];
  activeCategorySlug?: string;
  activeCategoryId?: string;
}

function scrollToMarketGrid(): void {
  document
    .getElementById("trending-markets")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function FeaturedRewardArtwork() {
  return (
    <div
      className="relative min-h-[264px] overflow-hidden min-[900px]:min-h-full"
      data-testid="featured-iphone-reward-artwork"
    >
      <Image
        src="/brand/featured-iphone-reward-hero-v6.webp"
        alt="Titanium smartphone featured as a redeemable reward."
        fill
        priority
        quality={90}
        sizes="(max-width: 899px) calc(100vw - 40px), (max-width: 1199px) 42vw, 530px"
        className="object-cover object-right"
      />
    </div>
  );
}

function FeaturedRewardBadge() {
  const { t } = useTranslation("prediction");

  return (
    <aside
      aria-label={t("WORKSPACE_REWARD_BADGE_LABEL", "FEATURED REWARD")}
      data-testid="featured-reward-badge"
      className="w-[196px] rounded-xl border border-[var(--reward-hero-border)] bg-[color-mix(in_srgb,var(--reward-hero-bg)_84%,transparent)] px-4 py-3 shadow-[0_16px_32px_rgba(0,0,0,0.28)] backdrop-blur-md"
    >
      <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--reward-lime)]">
        {t("WORKSPACE_REWARD_BADGE_LABEL", "FEATURED REWARD")}
      </p>
      <p className="mb-0 mt-1 text-[16px] font-semibold leading-tight text-[var(--on-brand)]">
        {t("WORKSPACE_REWARD_BADGE_NAME", "iPhone 16 Pro")}
      </p>
      <p className="mb-0 mt-1 font-mono text-[13px] font-semibold tracking-[-0.025em] text-[var(--reward-lime)]">
        {t("WORKSPACE_REWARD_BADGE_POINTS", "120,000 points")}
      </p>
    </aside>
  );
}

function RewardHero() {
  const { t } = useTranslation("prediction");
  const scrollToGrid = useCallback(() => scrollToMarketGrid(), []);

  return (
    <section
      className="isolate grid overflow-hidden rounded-[16px] bg-[var(--reward-hero-bg)] text-[var(--on-brand)] min-[900px]:grid-cols-[minmax(0,1.07fr)_minmax(400px,0.93fr)]"
      aria-labelledby="reward-hero-heading"
    >
      <div className="relative z-10 flex min-h-[360px] flex-col justify-center px-6 py-8 min-[900px]:min-h-[420px] min-[900px]:px-10 min-[1200px]:px-12">
        <h1
          id="reward-hero-heading"
          className="type-display m-0 max-w-[500px] text-[42px] font-semibold leading-[0.95] tracking-[-0.04em] text-[var(--on-brand)] min-[900px]:text-[40px] min-[1200px]:text-[48px]"
        >
          <span className="block">{t("WORKSPACE_REWARD_PICK", "Pick.")}</span>
          <span className="block text-[var(--reward-lime)]">
            {t("WORKSPACE_REWARD_WIN", "Win.")}
          </span>
          <span className="block">
            {t("WORKSPACE_REWARD_REDEEM", "Redeem.")}
          </span>
        </h1>
        <p className="mb-0 mt-3 max-w-[470px] text-[15px] leading-[1.48] text-[var(--reward-hero-muted)] min-[900px]:mt-4">
          {t(
            "WORKSPACE_REWARD_COPY",
            "Make your predictions, win points, and redeem them for rewards you actually want.",
          )}
        </p>
        <div className="mt-4 flex flex-wrap gap-3 min-[900px]:mt-5">
          <button
            type="button"
            onClick={scrollToGrid}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border-0 bg-[var(--reward-lime)] px-5 text-[14px] font-semibold text-[var(--on-reward-lime)] transition-transform duration-150 hover:-translate-y-px hover:brightness-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--reward-lime)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--reward-hero-bg)] active:translate-y-0"
          >
            {t("WORKSPACE_START_PICKING", "Start Picking")}
          </button>
          <Link
            href="/rewards"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--brand-lavender)_36%,transparent)] bg-[color-mix(in_srgb,var(--brand-purple)_40%,transparent)] px-5 text-[14px] font-semibold text-[var(--on-brand)] no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--brand-purple)_62%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--reward-lime)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--reward-hero-bg)]"
          >
            {t("WORKSPACE_EXPLORE_REWARDS", "Explore Rewards")}
          </Link>
        </div>
        <p className="mb-0 mt-3 text-[12px] text-[var(--reward-hero-muted)]">
          {t(
            "WORKSPACE_REWARD_TRUST",
            "Free to play  •  New rewards every week  •  Real prizes",
          )}
        </p>
      </div>
      <div className="relative min-h-[264px] overflow-hidden min-[900px]:min-h-full">
        <FeaturedRewardArtwork />
        <div className="absolute left-4 top-1/2 z-10 hidden w-[176px] -translate-y-1/2 min-[900px]:block">
          <FeaturedRewardBadge />
        </div>
        <div className="absolute left-3 top-3 z-10 w-[196px] min-[900px]:hidden">
          <FeaturedRewardBadge />
        </div>
      </div>
    </section>
  );
}

function WorkspaceNotice({
  children,
  href,
}: {
  children: string;
  href: string;
}) {
  const { t } = useTranslation("prediction");
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 rounded-lg border border-[var(--border-1)] bg-[color-mix(in_srgb,var(--card)_64%,var(--raised))] px-3 text-[12px] text-[var(--ink-3)]">
      <span className="min-w-0 truncate">{children}</span>
      <Link
        href={href}
        className="shrink-0 font-semibold text-[var(--brand-purple)] no-underline hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
      >
        {t("WORKSPACE_START_GUIDE", "Start guide")}
      </Link>
    </div>
  );
}

export function PredictionWorkspace({
  discovery,
  categories,
  catalogCategories,
  activeCategorySlug,
  activeCategoryId,
}: PredictionWorkspaceProps) {
  const { t } = useTranslation("prediction");
  const discoveryMarketCount =
    discovery.featured.length +
    discovery.trending.length +
    discovery.closingSoon.length +
    discovery.recent.length;

  return (
    <div className="mx-auto grid w-full max-w-[1920px] grid-cols-[224px_minmax(0,1fr)] items-start bg-[var(--paper)] max-[1199px]:grid-cols-[72px_minmax(0,1fr)] max-[1023px]:grid-cols-1">
      <TerminalCategoryRail
        categories={categories}
        mode="predict"
        activeCategorySlug={activeCategorySlug}
      />

      <main
        className="min-w-0 px-12 py-8 max-[1199px]:px-8 max-[1023px]:px-5 max-[1023px]:py-5"
        data-discovery-market-count={discoveryMarketCount}
      >
        <div className="mx-auto max-w-[1120px]">
          <div className="min-[1024px]:hidden">
            <h1 className="type-display m-0 text-[24px] font-semibold leading-[1.2] tracking-[-0.025em] text-[var(--ink)]">
              {t("WORKSPACE_MOMENTS_TITLE", "Trending moments")}
            </h1>
            <p className="mb-0 mt-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--brand-purple)]">
              {t("WORKSPACE_EXPLORE_TOPICS", "Explore topics · all moments")}
            </p>
          </div>

          <div className="mt-4 min-[1024px]:mt-0">
            <RewardHero />
          </div>

          <div className="mt-4 min-[761px]:mt-6">
            <WorkspaceNotice href="/about">
              {t(
                "WORKSPACE_GUIDE_NOTICE",
                "New here? See how picks and points work.",
              )}
            </WorkspaceNotice>
          </div>

          <div className="mt-4 min-[761px]:mt-6">
            <AllMarketsSection
              categories={catalogCategories}
              categoryId={activeCategoryId}
              variant="moments"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
