// Number formatting shared by every page.
//
// Digits: Latin digits (0-9) in both languages, the app-wide policy (dates
// use "ar-u-nu-latn" too), so figures read the same in Arabic and English
// and copy into spreadsheets unchanged. In right-to-left text a number with
// a sign or a % must be direction-isolated: render numbers through <Num>
// (src/components/num.tsx), which uses these helpers.
//
// Rounding: values are rounded to the displayed precision first, and a value
// that rounds to zero is shown without a sign ("0.00", never "-0.00").

const LOCALE = "en-US";

/** Rounds to `decimals` and turns -0 (or anything that rounds to 0) into 0. */
export function cleanZero(n: number, decimals = 2): number {
  if (!Number.isFinite(n)) return n;
  const f = Math.pow(10, decimals);
  const r = Math.round(Math.abs(n) * f) / f;
  return r === 0 ? 0 : n;
}

/**
 * A money amount with 2 decimals and grouping ("1,234.56"), or compact
 * ("1.23M") when `compact` is set. No currency symbol: the trading currency
 * is not named in the app. `lang` is kept for call-site compatibility; the
 * digits are Latin in both languages.
 */
export function formatCurrency(n: number, compact = false, lang: "ar" | "en" = "ar"): string {
  void lang;
  if (compact) {
    return new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 2 }).format(cleanZero(n, 2));
  }
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(cleanZero(n, 2));
}

/**
 * A percentage. `n` is already in percent: 12.5 means 12.5 % (NOT a
 * fraction; pass (a / b) * 100). Positive values get a "+"; values that
 * round to 0.00 get no sign.
 */
export function formatPct(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return "—";
  const v = cleanZero(n, decimals);
  const sign = v > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false }).format(v)}%`;
}

/** A whole number with grouping ("10,000,000"), or compact ("10M"). */
export function formatInt(n: number, compact = false): string {
  if (compact) return new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 }).format(cleanZero(n, 1));
  return new Intl.NumberFormat(LOCALE).format(cleanZero(n, 3));
}

/**
 * Wraps a formatted number in Unicode left-to-right isolate marks (LRI ...
 * PDI), for plain-text places that cannot render <Num> (dialog text, toasts,
 * titles): the sign and digits then stay in order inside Arabic text.
 */
export function isolateLtr(s: string): string {
  return `\u2066${s}\u2069`;
}
