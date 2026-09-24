"use client";

/**
 * Predict discovery workspace.
 *
 * Figma source: TapTrade Design → 06 · Trending Moments →
 * 08 · Predict — Points-led / Desktop (213:870) and Mobile (221:1105).
 *
 * The pageable market grid is deliberately the primary surface. Moment
 * context sets the scene, without a featured-price carousel or a
 * persistent trade rail competing with public market discovery. The
 * "Pick. Win. Redeem." reward hero (iPhone featured reward) was removed on
 * 2026-09-24: Points are non-redeemable play value, so /predict must not
 * advertise redemption or prizes.
 */

import Link from "next/link";
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

// A quiet one-line pointer for first-timers: no box, no fill, so the
// lead moment stays the first thing the eye lands on.
function WorkspaceNotice({
  children,
  href,
}: {
  children: string;
  href: string;
}) {
  const { t } = useTranslation("prediction");
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[13px] text-[var(--t3)]">
      <span>{children}</span>
      <Link
        href={href}
        className="font-semibold text-[var(--t1)] underline decoration-[var(--border-2)] underline-offset-4 transition-colors hover:decoration-[var(--t1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
      >
        {t("WORKSPACE_START_GUIDE", "Start guide")} →
      </Link>
    </p>
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
        className="min-w-0 px-10 py-7 max-[1199px]:px-8 max-[1023px]:px-4 max-[1023px]:py-5"
        data-discovery-market-count={discoveryMarketCount}
      >
        <div className="mx-auto max-w-[1180px]">
          {/* The desktop rail already shows this title, so it stays in the
              accessibility tree there as the page's h1 without repeating. */}
          <div className="min-[1024px]:sr-only">
            <h1 className="type-poster m-0 text-[40px] text-[var(--t1)]">
              {t("WORKSPACE_MOMENTS_TITLE", "Trending moments")}
            </h1>
          </div>

          <div className="mt-2 mb-4 min-[1024px]:mt-0">
            <WorkspaceNotice href="/about">
              {t(
                "WORKSPACE_GUIDE_NOTICE",
                "New here? See how picks and points work.",
              )}
            </WorkspaceNotice>
          </div>

          <div>
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
