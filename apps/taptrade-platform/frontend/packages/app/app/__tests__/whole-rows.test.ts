/**
 * Whole rows on the board: 12-card blocks fill 4, 3, 2 and 1 columns, so
 * the grid never ends a page on a half-empty row while more markets exist.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ROW_UNIT, wholeRowLimit } from "../components/prediction/whole-rows";

describe("wholeRowLimit", () => {
  it("fills every column count", () => {
    for (const columns of [4, 3, 2, 1]) assert.equal(ROW_UNIT % columns, 0);
  });

  it("shows the target when enough cards are loaded, keeping extras for later", () => {
    assert.equal(wholeRowLimit(20, 12, true), 12);
    assert.equal(wholeRowLimit(20, 12, false), 12);
  });

  it("holds a ragged remainder back while the next page loads", () => {
    // 22 cards loaded, 24 wanted: show the whole first block, not 22.
    assert.equal(wholeRowLimit(22, 24, true), 12);
  });

  it("shows what exists at the end of the list", () => {
    assert.equal(wholeRowLimit(10, 12, false), 10);
    assert.equal(wholeRowLimit(22, 24, false), 22);
  });

  it("never shows an empty grid while the first block is still filling", () => {
    assert.equal(wholeRowLimit(10, 12, true), 10);
  });
});
