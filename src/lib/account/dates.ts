/**
 * Dates on the onboarding and admin screens, in the app-wide style: Latin
 * digits in both languages ("ar-u-nu-latn"), Gregorian calendar, Riyadh
 * time (the platform's reference time zone).
 */
export type DateLang = "ar" | "en";

const TIME_ZONE = "Asia/Riyadh";

function locale(lang: DateLang): string {
  return lang === "ar" ? "ar-u-nu-latn-ca-gregory" : "en-GB";
}

/** "24 Sep 2026" / "24 سبتمبر 2026"; "" for a missing or invalid date. */
export function formatDay(iso: string | null | undefined, lang: DateLang, month: "short" | "long" = "short"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale(lang), { timeZone: TIME_ZONE, day: "numeric", month, year: "numeric" }).format(d);
}

/** Day and time (hours:minutes). */
export function formatDayTime(iso: string | null | undefined, lang: DateLang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
