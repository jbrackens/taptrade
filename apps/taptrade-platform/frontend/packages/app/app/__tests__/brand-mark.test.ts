/**
 * Brand mark — "Call it" (2026-09-24): a check whose long stroke launches
 * into the pink tap dot. Pins the artwork's anatomy and colours so the
 * mark cannot drift back to the retired staircase glyph.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(appRoot, rel), "utf-8");

describe("Call it brand mark", () => {
  const ink = read("../public/brand/taptrade-mark-ink.svg");
  const light = read("../public/brand/taptrade-mark-light.svg");
  const favicon = read("icon.svg");
  const icon = read("../public/brand/taptrade-app-icon.svg");
  const component = read("components/BrandMark.tsx");

  it("is a round-stroked check plus a pink dot, on every tone", () => {
    for (const svg of [ink, light, icon, favicon]) {
      assert.match(svg, /stroke-linecap="round"/);
      assert.match(svg, /stroke-linejoin="round"/);
      assert.equal((svg.match(/<circle /g) ?? []).length, 1, "one tap dot");
    }
    assert.match(ink, /stroke="#111114"/);
    assert.match(ink, /fill="#E0126E"/);
    assert.match(light, /stroke="#F4F3EF"/);
    assert.match(light, /fill="#FF2D78"/);
  });

  it("ships the app icon as an ink tile with a white check", () => {
    assert.match(icon, /<rect width="256" height="256" rx="58" fill="#111114"\/>/);
    assert.match(icon, /stroke="#FFFFFF"/);
  });

  it("keeps the favicon tile-less so it never reads as a ticked checkbox", () => {
    assert.doesNotMatch(favicon, /<rect/);
    assert.match(favicon, /prefers-color-scheme: dark/, "the check flips to warm white on dark tabs");
    assert.match(favicon, /fill="#E0126E"/);
  });

  it("keeps BrandMark on the mark's own proportions", () => {
    assert.match(ink, /viewBox="0 0 80\.36 72\.10"/);
    assert.match(component, /\(size \* 72\.1\) \/ 80\.36/);
    assert.doesNotMatch(component, /17\.8604/, "the staircase ratio is retired");
  });
});
