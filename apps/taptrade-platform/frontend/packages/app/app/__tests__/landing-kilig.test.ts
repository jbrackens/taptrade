/**
 * Landing (deep-purple) — source contracts for the front door.
 *
 * The landing was rebuilt 2026-08-09 to the Figma purple/gold recipe (03 Screens →
 * Landing / 1440), restyled to Kilig 2026-09-24: poster-type display on the `.landing-1c` tokens, real-data
 * ticker, the actual trade loop as steps, editorial desk chips, the
 * 500-PTS welcome band, and inline compliance copy. These pins replace the
 * old page's contracts (interactive YES/NO demo, ambient video, lime
 * sections, trade-ticket mockup) — those features were retired with the
 * redesign. Source-level assertions per repo convention (node:test, no DOM
 * harness).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(resolve(appRoot, rel), "utf-8");
}

const page = read("page.tsx");
const globals = read("globals.css");

const SHIPPED_LOCALES = ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"];

function readPageHome(locale: string): Record<string, string> {
  return JSON.parse(
    readFileSync(
      resolve(appRoot, "../public/static/locales", locale, "page-home.json"),
      "utf-8",
    ),
  ) as Record<string, string>;
}

describe("landing purple/gold recipe (Figma 03 Screens)", () => {
  it("declares the landing tokens once and consumes only vars in the page", () => {
    assert.ok(
      globals.includes(".landing-1c"),
      "globals.css must define the landing token scope",
    );
    for (const token of [
      "--l-bg",
      "--l-inset",
      "--l-raised",
      "--l-hairline",
      "--l-purple",
      "--l-gold",
      "--l-on-purple",
    ]) {
      assert.ok(globals.includes(`${token}:`), `globals.css must define ${token}`);
    }
    assert.ok(
      !/#(?:101207|0b0d04|161908|324019|c6f24e|17200a)\b/i.test(page),
      "page.tsx must consume tokens via var(), not repeat the hex recipe",
    );
  });

  it("pairs every purple action fill with white text and reserves gold for live", () => {
    const purpleFills = page.match(/bg-\[var\(--l-purple\)\]/g) ?? [];
    assert.ok(purpleFills.length > 0, "the landing must have purple action fills");
    assert.ok(
      page.includes(
        "bg-[var(--l-purple)] font-semibold text-[var(--l-on-purple)]",
      ),
      "the shared purple CTA class must pair its fill and text in one place",
    );
    assert.ok(
      page.includes("bg-[var(--l-gold)]") && page.includes("LIVE_MICRO_CLASS"),
      "LIVE uses the dedicated gold signal rather than a market-direction color",
    );
  });

  it("uses Kilig poster type for display, not a serif", () => {
    assert.ok(page.includes("type-poster"), "display headings use poster type");
    assert.ok(!page.includes("Fraunces"), "the serif display face is retired");
  });
});

describe("landing ticker — honest data", () => {
  it("fetches the real discovery feed and renders nothing on failure", () => {
    assert.ok(
      page.includes('fetch("/api/v1/discovery"'),
      "ticker must read the real discovery API",
    );
    assert.ok(
      page.includes("never a fake tape"),
      "the no-fabricated-markets rule stays documented at the fetch site",
    );
    assert.ok(
      !page.includes("EXAMPLE_MARKETS"),
      "the old hardcoded teaser markets must not return",
    );
    assert.ok(
      page.includes("ticker.length > 0 &&"),
      "an empty ticker renders nothing — no skeleton pretending to be markets",
    );
  });

  it("keeps homepage teasers away from the crypto desk", () => {
    assert.ok(
      page.includes('"ESPORTS & ARENAS"'),
      "the desk strip teases real desks",
    );
    assert.ok(
      !page.includes("CRYPTO & CHAINS"),
      "the crypto desk is launch-prohibited and never teased on the homepage",
    );
  });
});

describe("landing steps — the real trade loop", () => {
  it("names the product's actual moves in every shipped locale", () => {
    for (const key of [
      "steps.pick.title",
      "steps.hold.title",
      "steps.settle.title",
    ]) {
      assert.ok(page.includes(key), `step key ${key} must render`);
    }
    for (const locale of SHIPPED_LOCALES) {
      const copy = readPageHome(locale);
      for (const key of [
        "steps.pick.title",
        "steps.hold.body",
        "steps.settle.body",
        "grant.title",
        "desks.title",
      ]) {
        assert.ok(
          typeof copy[key] === "string" && copy[key].length > 0,
          `${locale}/page-home.json must translate ${key}`,
        );
      }
    }
  });
});

describe("landing compliance copy — inline, not locale", () => {
  it("keeps the money-word legal lines as inline English constants", () => {
    assert.ok(
      page.includes("non-redeemable gameplay points") &&
        page.includes("cannot be cashed out, withdrawn, transferred, or redeemed"),
      "the no-cashout disclosure must ship inline (locale files are banned from money words)",
    );
    assert.ok(
      page.includes("GRANT_MICRO_LEGAL") && page.includes("FOOTER_LEGAL"),
      "legal strings live in named constants beside the register-page precedent",
    );
  });

  it("promises exactly what the starter grant pays", () => {
    assert.ok(
      page.includes("500 PTS"),
      "the welcome band names the real 500-PTS grant, matching STARTER_GRANT_CENTS",
    );
    assert.ok(
      page.includes('href="/auth/register"'),
      "the grant CTA routes to registration, where the grant actually fires",
    );
  });
});
