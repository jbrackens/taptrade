import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");
const globals = readFileSync(resolve(appRoot, "globals.css"), "utf8");
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

describe("Tap Trade purple and gold color system", () => {
  it("pins the approved neutral, brand, and market-semantic primitives", () => {
    const expected = {
      paper: "#f1f4f6",
      card: "#ffffff",
      raised: "#ebeef0",
      hairline: "#dde2e5",
      "hairline-strong": "#cbd1d5",
      ink: "#101112",
      "ink-2": "#43494d",
      "ink-3": "#576066",
      "brand-deep": "#1e1235",
      "brand-dark": "#28153f",
      "brand-purple": "#6334a8",
      "brand-lavender": "#ece3f7",
      "signal-gold": "#f5c454",
      "signal-gold-text": "#885206",
      "reward-lime": "#c6f24e",
      "dir-yes": "#126d68",
      "dir-yes-bar": "#a7d8d3",
      "dir-no": "#9c3b65",
      "dir-no-bar": "#e5b5c9",
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
  });

  it("uses purple for generic interaction, gold for live signals, and scoped lime for featured rewards", () => {
    assert.match(globals, /--accent:\s*var\(--brand-purple\);/);
    assert.match(globals, /--accent-soft:\s*var\(--brand-lavender\);/);
    assert.match(globals, /--focus-ring:\s*var\(--brand-purple\);/);
    assert.match(globals, /--live:\s*var\(--signal-gold\);/);
    assert.match(globals, /--reward:\s*var\(--signal-gold\);/);
    assert.match(globals, /--on-gold:\s*var\(--brand-dark\);/);
    assert.doesNotMatch(globals, /--live:\s*#ff6b6b/i);
    assert.doesNotMatch(globals, /--accent:\s*var\(--lime\)/);
  });

  it("keeps primary, focus, and disabled controls contrast-safe", () => {
    assert.match(button, /bg-\[var\(--accent\)\][^\n]*text-\[var\(--ticket-cta-text\)\]/);
    assert.match(button, /focus-visible:ring-2 focus-visible:ring-\[var\(--focus-ring\)\]/);
    assert.match(button, /disabled:bg-\[var\(--inert-fill\)\][^\n]*disabled:text-\[var\(--inert-label\)\]/);
    assert.match(input, /focus-visible:shadow-\[0_0_0_2px_var\(--focus-ring\)\]/);
    assert.match(input, /disabled:bg-\[var\(--inert-fill\)\][^\n]*disabled:text-\[var\(--inert-label\)\]/);
    assert.match(input, /aria-invalid:border-\[var\(--brand-dark\)\]/);
    assert.doesNotMatch(input, /aria-invalid:border-\[var\(--no-text\)\]/);
    assert.doesNotMatch(globals, /rgba\(16,\s*200,\s*160/);
  });

  it("lets utility link colors override the base anchor reset", () => {
    assert.match(
      globals,
      /@layer base\s*\{[\s\S]*?a\s*\{\s*color:\s*inherit;/,
      "the global anchor reset must stay below Tailwind utilities",
    );
  });

  it("uses lime in the reward-led Predict hero and retains gold for live-market signals", () => {
    assert.match(predictionWorkspace, /WORKSPACE_REWARD_WIN/);
    assert.match(predictionWorkspace, /bg-\[var\(--reward-lime\)\][^\n]*text-\[var\(--on-reward-lime\)\]/);
    assert.match(predictionWorkspace, /featured-iphone-reward-hero-v6\.webp/);
    assert.match(predictionWorkspace, /featured-iphone-reward-artwork/);
    assert.match(
      predictionWorkspace,
      /Titanium smartphone featured as a redeemable reward\./,
    );
    assert.match(marketCard, /bg-\[var\(--live\)\]/);
    assert.doesNotMatch(
      marketCard,
      /bg-\[var\(--live\)\][\s\S]{0,160}--(?:yes|no)/,
      "the gold Trending signal must not borrow YES/NO market semantics",
    );
  });
});
