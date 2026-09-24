import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");
const globals = readFileSync(resolve(appRoot, "globals.css"), "utf8");
const layout = readFileSync(resolve(appRoot, "layout.tsx"), "utf8");
const button = readFileSync(
  resolve(appRoot, "components/ui/Button.tsx"),
  "utf8",
);
const input = readFileSync(
  resolve(appRoot, "components/ui/Input.tsx"),
  "utf8",
);
const predictionWorkspace = readFileSync(
  resolve(appRoot, "components/prediction/PredictionWorkspace.tsx"),
  "utf8",
);
const marketCard = readFileSync(
  resolve(appRoot, "components/prediction/MarketCard.tsx"),
  "utf8",
);

// The Kilig system (adopted 2026-09-24, DESIGN.md): ink and white chrome,
// Kilig pink for identity and liveness, blue/orange for YES/NO only.
describe("Tap Trade Kilig color system", () => {
  it("pins the approved neutral, identity, and market-semantic primitives", () => {
    const expected = {
      paper: "#f5f5f7",
      card: "#ffffff",
      raised: "#ededf1",
      hairline: "#e3e3e8",
      "hairline-strong": "#cdcdd4",
      ink: "#111114",
      "ink-2": "#3c3c44",
      "ink-3": "#5e5e68",
      "ink-deep": "#0b0b0e",
      kilig: "#e0126e",
      "kilig-bright": "#ff2d78",
      "kilig-text": "#c40f60",
      "dir-yes": "#1f5fe0",
      "dir-yes-text": "#1a56cc",
      "dir-yes-bar": "#bfd2f8",
      "dir-no": "#c94a12",
      "dir-no-text": "#b3410f",
      "dir-no-bar": "#f2cfbc",
    };

    for (const [name, hex] of Object.entries(expected)) {
      assert.match(
        globals,
        new RegExp(`--${name}:\\s*${hex};`, "i"),
        `--${name} should equal ${hex}`,
      );
    }
  });

  it("derives YES and NO soft surfaces from the shared direction primitives", () => {
    assert.match(
      globals,
      /--yes-soft:\s*color-mix\(in srgb, var\(--dir-yes\) 8%, transparent\);/,
    );
    assert.match(
      globals,
      /--yes-border:\s*color-mix\(in srgb, var\(--dir-yes\) 28%, transparent\);/,
    );
    assert.match(
      globals,
      /--no-soft:\s*color-mix\(in srgb, var\(--dir-no\) 8%, transparent\);/,
    );
    assert.match(
      globals,
      /--no-border:\s*color-mix\(in srgb, var\(--dir-no\) 26%, transparent\);/,
    );
    assert.match(globals, /--yes-text:\s*var\(--dir-yes-text\);/);
    assert.match(globals, /--no-text:\s*var\(--dir-no-text\);/);
  });

  it("uses ink for interaction and Kilig pink for liveness, never the reverse", () => {
    assert.match(globals, /--accent:\s*var\(--ink\);/);
    assert.match(globals, /--accent-soft:\s*var\(--ink-soft\);/);
    assert.match(globals, /--focus-ring:\s*var\(--ink\);/);
    assert.match(globals, /--live:\s*var\(--kilig\);/);
    assert.match(globals, /--live-text:\s*var\(--kilig-text\);/);
    assert.match(globals, /--reward:\s*var\(--kilig\);/);
    assert.doesNotMatch(globals, /--accent:\s*var\(--kilig/);
    assert.doesNotMatch(globals, /--(?:yes|no):\s*var\(--kilig/);
  });

  it("retires the purple, gold and lime primitives", () => {
    assert.doesNotMatch(globals, /#6334a8|#f5c454|#c6f24e|#1e1235|#28153f/i);
    assert.doesNotMatch(globals, /--reward-lime|--reward-hero|--lime(?:-text|-wash|-tint)?:/);
  });

  it("drops resting card shadows and collapses the radius scales", () => {
    assert.match(globals, /--shadow-card:\s*none;/);
    assert.match(globals, /--shadow-card-hover:\s*none;/);
    assert.match(globals, /--r-rh-md:\s*6px;/);
    assert.match(globals, /--r-rh-lg:\s*8px;/);
  });

  it("loads the three Kilig faces through next/font and maps them in the theme", () => {
    assert.match(layout, /Instrument_Sans\(/);
    assert.match(layout, /Big_Shoulders\(/);
    assert.match(layout, /Martian_Mono\(/);
    assert.match(globals, /--font-sans:\s*var\(--font-instrument-sans\)/);
    assert.match(globals, /--font-mono:\s*var\(--font-martian-mono\)/);
    assert.match(globals, /--font-poster:\s*var\(--font-big-shoulders\)/);
    assert.doesNotMatch(globals, /@font-face\s*\{[^}]*Switzer/);
  });

  it("keeps primary, focus, and disabled controls contrast-safe", () => {
    assert.match(button, /bg-\[var\(--accent\)\][^\n]*text-\[var\(--ticket-cta-text\)\]/);
    assert.match(button, /focus-visible:ring-2 focus-visible:ring-\[var\(--focus-ring\)\]/);
    assert.match(button, /disabled:bg-\[var\(--inert-fill\)\][^\n]*disabled:text-\[var\(--inert-label\)\]/);
    assert.match(input, /focus-visible:shadow-\[0_0_0_2px_var\(--focus-ring\)\]/);
    assert.match(input, /disabled:bg-\[var\(--inert-fill\)\][^\n]*disabled:text-\[var\(--inert-label\)\]/);
    // A validation error is a system message, never market-NO semantics.
    assert.match(input, /aria-invalid:border-\[var\(--danger\)\]/);
    assert.doesNotMatch(input, /aria-invalid:border-\[var\(--no-text\)\]/);
  });

  it("lets utility link colors override the base anchor reset", () => {
    assert.match(
      globals,
      /@layer base\s*\{[\s\S]*?a\s*\{\s*color:\s*inherit;/,
      "the global anchor reset must stay below Tailwind utilities",
    );
  });

  it("keeps Predict free of redemption/prize marketing and the live signal off YES/NO", () => {
    // Points are non-redeemable play value: the retired "Pick. Win. Redeem."
    // iPhone hero must not come back on the discovery page. Comments are
    // stripped so only rendered code is checked.
    const workspaceCode = predictionWorkspace.replace(
      /\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|\/\/.*$/gm,
      "",
    );
    assert.doesNotMatch(workspaceCode, /WORKSPACE_REWARD_|RewardHero/);
    assert.doesNotMatch(workspaceCode, /redeem|prize|iphone/i);
    assert.match(marketCard, /bg-\[var\(--live\)\]/);
    assert.doesNotMatch(
      marketCard,
      /bg-\[var\(--live\)\][\s\S]{0,160}--(?:yes|no)/,
      "the pink live signal must not borrow YES/NO market semantics",
    );
  });
});
