/**
 * Crypto cashier behind FEATURE_CASHIER_UI (merged from
 * feat/hula-na-cashier, 2026-09-29). The demo is points-only: the route
 * 404s when the flag is off, nothing links to it, and its money copy stays
 * out of the locale files.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const appRoot = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(appRoot, rel), "utf-8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("crypto cashier flag", () => {
  it("defaults off and 404s the route when off", () => {
    assert.match(read("lib/features.ts"), /FEATURE_CASHIER_UI =\s*process\.env\.NEXT_PUBLIC_FEATURE_CASHIER_UI === "true"/);
    assert.match(read("cashier/page.tsx"), /if \(!FEATURE_CASHIER_UI\) notFound\(\);/);
  });

  it("has no navigation entry point", () => {
    const linkers = sourceFiles(appRoot).filter(
      (f) => !f.includes(`${join("app", "cashier")}`) && /href=["'{`]+\/cashier/.test(readFileSync(f, "utf-8")),
    );
    assert.deepEqual(linkers, []);
  });

  it("reads the gateway alpha cashier, never the retired legacy payment routes", () => {
    const client = read("lib/api/cashier-client.ts");
    assert.match(client, /\/api\/v1\/cashier\/alpha\/config/);
    assert.doesNotMatch(client, /\/api\/v1\/payments\//);
    assert.doesNotMatch(read("lib/api/wallet-client.ts"), /cashier/);
  });

  it("keeps cashier copy out of the locale files", () => {
    const localeRoot = resolve(appRoot, "../public/static/locales/en");
    assert.ok(!readdirSync(localeRoot).includes("cashier.json"));
  });
});
