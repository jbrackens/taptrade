/**
 * Event cards (2026-09-27): markets that share a real upstream event fold
 * into one card on the board, so a game is one card with its moneyline,
 * spread and total inside rather than three lookalike cards.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { groupIntoEventCards, marketLabelInEvent } from "../components/prediction/event-groups";

const appRoot = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(appRoot, rel), "utf-8");

function market(id: string, eventId: string, title: string, extra: Partial<PredictionMarket> = {}): PredictionMarket {
  return {
    id,
    eventId,
    eventTitle: extra.eventTitle,
    ticker: `T-${id}`,
    title,
    status: "open",
    yesPricePoints: 50,
    noPricePoints: 50,
    volumePoints: 0,
    openInterestPoints: 0,
    liquidityPoints: 0,
    closeAt: "2026-10-01T00:00:00Z",
    ...extra,
  } as PredictionMarket;
}

describe("groupIntoEventCards", () => {
  it("folds markets of one real event into a card at the first one's position", () => {
    const items = groupIntoEventCards([
      market("a", "ev-game", "Chiefs vs. Dolphins", { eventTitle: "Chiefs vs. Dolphins" }),
      market("b", "ev-other", "Will it rain?"),
      market("c", "ev-game", "Spread: Chiefs (-10.5)", { eventTitle: "Chiefs vs. Dolphins" }),
      market("d", "ev-game", "Chiefs vs. Dolphins: O/U 48.5", { eventTitle: "Chiefs vs. Dolphins" }),
    ]);
    assert.deepEqual(
      items.map((i) => (i.kind === "event" ? `event:${i.eventId}:${i.markets.length}` : `market:${i.market.id}`)),
      ["event:ev-game:3", "market:b"],
    );
    assert.equal(items[0].kind === "event" && items[0].title, "Chiefs vs. Dolphins");
  });

  it("never groups markets parked in a catch-all event, and never a lone market of a one-market event", () => {
    const items = groupIntoEventCards([
      market("a", "ev-desk", "Will BTC hit 100k?", { eventSynthetic: true, eventTitle: "Crypto & Chains" }),
      market("b", "ev-desk", "Will ETH flip BTC?", { eventSynthetic: true, eventTitle: "Crypto & Chains" }),
      market("c", "ev-solo", "Will Norway win?", { eventTitle: "Norway vs. Portugal", eventOpenMarkets: 1 }),
    ]);
    assert.deepEqual(items.map((i) => i.kind), ["market", "market", "market"]);
  });

  it("makes an event card from a lone market whose event has more open markets", () => {
    const items = groupIntoEventCards([
      market("a", "ev-game", "Spread: Chiefs (-10.5)", { eventTitle: "Chiefs vs. Dolphins", eventOpenMarkets: 4 }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, "event");
    assert.equal(items[0].kind === "event" && items[0].openMarkets, 4);
    assert.match(read("components/prediction/EventCard.tsx"), /enabled: listed\.length < Math\.min\(openMarkets, EVENT_ROW_POOL\)/);
  });

  it("labels markets inside their event without repeating the event title", () => {
    assert.equal(marketLabelInEvent("Chiefs vs. Dolphins: O/U 48.5", "Chiefs vs. Dolphins", "Match winner"), "O/U 48.5");
    assert.equal(marketLabelInEvent("Chiefs vs. Dolphins", "Chiefs vs. Dolphins", "Match winner"), "Match winner");
    assert.equal(marketLabelInEvent("Spread: Chiefs (-10.5)", "Chiefs vs. Dolphins", "Match winner"), "Spread: Chiefs (-10.5)");
    assert.equal(marketLabelInEvent("Will Cardinal A be Pope?", "", "Match winner"), "Will Cardinal A be Pope?");
  });
});

describe("event cards on the board", () => {
  const grid = read("components/prediction/MarketGrid.tsx");
  const card = read("components/prediction/EventCard.tsx");

  it("renders an EventCard for grouped items when the grid groups events", () => {
    assert.match(grid, /groupEvents\s*\?\s*groupIntoEventCards\(localizedMarkets\)/);
    assert.match(grid, /<EventCard[\s\S]*onQuickTrade=\{\(market, side\) => openQuickTrade\(\{ market, side \}\)\}/);
  });

  it("is used by the board, moments, topic and series grids", () => {
    for (const rel of [
      "components/prediction/AllMarketsSection.tsx",
      "components/prediction/MomentMarketsSection.tsx",
      "category/[slug]/page.tsx",
      "series/[slug]/page.tsx",
    ]) {
      assert.match(read(rel), /<MarketGrid[\s\S]*groupEvents/, `${rel} should group events`);
    }
  });

  it("shows up to three market rows with Yes/No chances and links to the event", () => {
    assert.match(card, /pickEventRows\(markets, EVENT_CARD_ROWS\)/);
    assert.match(card, /href=\{`\/event\/\$\{eventId\}`\}/);
    assert.match(card, /\{pct\}%/);
    assert.match(card, /aria-haspopup="dialog"/);
  });

  it("ships its strings in every prediction locale, points-only", () => {
    for (const locale of ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"]) {
      const json = read(`../public/static/locales/${locale}/prediction.json`);
      for (const key of ["EVENT_MATCH_WINNER", "EVENT_MORE_MARKETS_one", "EVENT_MORE_MARKETS_other"]) {
        assert.ok(json.includes(`"${key}"`), `${locale}/prediction.json should include ${key}`);
      }
    }
    assert.doesNotMatch(card, /\b(cash|bet|odds|wager)\b/i);
  });
});

describe("event card fixes (2026-09-28)", () => {
  it("hides an eyebrow that only repeats the title", async () => {
    const { repeatsTitle } = await import("../components/prediction/event-groups");
    assert.equal(repeatsTitle("New York Mets vs. Washington Nationals", "New York Mets vs. Washington Nationals"), true);
    assert.equal(repeatsTitle("LoL: KT Rolster Challengers vs Galions (BO5)", "LoL: KT Rolster Challengers vs Galions (BO5) - World Star Challengers"), true);
    assert.equal(repeatsTitle("Los Angeles Mayoral Election", "Will Nithya Raman win the 2026 Los Angeles mayoral election?"), false);
    assert.equal(repeatsTitle("Balance of Power: 2026 Midterms", "2026 Balance of Power: D Senate, D House"), false);
    assert.match(read("components/prediction/MarketCard.tsx"), /!repeatsTitle\(eventEyebrow, title\)/);
  });

  it("labels rows by the source's short label, else by what the questions do not share", async () => {
    const { eventRowLabels } = await import("../components/prediction/event-groups");
    assert.deepEqual(
      eventRowLabels(
        [
          { title: "US x Iran ceasefire continues through October 31?" },
          { title: "US x Iran ceasefire continues through November 30?" },
        ],
        "US-Iran ceasefire continues through...?",
        "Match winner",
      ),
      ["October 31?", "November 30?"],
    );
    assert.deepEqual(
      eventRowLabels(
        [
          { title: "Will the Fed increase interest rates by 25 bps after the October 2026 meeting?", outcomeLabel: "25 bps increase" },
          { title: "Will there be no change in Fed interest rates after the October 2026 meeting?", outcomeLabel: "No change" },
        ],
        "Fed Decision in October?",
        "Match winner",
      ),
      ["25 bps increase", "No change"],
    );
    assert.deepEqual(eventRowLabels([{ title: "Chiefs vs. Dolphins" }], "Chiefs vs. Dolphins", "Match winner"), ["Match winner"]);
    // A shared "Will" comes off before a name, but not before "there be…".
    assert.deepEqual(
      eventRowLabels(
        [
          { title: "Will Jack Lowden be announced as the next James Bond?" },
          { title: "Will Richard Madden be announced as the next James Bond?" },
        ],
        "Next James Bond film: Actor cast as James Bond",
        "Match winner",
      ),
      ["Jack Lowden", "Richard Madden"],
    );
    assert.deepEqual(
      eventRowLabels(
        [
          { title: "Will the Fed increase interest rates by 25 bps after the October 2026 meeting?" },
          { title: "Will there be no change in Fed interest rates after the October 2026 meeting?" },
        ],
        "Fed Decision in October?",
        "Match winner",
      ),
      ["Will the Fed increase interest rates by 25 bps", "Will there be no change in Fed interest rates"],
    );
  });

  it("shows the likeliest lively outcomes, never a near-settled one while others remain", async () => {
    const { pickEventRows } = await import("../components/prediction/event-groups");
    const rows = pickEventRows(
      [{ yesPricePoints: 1 }, { yesPricePoints: 35 }, { yesPricePoints: 65 }, { yesPricePoints: 99 }],
      3,
    );
    assert.deepEqual(rows.map((r) => r.yesPricePoints), [65, 35]);
    assert.deepEqual(pickEventRows([{ yesPricePoints: 1 }, { yesPricePoints: 99 }], 3).map((r) => r.yesPricePoints), [99, 1]);
    const card = read("components/prediction/EventCard.tsx");
    assert.match(card, /pickEventRows\(markets, EVENT_CARD_ROWS\)/);
    assert.match(card, /pageSize: EVENT_ROW_POOL/);
  });
});
