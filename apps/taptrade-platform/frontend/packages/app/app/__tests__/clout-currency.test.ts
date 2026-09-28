/**
 * Clout — the play currency's name (2026-09-28: "pts" read as unfinished).
 * Amounts read "4,400 Clout"; share prices keep the 0–100 scale (a share
 * costs 1–99 Clout and settles at 100, like 1¢–99¢ paying $1); loyalty
 * progress is XP, a separate thing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CURRENCY_NAME, formatCompactPoints, formatPoints } from "../lib/points";

const appRoot = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(appRoot, rel), "utf-8");
const localeRoot = resolve(appRoot, "../public/static/locales");
const LOCALES = ["en", "zh-Hans", "zh-Hant", "tl", "ms", "id"];

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

describe("Clout", () => {
  it("names the currency in every formatted amount", () => {
    assert.equal(CURRENCY_NAME, "Clout");
    assert.equal(formatPoints(4400), "4,400 Clout");
    assert.equal(formatCompactPoints(1_500_742), "1.5M Clout");
  });

  it("shows the header balance as a flame and a compact figure, no BAL or pts", () => {
    const topBar = read("components/prediction/TopBar.tsx");
    assert.match(topBar, /<Flame size=\{16\} weight="fill" \/>/);
    assert.match(topBar, /<PointsFlow value=\{balance\} compact=\{balance >= 100_000\} \/>/);
    assert.ok(!topBar.includes('t("BALANCE_LABEL")'), "no BAL label");
    assert.ok(!/&nbsp;pts/.test(topBar), "no pts suffix");
  });

  it("calls loyalty progress XP, never Clout", () => {
    assert.match(read("components/prediction/TierPill.tsx"), /\{formatPoints\(points\)\} XP/);
    for (const locale of LOCALES) {
      const rewards = JSON.parse(readFileSync(resolve(localeRoot, locale, "rewards.json"), "utf-8"));
      assert.equal(rewards.pointsShort, "XP", `${locale}: rewards.pointsShort`);
    }
  });

  it("leaves no 'pts' in any locale string", () => {
    const offenders: string[] = [];
    for (const locale of LOCALES) {
      for (const file of readdirSync(resolve(localeRoot, locale)).filter((f) => f.endsWith(".json"))) {
        const json = JSON.parse(readFileSync(resolve(localeRoot, locale, file), "utf-8"));
        for (const s of strings(json)) {
          if (/(?<![A-Za-z])(pts|PTS)(?![A-Za-z])/.test(s)) offenders.push(`${locale}/${file}: ${s}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });
});
