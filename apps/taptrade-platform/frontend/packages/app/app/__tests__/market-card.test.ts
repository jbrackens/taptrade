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
  it("keeps the approved ranked-market anatomy", () => {
    assert.match(card, /min-h-\[222px\]/);
    assert.match(card, /bg-\[var\(--brand-lavender\)\]/);
    assert.match(card, /t\("TRENDING", "Trending"\)/);
    assert.match(card, /PARTICIPANT_VIEW/);
    assert.match(card, /bg-\[var\(--yes\)\]/);
    assert.match(card, /bg-\[var\(--no\)\]/);
    assert.match(card, /formatCompactPoints\(volumePoints\)/);
  });

  it("renders the two live market sides as percentage actions", () => {
    assert.match(card, /\(\["yes", "no"\] as const\)\.map/);
    assert.match(
      card,
      /`\$\{percentage\}% \$\{side === "yes" \? t\("YES"\) : t\("NO"\)\}`/,
    );
    assert.doesNotMatch(card, /¢/);
  });

  it("opens quick trade in place for open markets and deep-links otherwise", () => {
    assert.match(card, /onQuickTrade\?: \(side: "yes" \| "no"\) => void/);
    assert.match(card, /const quickTrade = isOpen \? onQuickTrade : undefined/);
    assert.match(card, /onClick=\{\(\) => quickTrade\(side\)\}/);
    assert.match(card, /aria-haspopup="dialog"/);
    assert.match(card, /href=\{`\/market\/\$\{ticker\}\?side=\$\{side\}`\}/);
  });

  it("hosts one quick-trade panel per grid", () => {
    assert.match(grid, /<QuickTradePanel/);
    assert.match(grid, /setQuickTrade\(\{ market: localized, side \}\)/);
    assert.match(grid, /onClose=\{\(\) => setQuickTrade\(null\)\}/);
  });

  it("removes unapproved card media and explanatory content", () => {
    assert.doesNotMatch(card, /getMarketImageProps|<img|<Star/);
    assert.doesNotMatch(card, /Why it matters|What this settles|Derived from/);
  });

  it("receives stable one-based ranks from the grid", () => {
    assert.match(grid, /rankStart\?: number/);
    assert.match(grid, /rankStart = 1/);
    assert.match(grid, /rank=\{rankStart \+ index\}/);
  });
});
