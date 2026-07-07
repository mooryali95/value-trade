export function formatCurrency(n: number, compact = false, lang: "ar" | "en" = "ar"): string {
  const locale = lang === "ar" ? "en-US" : "en-US"; // use latin numerals for numeric clarity
  if (compact) {
    return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 }).format(n);
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
}

export function formatPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatInt(n: number, compact = false): string {
  if (compact) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  return new Intl.NumberFormat("en-US").format(n);
}