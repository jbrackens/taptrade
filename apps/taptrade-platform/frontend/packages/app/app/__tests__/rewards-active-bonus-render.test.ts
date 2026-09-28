import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import type { ReactTestRendererJSON } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { ActiveBonusesControl } from "../rewards/ActiveBonusesControl";
import type { PlayerBonus } from "../lib/api/bonus-client";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function collectText(
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null,
): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(collectText).join("");
  return collectText(node.children ?? null);
}

function collectNodes(
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null,
  type: string,
): ReactTestRendererJSON[] {
  if (!node || typeof node === "string") return [];
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectNodes(child, type));
  }
  const current = node.type === type ? [node] : [];
  return current.concat(collectNodes(node.children ?? null, type));
}

describe("ActiveBonusesControl", () => {
  it("renders active bonus progress with point-play fields", () => {
    const bonus: PlayerBonus = {
      bonusId: 308,
      campaignName: "Demo Point-Play Bonus",
      bonusType: "custom",
      status: "active",
      unit: "PTS",
      grantedPoints: 20_000,
      remainingPoints: 15_000,
      playRequiredPoints: 100_000,
      playCompletedPoints: 25_000,
      playProgressPct: 25,
      expiresAt: "2099-06-28T00:00:00Z",
      grantedAt: "2026-06-28T00:00:00Z",
    };

    let tree: ReturnType<typeof create> | null = null;
    act(() => {
      tree = create(
        React.createElement(ActiveBonusesControl, { bonuses: [bonus] }),
      );
    });

    const json = tree?.toJSON() ?? null;
    const text = collectText(json);
    assert.match(text, /Active Clout bonuses/);
    assert.match(text, /Demo Point-Play Bonus/);
    // Whole-Points unit model: remainingPoints 15_000 renders as 15,000 —
    // the retired ÷100 display showed "150" for the same wire value.
    assert.match(text, /15,000/);
    assert.match(text, /Clout remaining/);
    assert.doesNotMatch(text, /wager|stake|cash|deposit|withdraw|fiat|crypto/i);

    const progress = collectNodes(json, "progress")[0];
    assert.ok(progress, "expected play-progress bar to render");
    assert.equal(progress.props["aria-label"], "Play progress");
    assert.equal(progress.props.value, 25);
    assert.equal(progress.props.max, 100);
  });

  it("does not render an empty active-bonus shell", () => {
    let tree: ReturnType<typeof create> | null = null;
    act(() => {
      tree = create(React.createElement(ActiveBonusesControl, { bonuses: [] }));
    });
    assert.equal(tree?.toJSON(), null);
  });
});
