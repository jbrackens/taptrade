import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const userClientPath = resolve(__dirname, "../lib/api/user-client.ts");
const notificationsPath = resolve(
  __dirname,
  "../account/notifications/page.tsx",
);
// /profile was retired into /account/settings (it redirects there).
const profilePath = resolve(__dirname, "../account/settings/page.tsx");

const userClientSource = readFileSync(userClientPath, "utf-8");
const notificationsSource = readFileSync(notificationsPath, "utf-8");
const profileSource = readFileSync(profilePath, "utf-8");
const localeRoot = resolve(__dirname, "../../public/static/locales");

function sliceBetween(source: string, startToken: string, endToken: string) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(start, -1, `missing start token ${startToken}`);
  assert.notEqual(end, -1, `missing end token ${endToken}`);
  return source.slice(start, end);
}

describe("user-client preferences contract", () => {
  it("does not export currency preferences from the launch user client", () => {
    const updateRequest = sliceBetween(
      userClientSource,
      "export interface UpdatePreferencesRequest",
      "// Response types",
    );
    const preferencesType = sliceBetween(
      userClientSource,
      "export interface Preferences",
      "export interface DeleteAccountResponse",
    );

    assert.ok(
      !updateRequest.includes("currency") &&
        !preferencesType.includes("currency"),
      "preference request/response exports should not carry currency",
    );
    assert.ok(
      userClientSource.includes("function normalizePreferences") &&
        userClientSource.includes("currency?: string"),
      "legacy raw currency may exist only as private input ignored by normalization",
    );
  });

  it("preference call sites only save communication or local app preferences", () => {
    assert.ok(
      notificationsSource.includes("await updatePreferences(user.id, prefs)") &&
        !notificationsSource.includes("currency"),
      "notification preferences should not submit currency",
    );
    assert.ok(
      profileSource.includes("persistLocale(locale)") &&
        profileSource.includes('TIMEZONE_KEY = "taptrade_timezone"') &&
        profileSource.includes("localStorage.setItem(TIMEZONE_KEY") &&
        !profileSource.includes("currency"),
      "profile preferences should remain local language/timezone settings without currency",
    );
  });

  it("keeps notification preferences inside prediction point-play language", () => {
    assert.ok(
      notificationsSource.includes("market_results") &&
        notificationsSource.includes("price_alerts") &&
        notificationsSource.includes("Point bonus updates") &&
        notificationsSource.includes("Market Updates"),
      "notification preferences should use point-native market category names",
    );
    for (const retired of [
      "bet_results",
      "odds_alerts",
      "sports or leagues",
      "Subscription Updates",
      "billing notifications",
      "Special offers",
    ]) {
      assert.ok(
        !notificationsSource.includes(retired),
        `notification preferences should not expose retired copy: ${retired}`,
      );
    }
  });

  it("keeps shipped communication-settings locale values point-native", () => {
    for (const lang of ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"]) {
      const localePath = resolve(
        localeRoot,
        lang,
        "communication-settings.json",
      );
      const values = Object.values(
        JSON.parse(readFileSync(localePath, "utf-8")) as Record<string, string>,
      ).join("\n");

      assert.ok(
        values.includes("Prediction Activity") &&
          values.includes("Markets Resolved") &&
          values.includes("Market Updates") &&
          values.includes("Point Bonus Updates"),
        `${lang} communication-settings should expose point-native values`,
      );
      for (const retired of [
        "Subscription Updates",
        "Betting",
        "Matches Resolved",
        "made bets",
      ]) {
        assert.ok(
          !values.includes(retired),
          `${lang} communication-settings should not ship retired copy: ${retired}`,
        );
      }
    }
  });
});
