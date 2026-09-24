"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import type {
  PredictionMarket,
  Series,
} from "@taptrade-ui/api-client/src/prediction-types";
import { MarketGrid } from "../../components/prediction/MarketGrid";
import { logger } from "../../lib/logger";

const api = createPredictionClient();

const ROUTE_LOADING_CLASS = "p-20 text-center text-[13px] text-[var(--t3)]";
const SERIES_HEAD_CLASS = "mb-6";
const SERIES_TITLE_ROW_CLASS =
  "flex flex-wrap items-baseline justify-between gap-3";
// Page header, matching the category page.
const SERIES_TITLE_CLASS =
  "type-poster m-0 text-[28px] max-[640px]:text-[24px] text-[var(--t1)]";
const SERIES_META_CLASS =
  "font-mono text-[12px] text-[var(--t3)] tabular-nums";
const SERIES_DESC_CLASS =
  "mt-2 max-w-3xl text-[14px] leading-6 text-[var(--t2)]";
const SERIES_TAGS_CLASS = "mt-4 flex flex-wrap items-center gap-2";
// Pills are reserved for tags, search and the balance chip — DESIGN.md §5.
const SERIES_TAG_CLASS =
  "rounded-[var(--r-pill)] border border-[var(--border-1)] bg-[var(--surface-1)] px-3 py-1 text-[12px] font-semibold text-[var(--t2)]";
const SERIES_EMPTY_CLASS =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] px-5 py-14 text-center text-[13px] text-[var(--t3)]";

export default function SeriesPage() {
  const { t } = useTranslation("prediction");
  const params = useParams() ?? {};
  const slug = (params.slug as string | undefined) ?? "";

  const [series, setSeries] = useState<Series | null>(null);
  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const allSeries = await api.getSeries();
        const match = allSeries.find((item) => item.slug === slug) ?? null;
        if (cancelled) return;
        setSeries(match);
        if (!match) {
          setMarkets([]);
          return;
        }
        const marketsRes = await api.getMarkets({
          seriesId: match.id,
          status: "open",
          pageSize: 200,
        });
        if (cancelled) return;
        setMarkets(marketsRes.data || []);
      } catch (err: unknown) {
        logger.error("SeriesPage", "load failed", err);
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
    <div>
      <header className={SERIES_HEAD_CLASS}>
        <div className={SERIES_TITLE_ROW_CLASS}>
          <h1 className={SERIES_TITLE_CLASS}>{series?.title ?? slug}</h1>
          <p className={SERIES_META_CLASS}>
            {t("OPEN_MARKET_COUNT", { count: markets.length })}
          </p>
        </div>
        {series?.description && (
          <p className={SERIES_DESC_CLASS}>{series.description}</p>
        )}
        {series && (series.frequency || series.tags.length > 0) && (
          <div className={SERIES_TAGS_CLASS}>
            {series.frequency && (
              <span className={SERIES_TAG_CLASS}>{series.frequency}</span>
            )}
            {series.tags.map((tag) => (
              <span key={tag} className={SERIES_TAG_CLASS}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      {markets.length === 0 ? (
        <div className={SERIES_EMPTY_CLASS}>
          {t("NO_OPEN_MARKETS_IN_CATEGORY")}
        </div>
      ) : (
        <MarketGrid markets={markets} columns={3} />
      )}
    </div>
  );
}
