import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { errorMessageKey } from "@/hooks/use-error-message";
import { en } from "@/lib/i18n/en";
import { ar } from "@/lib/i18n/ar";

// Every stable code the database raises in the phase 2/3 migrations reaches
// the browser through the server functions. Each must have a translated
// message; otherwise the user sees "something went wrong, try again" for a
// refusal that retrying cannot fix (e.g. CASH_RESERVED on a withdrawal).
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

// Codes that never leave the server (the server function maps or logs them).
const SERVER_ONLY = new Set(["GO_LIVE_RESET_DONE"]);

function raisedCodes(): string[] {
  const codes = new Set<string>();
  for (const f of readdirSync(MIGRATIONS)) {
    if (!/^20260(92[4-9]|93)\d*_.*\.sql$/.test(f)) continue;
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(/RAISE EXCEPTION '([A-Z][A-Z0-9_]{2,63})'/g)) codes.add(m[1]);
  }
  return [...codes].filter((c) => !SERVER_ONLY.has(c)).sort();
}

describe("database error codes", () => {
  it("finds the codes of the migrations", () => {
    expect(raisedCodes()).toEqual(expect.arrayContaining(["CASH_RESERVED", "INSUFFICIENT_CASH", "SHARIAH_RULING_CONFLICT"]));
  });

  it("each maps to a message present in both dictionaries", () => {
    const missing = raisedCodes().filter((c) => {
      const key = errorMessageKey(c);
      return !key || !(key in en) || !(key in ar);
    });
    expect(missing).toEqual([]);
  });
});
