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
  watchedMarketIds?: Set<string>;
  onToggleWatchlist?: (marketId: string) => void;
  /**
   * Hand YES/NO taps to a parent that hosts its own QuickTradePanel (so a
   * page with a featured market and a grid mounts one panel, not two).
   */
  onQuickTrade?: (target: QuickTradeTarget) => void;
}

// Equal-height rows only where there are several columns; the one-column
// phone list lets each card hug its content.
const GRID_CLASS_BY_COLUMNS: Record<NonNullable<Props["columns"]>, string> = {
  3: "grid grid-cols-3 items-stretch gap-4 min-[641px]:auto-rows-fr max-[1020px]:grid-cols-2 max-[640px]:grid-cols-1 max-[640px]:gap-3",
  4: "grid grid-cols-4 items-stretch gap-4 min-[641px]:auto-rows-fr max-[1180px]:grid-cols-3 max-[900px]:grid-cols-2 max-[640px]:grid-cols-1 max-[640px]:gap-3",
};

export function MarketGrid({
  markets,
  columns = 4,
  watchedMarketIds,
  onToggleWatchlist,
  onQuickTrade,
}: Props) {
  const { t } = useTranslation("market-content");
  // A card's YES/NO opens the trade panel in place; the card body still
  // links to the full market page.
  const [quickTrade, setQuickTrade] = useState<QuickTradeTarget | null>(null);
  const openQuickTrade = onQuickTrade ?? setQuickTrade;

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
              style={{ animationDelay: `${Math.min(index, 11) * 30}ms` }}
            >
              <MarketCard
                marketId={localized.id}
                ticker={localized.ticker}
                title={localized.title}
                yesPricePoints={localized.yesPricePoints}
                noPricePoints={localized.noPricePoints}
                volumePoints={localized.volumePoints}
                closeAt={localized.closeAt}
                status={localized.status}
                categorySlug={localized.categorySlug}
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
                  openQuickTrade({ market: localized, side })
                }
              />
            </div>
          );
        })}
      </div>
      {!onQuickTrade && (
        <QuickTradePanel
          target={quickTrade}
          onClose={() => setQuickTrade(null)}
        />
      )}
    </>
  );
}
