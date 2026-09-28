import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatPointDelta,
  isPositivePointMovement,
  pointLedgerDetailLabel,
  pointLedgerTypeLabel,
} from "../lib/point-ledger";
import { formatPoints } from "../lib/points";

const forbiddenValueTerms = /\b(deposit|withdrawal|cash|fiat|crypto|usd|\$)\b/i;
const pointLedgerSource = readFileSync(
  resolve(__dirname, "../lib/point-ledger.ts"),
  "utf-8",
);
const legacySettlementPhrase = ["prediction", "pay" + "out"].join(" ");

describe("point ledger presentation", () => {
  it("renders wallet movements as points-only labels", () => {
    const movements = [
      { tx: { type: "credit", amount: 25 }, label: "Clout added" },
      { tx: { type: "debit", amount: 6 }, label: "Clout used" },
      { tx: { type: "reservation", amount: 6.5 }, label: "Clout locked" },
      { tx: { type: "release", amount: 6.5 }, label: "Clout unlocked" },
    ];

    for (const { tx, label } of movements) {
      const rendered = pointLedgerTypeLabel(tx);
      assert.equal(rendered, label);
      assert.doesNotMatch(rendered, forbiddenValueTerms);
    }
  });

  it("formats point balances and deltas without currency symbols", () => {
    assert.equal(formatPoints(1250), "1,250 Clout");
    assert.equal(formatPoints(6.5), "6.50 Clout");
    assert.equal(formatPointDelta({ type: "credit", amount: 25 }), "+25 Clout");
    assert.equal(formatPointDelta({ type: "debit", amount: 6 }), "-6 Clout");
    assert.equal(
      formatPointDelta({ type: "reservation", amount: 6.5 }),
      "-6.50 Clout",
    );
    assert.equal(
      formatPointDelta({ type: "release", amount: 6.5 }),
      "+6.50 Clout",
    );
  });

  it("classifies point additions and point usage consistently", () => {
    assert.equal(isPositivePointMovement({ type: "credit", amount: 25 }), true);
    assert.equal(isPositivePointMovement({ type: "debit", amount: 6 }), false);
    assert.equal(
      isPositivePointMovement({ type: "prediction_fill", amount: -4 }),
      false,
    );
  });

  it("does not preserve retired deposit or withdrawal type branches", () => {
    assert.ok(!pointLedgerSource.includes('normalized === "deposit"'));
    assert.ok(!pointLedgerSource.includes('normalized === "withdrawal"'));
  });

  it("does not preserve legacy settlement money-copy as a source literal", () => {
    assert.ok(!pointLedgerSource.includes(legacySettlementPhrase));
  });

  it("renders prediction-order ledger rows as reviewable point movements", () => {
    const rows = [
      {
        tx: {
          type: "reservation",
          amount: 10,
          idempotencyKey: "reservation:prediction_order:ord-1",
          description: "reservation:prediction_order:ord-1",
        },
        label: "Order Clout locked",
        detail: "Prediction order",
        delta: "-10 Clout",
      },
      {
        tx: {
          type: "debit",
          amount: 4,
          idempotencyKey: "prediction_fill:trd-1",
          description: "partial capture prediction_order:ord-1",
        },
        label: "Order filled",
        detail: "Trade fill",
        delta: "-4 Clout",
      },
      {
        tx: {
          type: "credit",
          amount: 4,
          idempotencyKey: "prediction_fill_proceeds:trd-1",
          description: "secondary fill proceeds",
        },
        label: "Order proceeds",
        detail: "Trade proceeds",
        delta: "+4 Clout",
      },
      {
        tx: {
          type: "release",
          amount: 6,
          idempotencyKey: "release:prediction_order:ord-1",
          description: "release:prediction_order:ord-1",
        },
        label: "Order Clout unlocked",
        detail: "Prediction order",
        delta: "+6 Clout",
      },
    ];

    for (const { tx, label, detail, delta } of rows) {
      assert.equal(pointLedgerTypeLabel(tx), label);
      assert.equal(pointLedgerDetailLabel(tx), detail);
      assert.equal(formatPointDelta(tx), delta);
      assert.doesNotMatch(`${label} ${detail} ${delta}`, forbiddenValueTerms);
    }
  });

  it("renders settlement credit rows as settlement point movements", () => {
    const tx = {
      type: "credit",
      amount: 39,
      idempotencyKey: `${legacySettlementPhrase.replace(" ", "_")}:mkt-1:pos-1`,
      description:
        "prediction settlement: market mkt-1 resolved yes, yes position won",
    };

    assert.equal(pointLedgerTypeLabel(tx), "Settlement Clout");
    assert.equal(pointLedgerDetailLabel(tx), "Prediction settlement");
    assert.equal(formatPointDelta(tx), "+39 Clout");
    assert.doesNotMatch(
      `${pointLedgerTypeLabel(tx)} ${pointLedgerDetailLabel(tx)}`,
      forbiddenValueTerms,
    );
  });

  it("keeps legacy settlement fingerprints compatible without rendering unsafe copy", () => {
    const tx = {
      type: "credit",
      amount: 39,
      idempotencyKey: `${legacySettlementPhrase.replace(" ", "_")}:mkt-1:pos-1`,
      description: `${legacySettlementPhrase}: market mkt-1 settled`,
    };

    assert.equal(pointLedgerTypeLabel(tx), "Settlement Clout");
    assert.equal(pointLedgerDetailLabel(tx), "Prediction settlement");
    assert.equal(formatPointDelta(tx), "+39 Clout");
    assert.doesNotMatch(
      `${pointLedgerTypeLabel(tx)} ${pointLedgerDetailLabel(tx)}`,
      forbiddenValueTerms,
    );
  });

  it("renders point-pack ledger rows as point-safe rewards", () => {
    const tx = {
      type: "credit",
      amount: 25,
      idempotencyKey: "point_pack:u-1:starter_boost",
      description: "point_pack_grant",
    };

    assert.equal(pointLedgerTypeLabel(tx), "Clout pack");
    assert.equal(pointLedgerDetailLabel(tx), "Clout pack grant");
    assert.equal(formatPointDelta(tx), "+25 Clout");
    assert.doesNotMatch(
      `${pointLedgerTypeLabel(tx)} ${pointLedgerDetailLabel(tx)}`,
      forbiddenValueTerms,
    );
  });

  it("renders mission reward ledger rows as point-safe rewards", () => {
    const tx = {
      type: "credit",
      amount: 3,
      idempotencyKey: "mission_reward:u-1:daily_check_in:2026-06-23",
      description: "mission_reward",
    };

    assert.equal(pointLedgerTypeLabel(tx), "Mission reward");
    assert.equal(pointLedgerDetailLabel(tx), "Mission reward");
    assert.equal(formatPointDelta(tx), "+3 Clout");
    assert.doesNotMatch(
      `${pointLedgerTypeLabel(tx)} ${pointLedgerDetailLabel(tx)}`,
      forbiddenValueTerms,
    );
  });

  it("renders streak reward ledger rows as point-safe rewards", () => {
    const tx = {
      type: "credit",
      amount: 9,
      idempotencyKey: "streak_reward:u-1:daily_3",
      description: "streak_reward",
    };

    assert.equal(pointLedgerTypeLabel(tx), "Streak reward");
    assert.equal(pointLedgerDetailLabel(tx), "Streak reward");
    assert.equal(formatPointDelta(tx), "+9 Clout");
    assert.doesNotMatch(
      `${pointLedgerTypeLabel(tx)} ${pointLedgerDetailLabel(tx)}`,
      forbiddenValueTerms,
    );
  });
});
