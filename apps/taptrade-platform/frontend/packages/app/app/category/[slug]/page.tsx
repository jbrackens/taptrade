"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { MarketGrid } from "../../components/prediction/MarketGrid";
import { categoryName } from "../../components/prediction/market-content";
import { logger } from "../../lib/logger";
import type {
  PredictionMarket,
  Category,
} from "@taptrade-ui/api-client/src/prediction-types";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";

const api = createPredictionClient();

const ROUTE_LOADING_CLASS = "p-20 text-center text-[13px] text-[var(--t3)]";
const CATEGORY_HEAD_CLASS =
  "mb-6 flex flex-wrap items-baseline justify-between gap-3";
// Page header: the category name as a sentence-case page title.
const CATEGORY_TITLE_CLASS =
  "type-poster m-0 text-[28px] max-[640px]:text-[24px] text-[var(--t1)]";
const CATEGORY_SUB_CLASS = "text-[13px] text-[var(--t3)] tabular-nums";
// Category browse uses the same card grid as /predict.
const CATEGORY_EMPTY_CLASS =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] px-5 py-14 text-center text-[13px] text-[var(--t3)]";

export default function CategoryPage() {
  const { t } = useTranslation("prediction");
  const { t: contentT } = useTranslation("market-content");
  const params = useParams() ?? {};
  const slug = (params.slug as string | undefined) ?? "";

  const [category, setCategory] = useState<Category | null>(null);
  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const cat = await api.getCategory(slug);
        if (cancelled) return;
        setCategory(cat);
        // Markets are queried directly with a categoryId filter (the gateway
        // joins markets → events → category). This surfaces both real and
        // synthetic-hosted markets in one flat list — synthetic events are
        // hidden from event listings but their markets still belong to the
        // category and should appear here.
        const marketsRes = await api.getMarkets({
          categoryId: cat.id,
          status: "open",
          pageSize: 200,
        });
        if (cancelled) return;
        setMarkets(marketsRes.data || []);
      } catch (err: unknown) {
        logger.error("CategoryPage", "load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return <div className={ROUTE_LOADING_CLASS}>{t("LOADING_MARKETS")}</div>;
  }

  return (
    <div className="mx-auto w-full max-w-[1232px]">
      <header className={CATEGORY_HEAD_CLASS}>
        <h1 className={CATEGORY_TITLE_CLASS}>
          {category ? categoryName(contentT, category) : slug}
        </h1>
        <p className={CATEGORY_SUB_CLASS}>
          {t("OPEN_MARKET_COUNT", { count: markets.length })}
        </p>
      </header>

      {markets.length === 0 ? (
        <div className={CATEGORY_EMPTY_CLASS}>
          {t("NO_OPEN_MARKETS_IN_CATEGORY")}
        </div>
      ) : (
        <MarketGrid markets={markets} columns={3} />
      )}
    </div>
  );
}
