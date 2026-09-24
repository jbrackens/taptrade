"use client";

/**
 * Predict discovery workspace.
 *
 * The home page and /predict. Topic tabs under the top bar; a welcome
 * strip for signed-out visitors; the curated "This week in the
 * Philippines" photo rail when enough featured moments are live; then the
 * board: a featured market with its chart beside a trending list, then
 * the filterable market grid. The
 * "Pick. Win. Redeem." reward hero (iPhone featured reward) was removed on
 * 2026-09-24: Points are non-redeemable play value, so /predict must not
 * advertise redemption or prizes.
 */

import { useTranslation } from "react-i18next";
import type {
  Category,
  DiscoveryResponse,
} from "@taptrade-ui/api-client/src/prediction-types";
import { AllMarketsSection } from "./AllMarketsSection";
import { CategoryTabs } from "./CategoryTabs";
import { ThisWeekRail } from "./ThisWeekRail";
import { WelcomeStrip } from "./WelcomeStrip";

interface PredictionWorkspaceProps {
  discovery: DiscoveryResponse;
  categories: Category[];
  catalogCategories: Category[];
  activeCategorySlug?: string;
  activeCategoryId?: string;
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
    <div className="w-full bg-[var(--paper)]">
      <CategoryTabs
        categories={categories}
        activeCategorySlug={activeCategorySlug}
      />
      <main
        className="mx-auto min-w-0 max-w-[1280px] px-6 pb-16 pt-6 max-[640px]:px-4 max-[640px]:pt-4"
        data-discovery-market-count={discoveryMarketCount}
      >
        <h1 className="sr-only">
          {t("WORKSPACE_MOMENTS_TITLE", "Trending moments")}
        </h1>
        <WelcomeStrip />
        {/* The curated photo rail leads the unfiltered home board; a topic
            tab narrows the board and drops it. */}
        {!activeCategorySlug && <ThisWeekRail />}
        <AllMarketsSection
          categories={catalogCategories}
          categoryId={activeCategoryId}
          variant="moments"
        />
      </main>
    </div>
  );
}
