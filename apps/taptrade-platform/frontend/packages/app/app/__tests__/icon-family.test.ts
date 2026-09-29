/**
 * One icon family (2026-09-29 redesign audit): the player app draws every
 * icon from Phosphor. Lucide was mixed into six files and is gone.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const appRoot = resolve(__dirname, "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(path);
  }
  return out;
}

describe("icon family", () => {
  it("imports no icon library but Phosphor", () => {
    const offenders = sourceFiles(appRoot).filter((file) =>
      /from ["'](lucide-react|react-icons[^"']*|@heroicons\/[^"']*)["']/.test(
        readFileSync(file, "utf-8"),
      ),
    );
    assert.deepEqual(offenders, []);
  });
});
