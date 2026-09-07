/**
 * Purple/lavender auth step — /auth/login (Auth.dc.html 16a/16b).
 *
 * Source-level assertions (repo convention — the suite runs node:test,
 * not a DOM harness) pinning the step's contracts:
 *  - login stays a centred 440px card, never the register split-screen
 *  - the eyebrow pill takes ink on the lavender tint, not accent text
 *  - the error card uses neutral brand feedback tokens, not market direction
 *    colours; it announces via role="alert", and sits ABOVE the CTA in
 *    the reading path; the CTA itself returns to active purple on error
 *    because disabled derives only from submitting/empty fields
 *  - the disabled CTA is the INERT surface (via Button variant="cta"),
 *    not an opacity fade
 *  - provider registry honesty: every slug the frontend offers has a
 *    matching backend registration in services/auth oauth.go; Apple and
 *    SSO (no backend on any deployment) are gone
 *  - per-provider brand hover colours stay — the one place brand colour
 *    is correct
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(resolve(appRoot, rel), "utf-8");
}

const login = read("auth/login/page.tsx");
const social = read("components/auth/SocialAuthButtons.tsx");
const register = read("auth/register/page.tsx");
const oauthGo = readFileSync(
  resolve(
    appRoot,
    "../../../../go-platform/services/auth/internal/http/oauth.go",
  ),
  "utf-8",
);

describe("login card shape (step 7)", () => {
  it("stays a centred 440px card", () => {
    assert.match(login, /max-w-\[440px\]/);
    assert.match(login, /items-center justify-center/);
  });

  it("renders the selected Tap Trade mark with a title-case, 600 wordmark", () => {
    assert.match(login, /text-\[27px\] font-semibold tracking-\[-0\.025em\]/);
    assert.match(login, /<BrandMark size=\{32\} tone="ink" \/>/);
    assert.doesNotMatch(login, /text-\[var\(--brand-period\)\]/);
  });

  it("keeps the eyebrow pill ink on the lavender tint", () => {
    const eyebrow = login.match(/const EYEBROW_CLASS =\s*\n?\s*"([^"]+)"/)?.[1];
    assert.ok(eyebrow, "EYEBROW_CLASS present");
    assert.ok(eyebrow.includes("bg-[var(--accent-soft)]"));
    assert.ok(eyebrow.includes("text-[var(--t1)]"));
    assert.ok(!eyebrow.includes("text-[var(--accent)]"));
    assert.ok(
      !/rgba\(43,\s*228,\s*128|rgba\(255,\s*155,\s*107/.test(login),
      "mint-era literals must stay gone from login",
    );
  });
});

describe("login error state (step 7, Auth 16b)", () => {
  it("keeps credential feedback in the purple system and role=alert", () => {
    assert.match(
      login,
      /border-\[var\(--accent\)\] bg-\[var\(--accent-soft\)\][^"]*text-\[var\(--brand-dark\)\]/,
    );
    assert.ok(!login.includes("--no-"));
    assert.match(login, /role="alert"/);
  });

  it("keeps the error ABOVE the CTA in the reading path", () => {
    const errorAt = login.indexOf('role="alert"');
    const ctaAt = login.indexOf('variant="cta"');
    assert.ok(errorAt > -1 && ctaAt > -1);
    assert.ok(
      errorAt < ctaAt,
      "the failure message must come before the retry",
    );
  });

  it("returns the CTA to active purple on error — disabled ignores the error state", () => {
    assert.match(
      login,
      /disabled=\{submitting \|\| !username \|\| !password\}/,
    );
  });

  it("uses the inert treatment for the disabled CTA, not opacity", () => {
    // The login CTA is Button variant="cta"; the primitive carries the
    // inert surface. Pin both ends so neither can drift alone.
    assert.match(login, /variant="cta"/);
    const button = read("components/ui/Button.tsx");
    assert.match(
      button,
      /cta:[^}]*disabled:border-\[var\(--inert-border\)\] disabled:bg-\[var\(--inert-fill\)\] disabled:text-\[var\(--inert-label\)\]/,
    );
  });
});

describe("provider registry honesty (step 7)", () => {
  const frontendSlugs = [...social.matchAll(/slug: "([a-z]+)"/g)].map(
    (m) => m[1],
  );

  it("offers six providers on login, three on register", () => {
    const grid = social.match(/DEFAULT_GRID_SLUGS = \[([\s\S]*?)\]/)?.[1];
    assert.ok(grid, "grid slug list present");
    const gridSlugs = [...grid.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(gridSlugs, [
      "google",
      "twitter",
      "facebook",
      "tiktok",
      "reddit",
      "discord",
    ]);
    assert.match(register, /providers=\{\["google", "facebook", "discord"\]\}/);
  });

  it("backs every offered slug with a services/auth oauth.go registration", () => {
    assert.ok(frontendSlugs.length >= 6);
    for (const slug of frontendSlugs) {
      assert.ok(
        oauthGo.includes(`newProvider("${slug}"`),
        `frontend offers "${slug}" but oauth.go never registers it — a tile that can only fail`,
      );
    }
  });

  it("drops Apple and SSO — no backend on any deployment", () => {
    assert.ok(!frontendSlugs.includes("apple"));
    assert.ok(!frontendSlugs.includes("sso"));
    assert.ok(!social.includes("AppleIcon"));
    assert.ok(!social.includes("SSOIcon"));
  });

  it("keeps per-provider brand hover colours — the platform's own affordance", () => {
    for (const brandHex of [
      "#4285F4", // Google
      "#1877F2", // Facebook
      "#FE2C55", // TikTok
      "#FF4500", // Reddit
      "#5865F2", // Discord
    ]) {
      assert.ok(
        social.includes(`hover:border-[${brandHex}]`),
        `brand hover ${brandHex} must stay`,
      );
    }
  });
});

describe("login link hit targets (step 7)", () => {
  it("gives the footer and forgot-password links 44px targets and accent-text", () => {
    assert.match(login, /const LINK_CLASS =\s*\n?\s*"inline-flex min-h-11/);
    assert.match(login, /text-\[var\(--accent-text\)\]/);
    assert.ok(
      !/LINK_ACCENT_CLASS =[^;]*text-\[var\(--accent\)\]/.test(login),
      "the create-account link never uses lime fill colour as text",
    );
  });
});
