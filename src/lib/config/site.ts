/**
 * Public identity of the operator, shown on the legal pages, the Shariah
 * page and the footer.
 *
 * Only facts confirmed by the product owner belong here. An empty string (or
 * an empty list) means "not confirmed yet": the UI renders nothing for it —
 * never a placeholder, a dash or invented text.
 */
export const SITE = {
  brandAr: "وحدة القيمة",
  brandEn: "Value Unit",
  canonicalOrigin: "https://hub.sunkvalue.com",
  legalEntityNameAr: "",
  legalEntityNameEn: "",
  commercialRegistration: "",
  addressAr: "",
  addressEn: "",
  contactEmail: "",
  privacyEmail: "privacy@valueunit.app",
  securityEmail: "security@valueunit.app",
  complaintsEmail: "",
  licensingStatusAr: "",
  licensingStatusEn: "",
  shariahBoard: [] as Array<{ nameAr: string; nameEn: string; roleAr: string; roleEn: string }>,
};

export type SiteLang = "ar" | "en";

/** True when a configured value is present (non-blank). */
export function isFilled(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Localized configured text, falling back to the other language; "" when neither is set. */
export function siteText(lang: SiteLang, ar: string, en: string): string {
  const first = lang === "ar" ? ar : en;
  const second = lang === "ar" ? en : ar;
  return isFilled(first) ? first.trim() : isFilled(second) ? second.trim() : "";
}

/** Brand name in the given language. */
export function brandName(lang: SiteLang): string {
  return lang === "ar" ? SITE.brandAr : SITE.brandEn;
}

/** Absolute URL on the canonical origin for a path such as "/legal/terms". */
export function canonicalUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${SITE.canonicalOrigin}${p === "/" ? "/" : p}`;
}

/** True when any part of the operator identity block has been confirmed. */
export function hasEntityDetails(): boolean {
  return [
    SITE.legalEntityNameAr,
    SITE.legalEntityNameEn,
    SITE.commercialRegistration,
    SITE.addressAr,
    SITE.addressEn,
    SITE.licensingStatusAr,
    SITE.licensingStatusEn,
  ].some(isFilled);
}

export type SiteContactKind = "contact" | "privacy" | "complaints" | "security";

/** Configured contact addresses, in display order; unset ones are omitted. */
export function siteContacts(kinds: SiteContactKind[] = ["contact", "privacy", "complaints", "security"]) {
  const map: Record<SiteContactKind, string> = {
    contact: SITE.contactEmail,
    privacy: SITE.privacyEmail,
    complaints: SITE.complaintsEmail,
    security: SITE.securityEmail,
  };
  return kinds
    .filter((k) => isFilled(map[k]))
    .map((k) => ({ kind: k, email: map[k].trim() }));
}
