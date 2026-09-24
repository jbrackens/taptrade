"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { MarketCard, type MarketCardSize } from "./MarketCard";
import { categoryLabel, localizedMarket } from "./market-content";
import { QuickTradePanel, type QuickTradeTarget } from "./QuickTradePanel";

interface Props {
  markets: PredictionMarket[];
  columns?: 3 | 4;
  /** One-based rank for the first market in this rendered result set. */
  rankStart?: number;
  watchedMarketIds?: Set<string>;
  onToggleWatchlist?: (marketId: string) => void;
  /**
   * "mixed" (3 columns only) repeats a 7-card rhythm — wide+standard,
   * three standard, standard+wide — so the board never reads as a uniform
   * wall. "uniform" keeps every card the same size.
   */
  pattern?: "uniform" | "mixed";
  /**
   * Hand YES/NO taps to a parent that hosts its own QuickTradePanel (so a
   * page with a lead moment and a grid mounts one panel, not two).
   */
  onQuickTrade?: (target: QuickTradeTarget) => void;
}

const GRID_CLASS_BY_COLUMNS: Record<NonNullable<Props["columns"]>, string> = {
  3: "grid grid-cols-3 items-stretch gap-4 min-[641px]:auto-rows-fr max-[1120px]:grid-cols-2 max-[640px]:grid-cols-1",
  4: "grid grid-cols-4 items-stretch gap-4 min-[641px]:auto-rows-fr max-[1280px]:grid-cols-3 max-[960px]:grid-cols-2 max-[640px]:grid-cols-1",
};

const WIDE_CELL_CLASS = "col-span-2 max-[640px]:col-span-1";

function sizeFor(index: number, pattern: Props["pattern"], columns: number): MarketCardSize {
  if (pattern !== "mixed" || columns !== 3) return "standard";
  const slot = index % 7;
  return slot === 0 || slot === 6 ? "wide" : "standard";
}

export function MarketGrid({
  markets,
  columns = 4,
  rankStart = 1,
  watchedMarketIds,
  onToggleWatchlist,
  pattern = "uniform",
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
          const size = sizeFor(index, pattern, columns);
          return (
            <div
              key={localized.id}
              className={`card-in h-full ${size === "wide" ? WIDE_CELL_CLASS : ""}`}
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
                size={size}
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
