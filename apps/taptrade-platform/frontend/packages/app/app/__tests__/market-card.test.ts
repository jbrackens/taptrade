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

describe("Market Discovery Card", () => {
  it("keeps the Kilig ranked-market anatomy", () => {
    // Rows line up on the grid; the one-column phone list hugs content.
    assert.match(card, /min-\[641px\]:min-h-\[236px\]/);
    assert.match(card, /font-mono text-\[11px\] text-\[var\(--t3\)\]">\{rankLabel\}/);
    assert.match(card, /t\("TRENDING", "Trending"\)/);
    assert.match(card, /bg-\[var\(--live\)\]/);
    assert.match(card, /t\("CHANCE", "chance"\)/);
    assert.match(card, /bg-\[var\(--yes\)\]/);
    assert.match(card, /bg-\[var\(--no-bar\)\]/);
    assert.match(card, /formatCompactPoints\(volumePoints\)/);
    // No resting shadow, no legacy purple/lavender.
    assert.doesNotMatch(card, /shadow-\[var\(--shadow-card/);
    assert.doesNotMatch(card, /brand-lavender|brand-purple/);
  });

  it("renders the two live market sides as soft percentage chips", () => {
    assert.match(card, /\(\["yes", "no"\] as const\)\.map/);
    assert.match(card, /bg-\[var\(--yes-soft\)\] text-\[var\(--yes-text\)\] hover:bg-\[var\(--yes\)\]/);
    assert.match(card, /bg-\[var\(--no-soft\)\] text-\[var\(--no-text\)\] hover:bg-\[var\(--no\)\]/);
    assert.match(card, /`\$\{percentage\}% \$\{t\("BUY_YES", "Yes"\)\}`/);
    assert.doesNotMatch(card, /¢/);
  });

  it("puts a poster tile beside wide cards", () => {
    assert.match(card, /size\?: MarketCardSize/);
    assert.match(card, /<PosterTile/);
    assert.match(card, /min-\[641px\]:grid-cols-\[minmax\(0,0\.9fr\)_minmax\(0,1fr\)\]/);
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

  it("mixes card sizes on the 3-column board", () => {
    assert.match(grid, /pattern\?: "uniform" \| "mixed"/);
    assert.match(grid, /slot === 0 \|\| slot === 6 \? "wide" : "standard"/);
  });

  it("removes unapproved card media and explanatory content", () => {
    assert.doesNotMatch(card, /getMarketImageProps|<Star/);
    assert.doesNotMatch(card, /Why it matters|What this settles|Derived from/);
  });

  it("receives stable one-based ranks from the grid", () => {
    assert.match(grid, /rankStart\?: number/);
    assert.match(grid, /rankStart = 1/);
    assert.match(grid, /rank=\{rankStart \+ index\}/);
  });
});
