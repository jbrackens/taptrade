/**
 * Cover resolver surfaces (2026-09-27): openly licensed covers carry a
 * credit on the market page, a public /attributions page lists them, and
 * the footers link to it — what CC BY asks for.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(appRoot, rel), "utf-8");

describe("photo credits", () => {
  it("carries the credit on the market payload", () => {
    assert.match(read("../../api-client/src/prediction-types.ts"), /imageCredit\?: string;/);
    assert.match(read("../../api-client/src/prediction-client.ts"), /imageCredit: row\.imageCredit,/);
  });

  it("marks a credited image on the market page and links to the credits", () => {
    const head = read("components/prediction/MarketHead.tsx");
    assert.match(head, /displayMarket\.imageCredit && \(/);
    assert.match(head, /href="\/attributions"/);
    assert.match(head, /t\("PHOTO_CREDIT_SHORT", "Photo credit"\)/);
  });

  it("lists credited covers on /attributions from the public endpoint", () => {
    const page = read("attributions/page.tsx");
    assert.match(page, /fetch\("\/api\/v1\/attributions\?limit=500"/);
    assert.match(page, /rel="noopener noreferrer"/, "source links open safely");
    assert.match(page, /href=\{`\/market\/\$\{item\.ticker\}`\}/);
  });

  it("links to the credits from both footers", () => {
    assert.match(read("components/prediction/PredictFooter.tsx"), /href: "\/attributions", label: "Photo credits"/);
    assert.match(read("components/welcome/WelcomeSections.tsx"), /href: "\/attributions", label: t\("LANDING_FOOTER_CREDITS", "Photo credits"\)/);
  });

  it("ships its strings in every prediction locale", () => {
    for (const locale of ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"]) {
      const json = read(`../public/static/locales/${locale}/prediction.json`);
      for (const key of ["PHOTO_CREDIT_SHORT", "LANDING_FOOTER_CREDITS"]) {
        assert.ok(json.includes(`"${key}"`), `${locale}/prediction.json should include ${key}`);
      }
    }
  });
});
