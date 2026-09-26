/**
 * Brand mark — "First Word" (2026-09-26): a speech tile with a T knocked
 * out, its corner running out to a point. Pins the artwork's anatomy and
 * colours so the mark cannot drift back to a retired glyph (the staircase,
 * the "Call it" check) or pick up a pink T.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(appRoot, rel), "utf-8");

describe("First Word brand mark", () => {
  const ink = read("../public/brand/taptrade-mark-ink.svg");
  const light = read("../public/brand/taptrade-mark-light.svg");
  const favicon = read("icon.svg");
  const icon = read("../public/brand/taptrade-app-icon.svg");
  const component = read("components/BrandMark.tsx");

  it("is one even-odd shape — tile, tail and knocked-out T — on every tone", () => {
    for (const svg of [ink, light, icon, favicon]) {
      assert.match(svg, /fill-rule="evenodd"/);
      assert.match(svg, /H18L0 86V24/, "the tile's corner runs out to the tail point");
      assert.match(svg, /M20 20H64V34H49V58H35V34H20Z/, "the knocked-out T");
      assert.doesNotMatch(svg, /<circle|stroke-linecap/, "no check or tap dot from Call it");
    }
    assert.match(ink, /fill="#111114"/);
    assert.match(light, /fill="#F4F3EF"/);
  });

  it("never puts brand pink on the mark", () => {
    for (const svg of [ink, light, icon, favicon]) {
      assert.doesNotMatch(svg, /#E0126E|#FF2D78/i);
    }
    assert.equal(existsSync(resolve(appRoot, "../public/brand/taptrade-mark-brand.svg")), false);
  });

  it("ships the app icon as an ink tile with a white mark", () => {
    assert.match(icon, /<rect width="256" height="256" rx="58" fill="#111114"\/>/);
    assert.match(icon, /<path fill="#FFFFFF" fill-rule="evenodd"/);
  });

  it("keeps the favicon tile-less and flips it to warm white on dark tabs", () => {
    assert.doesNotMatch(favicon, /<rect/);
    assert.match(favicon, /prefers-color-scheme: dark\)\{\.m\{fill:#F4F3EF\}/);
  });

  it("versions the mark URL so browsers never paint a cached old mark", () => {
    assert.match(component, /const MARK_VERSION = "first-word-\d+";/);
    for (const tone of ["ink", "light"]) {
      assert.match(
        component,
        new RegExp(`${tone}: \`/brand/taptrade-mark-${tone}\\.svg\\?v=\\$\\{MARK_VERSION\\}\``),
      );
    }
  });

  it("sizes BrandMark by height on the mark's own proportions", () => {
    assert.match(ink, /viewBox="0 0 84 86"/);
    assert.match(component, /\(size \* 84\) \/ 86/);
    assert.match(component, /height=\{size\}/);
    assert.match(component, /style=\{\{ height: size, width: "auto" \}\}/, "preflight must not unsize the mark");
    assert.doesNotMatch(component, /72\.1|17\.8604/, "retired mark ratios");
  });
});
