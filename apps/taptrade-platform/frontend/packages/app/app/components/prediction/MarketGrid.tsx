"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { MarketCard } from "./MarketCard";
import { categoryLabel, localizedMarket } from "./market-content";
import { QuickTradePanel, type QuickTradeTarget } from "./QuickTradePanel";

interface Props {
  markets: PredictionMarket[];
  columns?: 3 | 4;
  /** One-based rank for the first market in this rendered result set. */
  rankStart?: number;
  watchedMarketIds?: Set<string>;
  onToggleWatchlist?: (marketId: string) => void;
}

const GRID_CLASS_BY_COLUMNS: Record<NonNullable<Props["columns"]>, string> = {
  3: "grid auto-rows-fr grid-cols-3 items-stretch gap-5 max-[1120px]:grid-cols-2 max-[640px]:grid-cols-1 max-[640px]:gap-4",
  4: "grid auto-rows-fr grid-cols-4 items-stretch gap-5 max-[1280px]:grid-cols-3 max-[960px]:grid-cols-2 max-[640px]:grid-cols-1 max-[640px]:gap-4",
};

export function MarketGrid({
  markets,
  columns = 4,
  rankStart = 1,
  watchedMarketIds,
  onToggleWatchlist,
}: Props) {
  const { t } = useTranslation("market-content");
  // A card's YES/NO opens the trade panel in place; the card body still
  // links to the full market page.
  const [quickTrade, setQuickTrade] = useState<QuickTradeTarget | null>(null);

  if (!markets || markets.length === 0) return null;

  return (
    <>
      <div className={GRID_CLASS_BY_COLUMNS[columns]} data-testid="market-grid">
        {markets.map((market, index) => {
          const localized = localizedMarket(t, market);
          return (
            <div
              key={localized.id}
              className="card-in h-full"
              style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}
            >
              <MarketCard
                marketId={localized.id}
                rank={rankStart + index}
                ticker={localized.ticker}
                title={localized.title}
                yesPricePoints={localized.yesPricePoints}
                noPricePoints={localized.noPricePoints}
                volumePoints={localized.volumePoints}
                closeAt={localized.closeAt}
                status={localized.status}
                categoryLabel={
                  localized.categorySlug
                    ? categoryLabel(t, localized.categorySlug)
                    : localized.categoryName || undefined
                }
                imagePath={localized.imagePath}
                imageUrl={localized.imageUrl}
                image_url={localized.image_url}
                watched={watchedMarketIds?.has(localized.id) ?? false}
                onToggleWatchlist={onToggleWatchlist}
                onQuickTrade={(side) =>
                  setQuickTrade({ market: localized, side })
                }
              />
            </div>
          );
        })}
      </div>
      <QuickTradePanel
        target={quickTrade}
        onClose={() => setQuickTrade(null)}
      />
    </>
  );
}
