/**
 * Home page = the market board (2026-09-24), with a welcome strip for
 * signed-out visitors and the curated "This week in the Philippines"
 * photo rail once enough featured moments are live. Replaces the retired
 * dark marketing landing and its tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(appRoot, rel), "utf-8");
const LOCALES = ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"];

describe("home page is the market board", () => {
  const page = read("page.tsx");
  const shell = read("components/AppShell.tsx");
  const workspace = read("components/prediction/PredictionWorkspace.tsx");

  it("re-exports the /predict board instead of a marketing page", () => {
    assert.match(page, /export \{ default \} from "\.\/predict\/page"/);
    assert.doesNotMatch(page, /hero|ticker|Fraunces|type-poster/i);
    assert.doesNotMatch(shell, /isLandingRoute/, "no special dark shell for /");
  });

  it("mounts the welcome strip and the rail above the board", () => {
    assert.match(workspace, /<WelcomeStrip \/>/);
    assert.match(workspace, /\{!activeCategorySlug && <ThisWeekRail \/>\}/);
    assert.ok(
      workspace.indexOf("<ThisWeekRail") < workspace.indexOf("<AllMarketsSection"),
      "the rail leads the board",
    );
  });

  it("retires the page-home namespace with the landing", () => {
    for (const locale of LOCALES) {
      assert.ok(
        !existsSync(resolve(appRoot, `../public/static/locales/${locale}/page-home.json`)),
        `${locale}/page-home.json should be gone`,
      );
    }
    assert.doesNotMatch(read("lib/i18n/config.ts"), /"page-home"|page-home\.json/);
  });
});

describe("WelcomeStrip", () => {
  const strip = read("components/prediction/WelcomeStrip.tsx");

  it("shows only to signed-out visitors", () => {
    assert.match(strip, /if \(isLoading \|\| isAuthenticated\) return null;/);
  });

  it("states the points-only boundary inline, never in locale files", () => {
    assert.match(strip, /const WELCOME_FINE_LEGAL = "Points only · no cash, no cash-out · 18\+";/);
    assert.match(strip, /\{WELCOME_FINE_LEGAL\}/);
  });

  it("offers sign-up and the explainer", () => {
    assert.match(strip, /href="\/auth\/register"/);
    assert.match(strip, /href="\/about"/);
  });

  it("ships its copy in every locale", () => {
    for (const locale of LOCALES) {
      const dict = JSON.parse(read(`../public/static/locales/${locale}/prediction.json`)) as Record<string, string>;
      for (const key of ["HOME_WELCOME_TITLE", "HOME_WELCOME_BODY", "HOME_WELCOME_CTA", "HOME_WELCOME_HOW", "THIS_WEEK_TITLE", "THIS_WEEK_SUB", "THIS_WEEK_YES_CHIP"]) {
        assert.ok(dict[key], `${locale}: ${key} missing`);
      }
      assert.ok(!("HOME_WELCOME_FINE" in dict), `${locale}: the legal line must stay inline`);
    }
  });
});

describe("ThisWeekRail honesty", () => {
  const rail = read("components/prediction/ThisWeekRail.tsx");

  it("is curated from featured, open events and hides below the threshold", () => {
    assert.match(rail, /export const MIN_RAIL_MOMENTS = 4;/);
    assert.match(rail, /featured: true,\s*status: "open"/);
    assert.match(rail, /if \(moments\.length < MIN_RAIL_MOMENTS\) return null;/);
  });

  it("only shows a moment that has a live open market", () => {
    assert.match(rail, /eventId: event\.id,\s*status: "open"/);
    assert.match(rail, /return lead \? \{ event, lead: localizedMarket\(contentT, lead\) \} : null;/);
  });

  it("uses the event cover, market photo, licensed topic cover, then a tint", () => {
    assert.match(
      rail,
      /moment\.event\.coverImageUrl,\s*moment\.lead\.imagePath,\s*moment\.lead\.imageUrl,\s*moment\.lead\.image_url,\s*topicCover\(moment\.lead\.categorySlug\),/,
    );
    assert.match(rail, /onError=\{\(\) => setImageFailed\(true\)\}/);
    assert.match(rail, /categoryVisual\(moment\.lead\.categorySlug\)/);
    // Covers are self-hosted licensed files, never hotlinked stock.
    assert.doesNotMatch(rail, /unsplash|pexels|placeholder/i);
  });

  it("ships every topic cover it references, with credits", () => {
    const covers = read("components/prediction/topic-covers.ts");
    const paths = [...covers.matchAll(/"(\/images\/covers\/[a-z]+\.jpg)"/g)].map((m) => m[1]);
    assert.ok(paths.length >= 6);
    const credits = read("../public/images/covers/CREDITS.md");
    for (const path of paths) {
      assert.ok(existsSync(resolve(appRoot, `../public${path}`)), `${path} missing`);
      assert.ok(credits.includes(path.split("/").pop() as string), `${path} not credited`);
    }
  });

  it("links each tile to its event and fails quietly", () => {
    assert.match(rail, /href=\{`\/event\/\$\{moment\.event\.id\}`\}/);
    assert.match(rail, /logger\.warn\("ThisWeekRail"/);
  });
});
