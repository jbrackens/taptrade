/**
 * Two-factor sign-in behind FEATURE_MFA (2026-09-29). The owner deferred the
 * authenticator: the auth service keeps it off (AUTH_MFA_ENABLED), and the
 * player app hides its settings until NEXT_PUBLIC_FEATURE_MFA=true.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(appRoot, rel), "utf-8");

describe("two-factor sign-in flag", () => {
  it("defaults off", () => {
    assert.match(read("lib/features.ts"), /FEATURE_MFA = process\.env\.NEXT_PUBLIC_FEATURE_MFA === "true"/);
  });

  it("hides the security tab and skips the status call when off", () => {
    const page = read("account/security/page.tsx");
    assert.match(page, /\.\.\.\(FEATURE_MFA\s*\?\s*\[\{ id: "twofa"/);
    assert.match(page, /if \(!FEATURE_MFA \|\| !user\?\.id\) return;/);
    assert.match(page, /\{FEATURE_MFA && tab === "twofa" && \(/);
  });

  it("ignores ?mfa=1 on the login page when off", () => {
    assert.match(read("auth/login/page.tsx"), /FEATURE_MFA && searchParams\.get\("mfa"\) === "1"/);
  });
});
