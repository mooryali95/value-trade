/** Letters of the Arabic script (Arabic, supplement, extended, presentation forms). */
export const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
export const LATIN_SCRIPT = /[A-Za-z]/;

/** The script a free-text value is mostly written in, if any. */
export function textLanguage(text: string): "ar" | "en" | null {
  const ar = (text.match(new RegExp(ARABIC_SCRIPT.source, "g")) ?? []).length;
  const en = (text.match(/[A-Za-z]/g) ?? []).length;
  if (ar === 0 && en === 0) return null;
  return ar >= en ? "ar" : "en";
}
