/**
 * Purple/lavender step — /account (Account.dc.html 17a/17b), the last surface.
 *
 * Source-level assertions (repo convention — node:test, no DOM harness)
 * pinning the step's contracts:
 *  - points move from accent to ink: the balance and every stat value are
 *    neutral magnitudes; ONLY the settled result keeps a direction colour
 *  - the avatar uses the selected lavender surface with AA purple text
 *  - action cards follow the hover rule (stronger hairline + shadow,
 *    never a background change) and keep their Lucide icons from source
 *  - Profile links to /account/settings (the stale /account/security
 *    double-link was a leftover from the crashed pages-router settings)
 *  - the grid survives five cards as well as six (Play responsibly is
 *    behind FEATURE_RG; auto-fill is count-agnostic)
 *  - the login credential failure is humanized and localized
 *  - the 390 header fix: the tier pill clips/truncates instead of
 *    bleeding, and ultra-narrow widths keep balance-number priority
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
const topBar = read("components/prediction/TopBar.tsx");
const tierPill = read("components/prediction/TierPill.tsx");
const login = read("auth/login/page.tsx");

const SHIPPED_LOCALES = ["en", "id", "ms", "tl", "zh-Hans", "zh-Hant"];

describe("account values are neutral ink (step 8)", () => {
  it("renders the balance and stat values in ink, never accent", () => {
    assert.ok(!account.includes("text-[var(--accent)]"));
    assert.match(
      account,
      /font-mono text-\[22px\] font-medium tracking-\[-0\.01em\] text-\[var\(--t1\)\]/,
    );
  });

  it("keeps a direction colour ONLY on the settled result", () => {
    assert.match(account, /tone=\{pnlUp \? "yes" : "no"\}/);
    assert.ok(!account.includes('"gain"'), "the gain tone is retired");
    const accuracy = account.slice(
      account.indexOf('t("stats.accuracy"'),
      account.indexOf("</section>", account.indexOf('t("stats.accuracy"')),
    );
    assert.ok(
      !accuracy.includes("tone="),
      "accuracy is a magnitude — neutral ink",
    );
  });

  it("keeps the lavender avatar with readable purple text", () => {
    assert.match(
      account,
      /border-\[var\(--accent\)\] bg-\[var\(--accent-soft\)\][^"]*text-\[var\(--accent-text\)\]/,
    );
    assert.ok(!/rgba\(43,\s*228,\s*128/.test(account));
  });
});

describe("account settings list (Kilig)", () => {
  it("renders the actions as one hairline-divided settings list", () => {
    // Kilig: an Apple-Settings list (label + description left, chevron
    // right) inside one white card, not a grid of shadowed cards.
    assert.match(account, /function SettingsRow/);
    assert.match(account, /hover:bg-\[var\(--surface-2\)\]/);
    assert.ok(!account.includes("shadow-[var(--shadow-card"));
  });

  it("keeps the five Lucide icons read from source", () => {
    assert.match(
      account,
      /import \{ Bell, HeartHandshake, Lock, Settings, TrendingUp \} from "lucide-react"/,
    );
  });

  it("routes Profile to /account/settings and Security to /account/security", () => {
    assert.match(account, /href="\/account\/settings"[\s\S]{0,200}actions\.profile\.title/);
    assert.match(account, /href="\/account\/security"[\s\S]{0,200}actions\.security\.title/);
  });

  it("keeps Play responsibly flag-gated", () => {
    assert.match(account, /\{FEATURE_RG && \(/);
  });

  it("keeps the privacy save-error in the system danger colour, never market direction", () => {
    assert.match(account, /var\(--danger\)/);
    assert.ok(!/rgba\(255,\s*155,\s*107/.test(account));
    assert.doesNotMatch(account, /brand-(?:dark|lavender|purple)/);
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
