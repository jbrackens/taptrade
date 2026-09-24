import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");
const card = readFileSync(
  resolve(appRoot, "components/prediction/MarketCard.tsx"),
  "utf8",
);
const grid = readFileSync(
  resolve(appRoot, "components/prediction/MarketGrid.tsx"),
  "utf8",
);
const thumb = readFileSync(
  resolve(appRoot, "components/prediction/MarketThumb.tsx"),
  "utf8",
);
const featured = readFileSync(
  resolve(appRoot, "components/prediction/FeaturedMarket.tsx"),
  "utf8",
);

describe("Market Discovery Card", () => {
  it("keeps the Kilig card anatomy: thumb, clamped question, chance and volume", () => {
    // The 2026-09-24 redesign dropped the ranked/mixed anatomy for a
    // uniform card: MarketThumb + a line-clamped question with the YES
    // chance at the right, then a quiet volume/close-date footer line.
    assert.match(card, /<MarketThumb categorySlug=\{categorySlug\} imageUrl=\{photo\}/);
    assert.match(card, /line-clamp-3/);
    assert.match(card, /\{yesPercentage\}%/);
    assert.match(card, /t\("CHANCE", "chance"\)/);
    assert.match(card, /formatCompactPoints\(volumePoints\)/);
    assert.match(card, /t\("VOL_SHORT", "vol"\)/);
    // Cards now carry a whisper of resting shadow with a small lift on
    // hover (globals.css --shadow-card is no longer `none`).
    assert.match(card, /shadow-\[var\(--shadow-card\)\]/);
    assert.match(card, /hover:shadow-\[var\(--shadow-card-hover\)\]/);
    // No legacy purple/lavender or retired rank/trending anatomy.
    assert.doesNotMatch(card, /brand-lavender|brand-purple/);
    assert.doesNotMatch(card, /rankLabel|t\("TRENDING"/);
  });

  it("renders the two live market sides as soft percentage chips", () => {
    assert.match(card, /\(\["yes", "no"\] as const\)\.map/);
    assert.match(card, /bg-\[var\(--yes-soft\)\] text-\[var\(--yes-text\)\] hover:bg-\[var\(--yes\)\]/);
    assert.match(card, /bg-\[var\(--no-soft\)\] text-\[var\(--no-text\)\] hover:bg-\[var\(--no\)\]/);
    assert.match(card, /`\$\{percentage\}% \$\{t\("BUY_YES", "Yes"\)\}`/);
    assert.doesNotMatch(card, /¢/);
  });

  it("shows a market photo with a tinted category-icon fallback, not a poster tile", () => {
    // TerminalCategoryRail/PosterTile/market-poster.ts were deleted with
    // the redesign; MarketThumb is the shared replacement everywhere a
    // market needed art — a real photo when one loads, else a category
    // icon on a tinted tile, both decorative (aria-hidden).
    assert.match(card, /<MarketThumb/);
    assert.doesNotMatch(card, /<PosterTile|size\?: MarketCardSize/);
    assert.match(thumb, /onError=\{\(\) => setImageFailed\(true\)\}/);
    assert.match(thumb, /const \{ icon: Icon, tint \} = categoryVisual\(categorySlug\)/);
    assert.match(thumb, /aria-hidden="true"/);
  });

  it("opens quick trade in place for open markets and deep-links otherwise", () => {
    assert.match(card, /onQuickTrade\?: \(side: "yes" \| "no"\) => void/);
    assert.match(card, /const quickTrade = isOpen \? onQuickTrade : undefined/);
    assert.match(card, /onClick=\{\(\) => quickTrade\(side\)\}/);
    assert.match(card, /aria-haspopup="dialog"/);
    assert.match(card, /href=\{`\/market\/\$\{ticker\}\?side=\$\{side\}`\}/);
  });

  it("hosts one quick-trade panel per grid unless a parent owns it", () => {
    assert.match(grid, /<QuickTradePanel/);
    assert.match(grid, /openQuickTrade\(\{ market: localized, side \}\)/);
    assert.match(grid, /onClose=\{\(\) => setQuickTrade\(null\)\}/);
    assert.match(grid, /\{!onQuickTrade && \(/);
  });

  it("renders a single uniform grid, not a mixed wide/standard board", () => {
    // The "mixed" pattern (wide lead card at slots 0 and 6) was deleted
    // with LeadMoment/PosterTile; MarketGrid now renders every market at
    // the same size, with only a column-count knob.
    assert.match(grid, /columns\?: 3 \| 4/);
    assert.match(
      grid,
      /3:\s*"grid grid-cols-3 items-stretch gap-4 min-\[641px\]:auto-rows-fr max-\[1020px\]:grid-cols-2 max-\[640px\]:grid-cols-1/,
    );
    assert.doesNotMatch(grid, /pattern\?: "uniform" \| "mixed"|"wide" : "standard"/);
  });

  it("removes unapproved card media and explanatory content", () => {
    assert.doesNotMatch(card, /getMarketImageProps|<Star/);
    assert.doesNotMatch(card, /Why it matters|What this settles|Derived from/);
  });

  it("gives the Trending list stable one-based ranks", () => {
    // MarketGrid itself no longer assigns ranks (the ranked-card anatomy
    // was deleted); the surviving ranked list is FeaturedMarket's
    // "Trending" sidebar, numbered from its map index.
    assert.match(featured, /trending\.map\(\(market, index\) => \{/);
    assert.match(featured, /\{index \+ 1\}/);
    assert.doesNotMatch(grid, /rankStart/);
  });
});
