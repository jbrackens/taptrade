/**
 * The account area — the profile (/account), the settings frame and the
 * public profile — pinned to the board's look (2026-09-28 redesign, after
 * "the profile page is really ugly … it screams unfinished").
 *
 * Source-level assertions (repo convention — node:test, no DOM harness):
 *  - values are neutral ink; ONLY a settled result carries a direction colour
 *  - identity is the Kilig gradient avatar (pink = identity, DESIGN.md)
 *  - cards use the board's recipe (12px radius, hairline, whisper shadow)
 *    and position/activity rows carry the market's image tile
 *  - every settings page sits in one SettingsShell; no "← Back" buttons
 *  - the retired /profile redirects to /account/settings, and nothing on
 *    the settings page claims a status it doesn't have (no dead 2FA
 *    switch, no hard-coded "verified" badge)
 *  - the header chips at 390 and the humanized login failure (step 8)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(resolve(appRoot, rel), "utf-8");
}

const account = read("account/page.tsx");
const tabs = read("components/account/ProfileTabs.tsx");
const avatar = read("components/account/ProfileAvatar.tsx");
const shell = read("components/account/SettingsShell.tsx");
const settings = read("account/settings/page.tsx");
const publicProfile = read("users/[userId]/page.tsx");
const nextConfig = read("../next.config.js");
const topBar = read("components/prediction/TopBar.tsx");
const tierPill = read("components/prediction/TierPill.tsx");
const login = read("auth/login/page.tsx");

const SHIPPED_LOCALES = ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"];

describe("profile values are neutral ink", () => {
  it("never paints a value in the accent", () => {
    assert.ok(!account.includes("text-[var(--accent)]"));
    assert.match(account, /function Stat[\s\S]{0,400}text-\[var\(--t1\)\]/);
  });

  it("keeps a direction colour only on the settled result", () => {
    const accuracy = account.slice(
      account.indexOf('t("stats.accuracy"'),
      account.indexOf("</dl>", account.indexOf('t("stats.accuracy"')),
    );
    assert.ok(!/--yes-text|--no-text/.test(accuracy), "accuracy is a magnitude");
    const settled = account.slice(
      account.indexOf('t("stats.realizedPnl"'),
      account.indexOf('t("stats.accuracy"'),
    );
    assert.match(settled, /settledUp \? "text-\[var\(--yes-text\)\]" : "text-\[var\(--no-text\)\]"/);
  });

  it("draws identity with the Kilig gradient avatar", () => {
    assert.match(avatar, /var\(--kilig\)/);
    assert.match(avatar, /text-\[var\(--on-kilig\)\]/);
    assert.match(account, /<ProfileAvatar name=/);
    assert.match(publicProfile, /<ProfileAvatar name=/);
  });
});

describe("profile uses the board's card recipe", () => {
  it("gives cards the hairline, 12px radius and whisper shadow", () => {
    assert.match(
      account,
      /CARD_CLASS =\s*\n?\s*"rounded-\[var\(--r-rh-lg\)\] border border-\[var\(--border-1\)\] bg-\[var\(--surface-1\)\] shadow-\[var\(--shadow-card\)\]"/,
    );
    assert.match(tabs, /shadow-\[var\(--shadow-card\)\]/);
  });

  it("shows each position and order with its market's image tile and title", () => {
    assert.match(tabs, /import \{ MarketThumb \} from "\.\.\/prediction\/MarketThumb"/);
    assert.match(tabs, /localizedMarket\(t, market\)/);
    assert.match(publicProfile, /<MarketThumb /);
    assert.ok(!publicProfile.includes("item.marketId} ·"), "no raw market ids in activity");
  });

  it("links Profile to /account/settings and Security to /account/security", () => {
    assert.match(account, /href="\/account\/settings"[\s\S]{0,200}actions\.profile\.title/);
    assert.match(account, /href="\/account\/security"[\s\S]{0,200}actions\.security\.title/);
  });

  it("keeps Play responsibly flag-gated", () => {
    assert.match(account, /\{FEATURE_RG && \(/);
    assert.match(shell, /enabled: FEATURE_RG/);
  });
});

describe("settings area", () => {
  it("puts every settings page in one shell, with no back buttons", () => {
    for (const rel of [
      "account/settings/page.tsx",
      "account/security/page.tsx",
      "account/notifications/page.tsx",
      "account/transactions/page.tsx",
    ]) {
      const source = read(rel);
      assert.match(source, /<SettingsShell active="/, `${rel} should render inside SettingsShell`);
      assert.ok(!source.includes("← Back"), `${rel} should not carry its own back button`);
    }
  });

  it("redirects the retired /profile to /account/settings", () => {
    assert.match(nextConfig, /source: "\/profile", destination: "\/account\/settings"/);
  });

  it("claims no status it doesn't have", () => {
    assert.ok(!settings.includes("Enable 2FA"), "no dead two-factor switch");
    assert.ok(!settings.includes('status="verified"'), "no hard-coded verified badge");
    assert.match(settings, /kycBadge\(status\)/);
  });

  it("keeps save errors in the system danger colour, never market direction", () => {
    assert.match(settings, /text-\[var\(--danger\)\]/);
    assert.doesNotMatch(settings, /brand-(?:dark|lavender|purple)/);
  });
});

describe("header chips at 390 (step 8)", () => {
  it("clips and truncates the tier pill instead of bleeding", () => {
    assert.match(tierPill, /overflow-hidden/);
    assert.match(tierPill, /min-w-0 truncate/);
    assert.match(tierPill, /max-\[419px\]:hidden/);
  });

  it("keeps balance-number priority at ultra-narrow widths", () => {
    assert.match(tierPill, /max-\[359px\]:hidden/);
    assert.match(topBar, /TOP_BAR_BALANCE_LABEL_CLASS =\s*\n?\s*"[^"]*max-\[359px\]:hidden/);
    assert.match(topBar, /TOP_BAR_BALANCE_CLASS =\s*\n?\s*"inline-flex min-h-11 shrink-0/);
  });

  it("drops the wordmark before it crowds required header controls", () => {
    assert.match(
      topBar,
      /TOP_BAR_WORDMARK_CLASS =\s*\n?\s*"[^"]*max-\[359px\]:hidden/,
    );
  });

  it("uses the Kilig ink avatar disc in the top bar", () => {
    assert.ok(!topBar.includes("#6d63dc"));
    // Kilig: an ink disc with white initials (the interaction voice).
    assert.match(
      topBar,
      /TOP_BAR_AVATAR_CLASS =[\s\S]{0,400}bg-\[var\(--accent\)\][\s\S]{0,400}text-\[var\(--ticket-cta-text\)\]/,
    );
    assert.ok(
      !/TOP_BAR_AVATAR_CLASS =[\s\S]{0,400}brand-lavender/.test(topBar),
      "no lavender",
    );
  });

  it("shows the balance as ink, not direction green", () => {
    assert.ok(
      !/TOP_BAR_BALANCE_CLASS =[\s\S]{0,400}--yes-text/.test(topBar),
      "a balance is a magnitude, not a direction",
    );
    assert.match(topBar, /TOP_BAR_BALANCE_CLASS =[\s\S]{0,400}text-\[var\(--t1\)\]/);
  });
});

describe("login credential failure copy (step 8)", () => {
  it("maps the raw server message to the localized string", () => {
    assert.match(
      login,
      /invalid username or password[\s\S]{0,200}INCORRECT_CREDENTIALS/,
    );
  });

  it("ships the string in every locale", () => {
    for (const locale of SHIPPED_LOCALES) {
      const strings = JSON.parse(
        readFileSync(
          resolve(appRoot, "../public/static/locales", locale, "login.json"),
          "utf-8",
        ),
      ) as Record<string, string>;
      assert.ok(
        strings.INCORRECT_CREDENTIALS,
        `${locale}: INCORRECT_CREDENTIALS missing`,
      );
    }
  });
});
