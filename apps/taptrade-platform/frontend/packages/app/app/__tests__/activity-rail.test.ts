/**
 * Proof of life (2026-09-27): the board's activity rail shows real fills
 * and 24h movers from GET /api/v1/activity/recent, and disappears entirely
 * when the exchange is quiet.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(appRoot, rel), "utf-8");

describe("activity rail", () => {
  const rail = read("components/prediction/ActivityRail.tsx");
  const client = read("lib/api/activity-client.ts");

  it("reads real activity from the public endpoint and polls it", () => {
    assert.match(client, /"\/api\/v1\/activity\/recent"/);
    assert.match(rail, /refetchInterval: REFRESH_MS/);
  });

  it("renders nothing when there is nothing real to show", () => {
    assert.match(rail, /if \(trades\.length === 0 && movers\.length === 0\) return null;/);
    assert.doesNotMatch(rail, /seeded|synthetic|Math\.random/, "the rail never invents activity");
  });

  it("sits on the default board view only", () => {
    const moments = read("components/prediction/MomentMarketsSection.tsx");
    assert.match(moments, /\{!hasFilters && <ActivityRail \/>\}/);
  });

  it("uses prediction-market vocabulary and ships its strings in every locale", () => {
    assert.doesNotMatch(rail, /\b(bet|bets|wager|odds|stake)\b/i);
    for (const locale of ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"]) {
      const json = read(`../public/static/locales/${locale}/prediction.json`);
      for (const key of ["ACTIVITY_TITLE", "ACTIVITY_MOVERS", "ACTIVITY_RECENT", "ACTIVITY_JUST_NOW", "ACTIVITY_MIN_AGO_one", "ACTIVITY_UP_BY_other"]) {
        assert.ok(json.includes(`"${key}"`), `${locale}/prediction.json should include ${key}`);
      }
    }
  });
});
