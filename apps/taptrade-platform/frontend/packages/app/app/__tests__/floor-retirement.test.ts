import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { isPredictionTerminalRoute } from "../lib/prediction-terminal";

// The 2026-08 Floor redesign trial (/floor, /book, /standing) was retired
// in favour of /predict + /market/[ticker]. Its Event page and Inspector
// stay; its core idea — trade without leaving the list — moved into the
// market grid as the quick-trade panel.

const appRoot = resolve(__dirname, "..");
const packageRoot = resolve(appRoot, "..");
const read = (path: string) => readFileSync(resolve(appRoot, path), "utf8");

describe("Floor retirement", () => {
  it("removes the Floor, My Book and Standing routes and their shell", () => {
    for (const path of [
      "floor/page.tsx",
      "book/page.tsx",
      "standing/page.tsx",
      "components/floor",
    ]) {
      assert.equal(existsSync(resolve(appRoot, path)), false, `${path} should be gone`);
    }
    for (const pathname of ["/floor", "/book", "/standing"]) {
      assert.equal(isPredictionTerminalRoute(pathname), false, pathname);
    }
  });

  it("forwards the retired routes to the pages that replaced them", () => {
    const config = readFileSync(resolve(packageRoot, "next.config.js"), "utf8");
    assert.match(config, /source: "\/floor", destination: "\/predict"/);
    assert.match(config, /source: "\/book", destination: "\/portfolio"/);
    assert.match(config, /source: "\/standing", destination: "\/leaderboards"/);
  });

  it("leaves no in-app links to the retired routes", () => {
    for (const path of [
      "components/prediction/PredictionWorkspace.tsx",
      "components/prediction/CommandPalette.tsx",
      "components/prediction/TopBar.tsx",
      "components/MobileTabBar.tsx",
      "event/[id]/page.tsx",
    ]) {
      const source = read(path);
      assert.doesNotMatch(source, /["'`]\/(floor|book|standing)["'`/]/, path);
    }
  });

  it("keeps the Event page reachable from the market page and ⌘K", () => {
    assert.equal(isPredictionTerminalRoute("/event/evt-1"), true);
    assert.match(read("market/[ticker]/page.tsx"), /href=\{`\/event\/\$\{event\.id\}`\}/);
    const palette = read("components/prediction/CommandPalette.tsx");
    assert.match(palette, /href: `\/event\/\$\{m\.eventId\}`/);
    // Market search hits open the full market page, not the event.
    assert.match(palette, /href: `\/market\/\$\{m\.ticker\}`/);
    assert.match(read("event/[id]/page.tsx"), /href="\/predict"/);
  });
});

describe("Quick-trade panel", () => {
  const panel = read("components/prediction/QuickTradePanel.tsx");
  const inspector = read("components/prediction/InspectorPanel.tsx");

  it("mounts exactly one host: Sheet at <=1023px, Dialog above", () => {
    assert.match(panel, /SHEET_BAND_QUERY = "\(max-width: 1023px\)"/);
    assert.match(panel, /if \(isSheetBand\) \{\s*return \(\s*<Sheet/);
    assert.match(panel, /<Dialog open=\{open\} onOpenChange=\{onOpenChange\}>/);
    assert.match(panel, /from "\.\.\/ui\/Sheet\.lazy"/);
  });

  it("trades through the real ticket and links out to the full market", () => {
    assert.match(inspector, /<ConnectedTradeTicket/);
    assert.match(inspector, /defaultSide=\{defaultSide\}/);
    assert.match(inspector, /href=\{`\/market\/\$\{market\.ticker\}`\}/);
  });
});
