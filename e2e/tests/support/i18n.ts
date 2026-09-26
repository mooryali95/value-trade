// The app's Arabic copy (the default language): tests assert on the exact
// strings users see, taken from the source of truth so a copy edit does not
// silently desynchronise the suite.
import { ar, type Key } from "../../../src/lib/i18n/ar";

export type { Key };

/** Arabic text for `key`; `{name}` placeholders are filled from `vars`. */
export function t(key: Key, vars: Record<string, string | number> = {}): string {
  let s: string = ar[key];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Money / prices as the app prints them (en-US digits, 2 decimals, grouping), e.g. 25,000.00. */
export function money(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/** Whole quantities as the app prints them, e.g. 1,200. */
export function qty(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(n);
}
