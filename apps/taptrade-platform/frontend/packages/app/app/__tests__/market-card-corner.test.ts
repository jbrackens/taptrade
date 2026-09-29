/**
 * Market card corner and caption (2026-09-29 redesign): the corner shows
 * the chance; the caption shows the time left (pink in the last 24 hours)
 * or what the player holds. Card and featured actions are priced in Clout.
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

  it("shows the chance in the corner, and time left or holdings in the caption", () => {
    assert.match(card, /const left = isOpen \? timeLeft\(closeAt\) : null;/);
    assert.match(card, /\{yesPercentage\}%/);
    assert.match(card, /left\?\.urgent \? "text-\[var\(--live-text\)\]"/);
    assert.match(card, /const heldText = held/);
  });

  it("keeps the close status for closed markets and names the event up top", () => {
    assert.match(card, /const footerMeta = held \? heldText : !left \? closingLabel : "";/);
    // The category moved up into the eyebrow (2026-09-27 density pass); a
    // real event's title takes its place there.
    assert.match(card, /const eventEyebrow = eventTitle && !eventSynthetic \? eventTitle\.trim\(\) : "";/);
    assert.match(card, /const eyebrow = eventEyebrow && !repeatsTitle\(eventEyebrow, title\) \? eventEyebrow : categoryLabel \?\? "";/);
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

  it("prices featured actions in Clout and keeps the chance on its rows", () => {
    const featured = read("components/prediction/FeaturedMarket.tsx");
    const landing = read("components/welcome/WelcomeSections.tsx");
    assert.match(featured, /t\("PTS_COUNT", \{ count: price \}\)/);
    assert.match(featured, /\{side === "yes" \? yes : no\}%/);
    assert.match(landing, /\{side === "yes" \? yes : 100 - yes\}%/);
  });
});
