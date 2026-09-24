/**
 * Ink & lime step 9 — the last two §3 items, both in TradeTicket.tsx.
 *
 * Source-level assertions (repo convention — node:test, no DOM harness):
 *  - §3-03 quote freeze: the CTA total HOLDS the last settled quote while
 *    the 250ms debounced preview is in flight, and the CTA waits — a
 *    number that moves between reading it and pressing it is the defect
 *  - §3-06 settled payout band (Settlement 12a/12b/12e): the viewer's own
 *    position and settlement render in the ticket; win and loss get the
 *    SAME layout; voided is neutral throughout — no green, no red, a dash
 *    where the settlement price would be, and the result stated as 0
 *  - the §4 settlement copy family ships in all six locales
 *  - the signed-out CTA invites sign-up (SIGNUP_TO_TRADE), with log-in as
 *    the note underneath
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(resolve(appRoot, rel), "utf-8");
}

const ticket = read("components/prediction/TradeTicket.tsx");
const marketPage = read("market/[ticker]/page.tsx");

const SHIPPED_LOCALES = ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"];
const SETTLEMENT_KEYS = [
  "SETTLED_SHEET_LABEL",
  "EST_PROCEEDS",
  "YOUR_POSITION",
  "SETTLED_AT",
  "SETTLED_AT_PER_SHARE",
  "HOW_THIS_PAID",
  "SETTLEMENT_VERDICT_WON",
  "SETTLEMENT_VERDICT_LOST",
  "SETTLEMENT_VERDICT_VOID",
  "SETTLEMENT_RESULT_LINE",
  "VOID_RESULT_LINE",
  "ROW_PAID",
  "ROW_RETURNED",
  "ROW_STAKED",
  "ROW_RESULT",
  "MARKET_VOIDED_EXPLAINER",
  "RESOLUTION_PROPOSED",
  "RESOLUTION_PROPOSED_BODY",
  "DISPUTED_BODY",
  "DISPUTE_GROUNDS",
  "SIGNUP_TO_TRADE",
];

describe("§3-03 quote freeze", () => {
  it("holds the last settled quote while the preview is unsettled", () => {
    assert.match(ticket, /const quotePending = previewLoading/);
    assert.match(ticket, /lastSettledQuoteRef/);
    assert.match(
      ticket,
      /const frozenQuote = quotePending \? lastSettledQuoteRef\.current : null/,
    );
    assert.match(ticket, /<PointsFlow value=\{displaySpend\} suffix=" pts" \/>/);
    assert.match(
      ticket,
      /<PointsFlow value=\{displayPointsIfCorrect\} suffix=" pts" \/>/,
    );
  });

  it("no longer swaps the price to loading text — the figure holds", () => {
    assert.ok(!ticket.includes('previewLoading ? t("LOADING")'));
    assert.match(ticket, /\{displayPrice\} pts/);
    assert.doesNotMatch(ticket, /¢/);
  });

  it("makes the CTA wait for the quote to settle, twice over", () => {
    assert.match(
      ticket,
      /disabled=\{submitting \|\| quantity < 1 \|\| quotePending\}/,
    );
    assert.match(ticket, /if \(quotePending\) return;/);
  });

  it("refreshes the hold-submit callback when quote state settles", () => {
    const submitBlock = ticket.slice(
      ticket.indexOf("const handleSubmit"),
      ticket.indexOf("// Press-and-hold"),
    );
    assert.match(submitBlock, /\n\s*quotePending,\n/);
  });

  it("signals the in-flight quote with the pending tokens", () => {
    assert.match(
      ticket,
      /border-\[var\(--pending-border\)\] bg-\[var\(--pending-fill\)\]/,
    );
    assert.match(ticket, /aria-busy=\{quotePending\}/);
  });

  it("keeps the safety gates on LIVE values, not the frozen display", () => {
    assert.match(ticket, /\(effectiveSpend > balance \|\| requestedNotional > balance\)/);
  });
});

describe("§3-06 settled payout band (Settlement 12a/12b/12e)", () => {
  const band = ticket.slice(
    ticket.indexOf("function SettlementBand"),
    ticket.indexOf("function renderSettledTicket"),
  );

  it("gives the win and the loss the same layout — one component", () => {
    assert.equal(
      (ticket.match(/function SettlementBand/g) ?? []).length,
      1,
    );
    assert.match(band, /SETTLEMENT_VERDICT_WON/);
    assert.match(band, /SETTLEMENT_VERDICT_LOST/);
  });

  it("holds voided neutral: no direction colour, a dash, result stated as 0", () => {
    assert.match(
      band,
      /voided\s*\?\s*"text-\[var\(--t3\)\]"/,
      "voided verdict/mark is neutral ink-3",
    );
    assert.match(
      band,
      /voided\s*\?\s*"bg-\[var\(--surface-2\)\]"/,
      "voided hero is the raised neutral, not a direction tint",
    );
    assert.match(band, /voided \? "—"/, "dash where the settle price would be");
    assert.match(band, /voided \? "0 pts"/, "result stated as 0, never blank");
    assert.match(band, /ROW_RETURNED.*: t\("ROW_PAID"\)/s);
  });

  it("shows the working under the payout — the How-this-paid rows", () => {
    for (const key of [
      "YOUR_POSITION",
      "SETTLED_AT",
      "ROW_STAKED",
      "ROW_RESULT",
      "HOW_THIS_PAID",
    ]) {
      assert.ok(band.includes(`t("${key}")`), `${key} row present`);
    }
  });

  it("keeps glyph geometry from the reference, not reconstructed", () => {
    assert.ok(band.includes('d="M20 6 9 17l-5-5"'), "check glyph");
    assert.ok(band.includes('d="M5 12h14"'), "minus glyph");
  });

  it("hydrates the viewer's outcome on the market page", () => {
    assert.match(marketPage, /api\.getSettledPositions\(1, 50\)/);
    assert.match(
      marketPage,
      /stakedPoints: r\.settlementPoints - r\.realizedPoints/,
      "staked derives from the authoritative disbursement row",
    );
    assert.match(
      marketPage,
      /marketStatus === "voided"[\s\S]{0,400}paidPoints: p\.totalCostPoints[\s\S]{0,100}resultPoints: 0/,
      "a void refunds at cost: returned = staked, result = 0",
    );
    assert.match(marketPage, /settlements=\{ticketSettlements\}/);
  });

  it("labels the sell total as proceeds, not cost", () => {
    // §4 EST_PROCEEDS: selling brings points back — the row's value was
    // already the proceeds estimate; only the label lied.
    assert.match(
      ticket,
      /t\(action === "sell" \? "EST_PROCEEDS" : "EST_COST"\)/,
    );
  });

  it("relabels the mobile sheet button on markets that can't be traded", () => {
    // §4 SETTLED_SHEET_LABEL: "Trade market" was dishonest on a settled
    // market — the sheet behind the button holds the payout band. Settled
    // shows the FINAL rail price, voided shows no price at all.
    assert.match(
      marketPage,
      /isSettledMarket \|\| market\.status === "voided"[\s\S]{0,120}SETTLED_SHEET_LABEL/,
    );
    assert.match(
      marketPage,
      /selectedSide === "yes" \? railYes : railNo/,
      "the sheet button quotes the final price, not the stale snapshot",
    );
    assert.match(marketPage, /market\.status !== "voided" && \(/);
  });

  it("renders dispute grounds only when the gateway supplies them", () => {
    assert.match(
      ticket,
      /settlementParams\?\.disputeGrounds === "string"/,
    );
    assert.match(ticket, /RESOLUTION_PROPOSED_BODY/);
    assert.match(ticket, /DISPUTED_BODY/);
  });
});

describe("signed-out ticket CTA (step 9)", () => {
  it("invites sign-up, with log-in as the note underneath", () => {
    assert.match(ticket, /\{t\("SIGNUP_TO_TRADE"\)\}/);
    assert.match(ticket, /render=\{<Link href=\{registerHref\} \/>\}/);
    assert.ok(
      !ticket.includes('t("LOG_IN_TO_TRADE")'),
      "the contradicting signed-out CTA copy is retired",
    );
    assert.match(
      ticket,
      /href=\{loginHref\}[\s\S]{0,200}SIGN_IN_TO_PLACE_ORDER/,
      "returning users keep a log-in path",
    );
  });
});

describe("§4 settlement copy family (step 9)", () => {
  it("ships every key in every locale", () => {
    for (const locale of SHIPPED_LOCALES) {
      const strings = JSON.parse(
        readFileSync(
          resolve(
            appRoot,
            "../public/static/locales",
            locale,
            "prediction.json",
          ),
          "utf-8",
        ),
      ) as Record<string, string>;
      for (const key of SETTLEMENT_KEYS) {
        assert.ok(strings[key], `${locale}: ${key} missing`);
      }
    }
  });
});
