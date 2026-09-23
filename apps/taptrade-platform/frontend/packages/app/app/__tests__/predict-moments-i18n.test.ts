import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const appRoot = resolve(__dirname, "..");
const LOCALES = ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"] as const;

// Keep the copy introduced by the Predict moments workspace present in every
// public bundle. i18next otherwise renders the English fallback for a locale
// that has no matching key, which is easy to miss in the default English UI.
const PREDICT_MOMENT_KEYS = [
  "WORKSPACE_START_GUIDE",
  "WORKSPACE_MOMENTS_TITLE",
  "WORKSPACE_EXPLORE_TOPICS",
  "WORKSPACE_GUIDE_NOTICE",
  "WORKSPACE_ALL_MOMENTS",
  "WORKSPACE_MOMENTS_RAIL_LINE_ONE",
  "WORKSPACE_MOMENTS_RAIL_LINE_TWO",
  "WORKSPACE_MOMENTS_RAIL_COPY",
  "WORKSPACE_EXPLORE_TOPICS_LABEL",
  "TRENDING_MARKETS",
  "MARKETS",
  "MARKET_IMPLIED_ACTIVITY",
  "HAPPENING_NOW_DESCRIPTION",
  "VIEW_ALL_MOMENTS",
  "SEARCH_MARKETS_PLACEHOLDER",
  "SORT_ACTIVITY",
  "SORT_CLOSING_SOON",
  "SORT_NEWEST",
  "FILTER_BY_CLOSING_WINDOW",
  "NO_FILTER_MATCH",
  "COULD_NOT_LOAD_MORE_MARKETS",
  "MARKET_CARD_EVENLY_SPLIT",
  "MARKET_CARD_STRONG_YES_LEAN",
  "MARKET_CARD_YES_LEAN",
  "MARKET_CARD_STRONG_NO_LEAN",
  "MARKET_CARD_NO_LEAN",
  "MARKET",
  "TRENDING",
  "PARTICIPANT_VIEW",
  "ACTIVITY",
] as const;

describe("Predict moments localization", () => {
  it("ships every new Predict string in every public prediction locale", () => {
    for (const locale of LOCALES) {
      const dictionary = JSON.parse(
        readFileSync(
          resolve(
            appRoot,
            "../public/static/locales",
            locale,
            "prediction.json",
          ),
          "utf8",
        ),
      ) as Record<string, unknown>;

      for (const key of PREDICT_MOMENT_KEYS) {
        assert.equal(
          typeof dictionary[key],
          "string",
          `${locale}/prediction.json must include ${key}`,
        );
        assert.ok(
          (dictionary[key] as string).trim().length > 0,
          `${locale}/prediction.json must give ${key} a non-empty value`,
        );
      }
    }
  });
});
