"use client";

/**
 * /welcome — campaign landing page. "/" is the market board; this page
 * tells the story first and links into it. All data is live: the hero
 * card is the most-traded contested open market, the topic tiles carry
 * real open-market counts, and "Trending right now" is the real board.
 * Sections without data hide themselves; nothing is invented.
 */

import { useEffect, useState } from "react";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import type {
  Category,
  PredictionMarket,
} from "@taptrade-ui/api-client/src/prediction-types";
import { useTranslation } from "react-i18next";
import { pickFeatured } from "../components/prediction/FeaturedMarket";
import { localizedMarket } from "../components/prediction/market-content";
import { QuickTradePanel, type QuickTradeTarget } from "../components/prediction/QuickTradePanel";
import {
  FinalCta,
  HowItWorks,
  TopicTiles,
  TrendingRow,
  TrustBand,
  WELCOME_TOPICS,
  WelcomeFooter,
  WelcomeHeader,
  WelcomeHero,
} from "../components/welcome/WelcomeSections";
import { logger } from "../lib/logger";

const api = createPredictionClient();
const TRENDING_COUNT = 3;

export default function WelcomePage() {
  const { t: contentT } = useTranslation("market-content");
  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [openTotal, setOpenTotal] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [quickTrade, setQuickTrade] = useState<QuickTradeTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getMarkets({ status: "open", sort: "activity", pageSize: 18 })
      .then((res) => {
        if (cancelled) return;
        setMarkets((res.data ?? []).map((m) => localizedMarket(contentT, m)));
        setOpenTotal(res.meta?.total ?? null);
      })
      .catch((err: unknown) => logger.warn("Welcome", "markets load failed", err));

    api
      .getCategories()
      .then(async (cats) => {
        if (cancelled) return;
        setCategories(cats);
        const entries = await Promise.all(
          WELCOME_TOPICS.map(async (slug) => {
            const category = cats.find((c) => c.slug.toLowerCase() === slug);
            if (!category) return [slug, 0] as const;
            const res = await api.getMarkets({ categoryId: category.id, status: "open", pageSize: 1 });
            return [slug, res.meta?.total ?? 0] as const;
          }),
        );
        if (!cancelled) setCounts(Object.fromEntries(entries));
      })
      .catch((err: unknown) => logger.warn("Welcome", "topic counts load failed", err));

    return () => {
      cancelled = true;
    };
  }, [contentT]);

  const hero = markets.length > 0 ? (pickFeatured(markets) ?? null) : null;
  // The most-traded markets that are still in play (10–90), the same
  // "contested" rule as the hero: a marketing page should show live
  // questions, not settled-looking 1% ones. Order stays by activity.
  const trending = markets
    .filter((m) => m.id !== hero?.id)
    .filter((m) => m.yesPricePoints >= 10 && m.yesPricePoints <= 90)
    .slice(0, TRENDING_COUNT);

  return (
    <div className="min-h-screen bg-[var(--surface-1)] text-[var(--t1)]">
      <WelcomeHeader />
      <main>
        <WelcomeHero
          market={hero}
          openTotal={openTotal}
          onQuickTrade={(market, side) => setQuickTrade({ market, side })}
        />
        <TopicTiles categories={categories} counts={counts} />
        <HowItWorks />
        <TrendingRow markets={trending} />
        <TrustBand />
        <FinalCta />
      </main>
      <WelcomeFooter />
      <QuickTradePanel target={quickTrade} onClose={() => setQuickTrade(null)} />
    </div>
  );
}
