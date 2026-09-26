/**
 * The landing page at "/" (2026-09-24 redesign; moved from /welcome on
 * 2026-09-26, which now redirects). The market board lives at /predict. These pins keep it honest
 * (live data only, sections hide without data), points-only (money-word
 * legal lines inline, locale copy free of cash/gambling vocabulary) and on
 * the licensed photos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(appRoot, rel), "utf-8");
const LOCALES = ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"];

const page = read("components/welcome/WelcomePage.tsx");
const layout = read("page.tsx");
const sections = read("components/welcome/WelcomeSections.tsx");
const shell = read("components/AppShell.tsx");

describe("landing route", () => {
  it("renders full-bleed at / with its own header and footer", () => {
    assert.match(shell, /const isMarketingRoute = pathname === "\/";/);
    assert.match(shell, /isMarketingRoute \? \(\s*children/);
    assert.match(page, /<WelcomeHeader \/>/);
    assert.match(page, /<WelcomeFooter \/>/);
  });

  it("ships share metadata for ads and social", () => {
    assert.match(layout, /title: "Tap Trade — Call it before it happens"/);
    assert.match(layout, /openGraph:/);
  });

  it("lets its title replace the root one instead of adding a second <title>", () => {
    const root = read("layout.tsx");
    assert.match(root, /export const metadata: Metadata = \{\s*title: brand\.name,/);
    assert.doesNotMatch(root, /<title>/, "no inline <title> in the root layout");
    assert.doesNotMatch(root, /<meta\s+name="description"/, "no inline description either");
  });

  it("is where the board's How it works link lands", () => {
    assert.match(sections, /id="how-it-works"/);
    assert.match(read("components/prediction/WelcomeStrip.tsx"), /href="\/#how-it-works"/);
  });

  it("keeps old /welcome links working and sends Markets links to the board", () => {
    const config = readFileSync(resolve(appRoot, "../next.config.js"), "utf-8");
    assert.match(config, /\{ source: "\/welcome", destination: "\/", permanent: false \}/);
    assert.equal((sections.match(/href="\/"/g) ?? []).length, 1, "only the landing logo links to /");
    assert.ok((sections.match(/"\/predict"/g) ?? []).length >= 4, "markets links go to /predict");
  });
});

describe("landing honesty", () => {
  it("uses live data: contested hero, contested trending, real counts", () => {
    assert.match(page, /getMarkets\(\{ status: "open", sort: "activity", pageSize: 18 \}\)/);
    assert.match(page, /pickFeatured\(markets\)/);
    assert.match(page, /m\.yesPricePoints >= 10 && m\.yesPricePoints <= 90/);
    assert.match(page, /getMarkets\(\{ categoryId: category\.id, status: "open", pageSize: 1 \}\)/);
  });

  it("hides sections that have no data", () => {
    assert.match(sections, /if \(tiles\.length === 0\) return null;/);
    assert.match(sections, /tile\.category && tile\.count > 0/);
    assert.match(sections, /if \(markets\.length === 0\) return null;/);
    assert.match(sections, /\{market && \(/, "no hero card without a live market");
  });

  it("labels the hero card accurately", () => {
    assert.match(sections, /t\("LANDING_LIVE_LABEL", "Trending now"\)/);
    assert.doesNotMatch(sections, /Most traded right now/);
  });
});

describe("landing points-only copy", () => {
  it("keeps money-word legal lines inline, never in locale files", () => {
    assert.match(sections, /export const HERO_FINE_LEGAL = "Points only · no cash, no cash-out · 18\+";/);
    assert.match(sections, /export const FOOTER_LEGAL =/);
  });

  it("ships every landing string in all six locales, free of cash/gambling words", () => {
    const used = [...new Set([...sections.matchAll(/t\("(LANDING_[A-Z0-9_]+)"/g)].map((m) => m[1]))];
    assert.ok(used.length > 30);
    const unsafe =
      /\b(?:deposit|withdrawals?|cash(?:ier|out)?|casino|crypto|fiat|bets?|betting|odds|sportsbook|wagers?|wagering|stakes?|payouts?|payments?|usd|dollars?|prizes?|redeem)\b|\$|tunai|kripto|pembayaran|bayaran|现金|現金|提款|支付|赔付|賠付|奖金|獎金|投注|下注|赌|賭/i;
    for (const locale of LOCALES) {
      const dict = JSON.parse(read(`../public/static/locales/${locale}/prediction.json`)) as Record<string, string>;
      for (const key of used) {
        const value = dict[key] ?? dict[`${key}_other`];
        assert.ok(value, `${locale}: ${key} missing`);
        assert.doesNotMatch(value, unsafe, `${locale}: ${key} carries money/gambling wording`);
      }
    }
  });
});

describe("landing imagery", () => {
  it("uses only the licensed, self-hosted topic covers", () => {
    const srcs = [...sections.matchAll(/src="(\/images\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(srcs.length >= 3);
    assert.match(sections, /src=\{cover\}/, "topic tiles use topicCover()");
    assert.doesNotMatch(sections, /<img\b/, "photos go through next/image");
    for (const src of srcs) {
      assert.match(src, /^\/images\/covers\/[a-z]+\.jpg$/);
      assert.ok(existsSync(resolve(appRoot, `../public${src}`)), `${src} missing`);
    }
    assert.doesNotMatch(sections, /unsplash\.com|pexels\.com/);
  });
});
