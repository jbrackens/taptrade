/**
 * Market card corner (2026-09-27): the Yes/No actions carry the chance, so
 * the corner shows what the player holds in the market, otherwise the time
 * left — pink in the last 24 hours. Featured markets price their actions
 * the same way.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { timeLeft } from "../components/prediction/market-display";

const appRoot = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(appRoot, rel), "utf-8");

describe("timeLeft", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const at = (ms: number) => new Date(now + ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("uses one unit, largest first", () => {
    assert.deepEqual(timeLeft(at(42 * MIN), now), { value: "42m", urgent: true });
    assert.deepEqual(timeLeft(at(20 * 1000), now), { value: "1m", urgent: true });
    assert.deepEqual(timeLeft(at(6 * HOUR + 30 * MIN), now), { value: "6h", urgent: true });
    assert.deepEqual(timeLeft(at(3 * DAY + 5 * HOUR), now), { value: "3d", urgent: false });
    assert.deepEqual(timeLeft(at(59 * DAY), now), { value: "59d", urgent: false });
    assert.deepEqual(timeLeft(at(150 * DAY), now), { value: "5mo", urgent: false });
    assert.deepEqual(timeLeft(at(771 * DAY), now), { value: "2y", urgent: false });
  });

  it("is urgent only inside the last 24 hours", () => {
    assert.equal(timeLeft(at(DAY - MIN), now)?.urgent, true);
    assert.equal(timeLeft(at(DAY), now)?.urgent, false);
  });

  it("shows nothing once closed or when the date is unreadable", () => {
    assert.equal(timeLeft(at(-MIN), now), null);
    assert.equal(timeLeft(at(0), now), null);
    assert.equal(timeLeft("not a date", now), null);
  });
});

describe("market card corner wiring", () => {
  const card = read("components/prediction/MarketCard.tsx");
  const grid = read("components/prediction/MarketGrid.tsx");
  const hooks = read("lib/query/position-hooks.ts");
  const panel = read("components/prediction/QuickTradePanel.tsx");

  it("prefers the player's holding, then time left, and hides for closed markets", () => {
    assert.match(card, /const left = isOpen \? timeLeft\(closeAt\) : null;/);
    assert.match(card, /const corner = held\s*\?/);
    assert.match(card, /left\.urgent \? "text-\[var\(--live-text\)\]"/);
    assert.match(card, /\{corner && \(/);
  });

  it("moves the close date out of the footer only while the corner shows it", () => {
    assert.match(card, /\[categoryLabel, held \|\| !left \? closingLabel : null\]/);
  });

  it("loads holdings once per grid, only for signed-in players", () => {
    assert.match(grid, /const held = useHeldPositions\(\);/);
    assert.match(grid, /held=\{held\.get\(localized\.id\)\}/);
    assert.match(hooks, /enabled: isAuthenticated/);
    assert.match(hooks, /p\.quantity > 0/);
  });

  it("refreshes holdings when a quick trade closes", () => {
    assert.match(panel, /invalidateQueries\(\{ queryKey: positionQueryKeys\.all \}\)/);
  });

  it("prices featured actions as chance, not points", () => {
    const featured = read("components/prediction/FeaturedMarket.tsx");
    const landing = read("components/welcome/WelcomeSections.tsx");
    assert.match(featured, /\{side === "yes" \? yes : no\}%/);
    assert.match(landing, /\{side === "yes" \? yes : 100 - yes\}%/);
  });
});
