/**
 * Ink & lime step 4 — /portfolio (Position and Orders 11a-c, States 18b).
 *
 * Source-level assertions (repo convention — the suite runs node:test,
 * not a DOM harness) pinning the step's contracts:
 *  - value = qty × mark and unrealized = value − cost, from the market
 *    object the page already hydrates (no new endpoint)
 *  - signed values NEVER go through formatCompactPoints (it clamps
 *    negatives to zero); every signed number uses formatPoints
 *  - Cancel is a full-width ≥44px control, not a row chip
 *  - the Available column became a conditional lock note
 *  - Card grew the dashed + left-edge variants for 18b/18c states
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(resolve(appRoot, rel), "utf-8");
}

describe("portfolio Value now / Unrealized (step 4)", () => {
  const page = read("portfolio/page.tsx");

  it("derives value and unrealized from the hydrated mark price", () => {
    assert.match(page, /p\.side === "yes"\s*\?\s*m\.yesPricePoints\s*:\s*m\.noPricePoints/);
    assert.match(page, /value - p\.totalCostPoints/);
    assert.match(page, /Value now/);
  });

  it("never formats a signed value with formatCompactPoints", () => {
    assert.ok(
      !page.includes("formatCompactPoints"),
      "formatCompactPoints clamps negatives to zero — portfolio has signed values everywhere",
    );
    // Signed renders go through formatPoints with an explicit sign.
    assert.match(page, /formatPoints\(Math\.abs\(unrealized\)\)/);
    assert.match(page, /formatPoints\(Math\.abs\(h\.realizedPoints\)\)/);
  });

  it("keeps the sign convention documented in lib/points", () => {
    const points = read("lib/points.ts");
    assert.match(
      points,
      /Negative inputs clamp\s*\n?\s*\* to 0/,
      "the clamp warning must stay documented on formatCompactPoints",
    );
  });

  it("gives Cancel a full-width 44px control", () => {
    assert.match(page, /min-h-11 w-full[^"]*Cancel|min-h-11 w-full/);
    assert.match(page, /cancelOrder/);
  });

  it("shows Available only as a lock note when shares are reserved", () => {
    assert.ok(!page.includes('t("table.available"'), "the Available column is gone");
    assert.match(page, /reserved > 0 &&/);
    assert.match(page, /PHOSPHOR_LOCK_FILL/);
  });

  it("uses pale fills with dark direction text for side chips", () => {
    assert.match(page, /bg-\[var\(--yes-soft\)\] text-\[var\(--yes-text\)\]/);
    assert.match(page, /bg-\[var\(--no-soft\)\] text-\[var\(--no-text\)\]/);
    assert.ok(
      !/SideChip[\s\S]{0,400}bg-\[var\(--no\)\]/.test(page),
      "saturated direction tokens are for text and dots, never chip fills",
    );
  });
});

describe("Card 18b/18c variants (step 4)", () => {
  const card = read("components/ui/Card.tsx");

  it("ships dashed and left-edge variants", () => {
    assert.match(card, /dashed: "border-dashed border-\[var\(--border-2\)\]"/);
    // Kilig: the error edge is the system danger colour, never market NO.
    assert.match(card, /border-l-\[3px\] border-l-\[var\(--danger\)\]/);
    assert.doesNotMatch(card, /border-l-\[var\(--no\)\]/);
    assert.match(card, /border-l-\[3px\] border-l-\[var\(--info-dot\)\]/);
  });
});
