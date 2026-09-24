/**
 * Auth — /auth/login (Auth.dc.html 16a/16b), restyled to Kilig 2026-09-24.
 *
 * Source-level assertions (repo convention — the suite runs node:test,
 * not a DOM harness) pinning the step's contracts:
 *  - login stays a centred 440px card, never the register split-screen
 *  - brand row: mark + wordmark with the Kilig pink period, then a
 *    poster-type title (no decorative eyebrow pill)
 *  - the error card uses the system danger colour, never market direction
 *    colours; it announces via role="alert", and sits ABOVE the CTA in
 *    the reading path; the CTA itself returns to active ink on error
 *    because disabled derives only from submitting/empty fields
 *  - the disabled CTA is the INERT surface (via Button variant="cta"),
 *    not an opacity fade
 *  - provider registry honesty: every slug the frontend offers has a
 *    matching backend registration in services/auth oauth.go; Apple and
 *    SSO (no backend on any deployment) are gone
 *  - social buttons are neutral secondary/outline (the provider glyphs
 *    carry their own brand colours)
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

  it("renders the Tap Trade mark, the wordmark's pink period and a poster title", () => {
    assert.match(login, /<BrandMark[^>]*tone="ink"/);
    assert.match(login, /text-\[var\(--brand-period\)\]/);
    assert.match(login, /type-poster/);
    assert.match(login, /t\("WELCOME_TITLE", "Welcome back"\)/);
  });

  it("drops the decorative eyebrow pill and legacy literals", () => {
    assert.doesNotMatch(login, /const EYEBROW_CLASS =/);
    assert.ok(
      !/rgba\(43,\s*228,\s*128|rgba\(255,\s*155,\s*107/.test(login),
      "mint-era literals must stay gone from login",
    );
    assert.doesNotMatch(login, /brand-(?:dark|purple|lavender|deep)/);
  });
});

describe("login error state (step 7, Auth 16b)", () => {
  it("keeps credential feedback in the system danger colour and role=alert", () => {
    assert.match(login, /border-\[var\(--danger\)\][^"]*text-\[var\(--danger\)\]/);
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

  it("keeps social buttons neutral secondary/outline", () => {
    assert.match(social, /border-\[var\(--border-2\)\] bg-\[var\(--surface-1\)\]/);
    assert.match(social, /hover:border-\[var\(--t3\)\]/);
    assert.doesNotMatch(social, /hover:border-\[#[0-9A-Fa-f]{6}\]/);
  });
});

describe("login link hit targets (step 7)", () => {
  it("gives the footer and forgot-password links 44px targets as quiet text", () => {
    assert.match(login, /const LINK_CLASS =\s*\n?\s*"inline-flex min-h-11/);
    assert.match(login, /const LINK_CLASS =[^;]*text-\[var\(--t3\)\][^;]*hover:text-\[var\(--t1\)\]/);
    assert.ok(
      !/LINK_ACCENT_CLASS =[^;]*text-\[var\(--accent\)\]/.test(login),
      "the create-account link never uses lime fill colour as text",
    );
  });
});
