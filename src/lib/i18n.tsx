import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ar, type Key } from "@/lib/i18n/ar";

type Lang = "ar" | "en";
export type { Key };

/**
 * Arabic (default) ships in the main bundle; English is code-split and
 * fetched on demand the first time the user switches language.
 */
type Dict = Record<Key, string>;
const loaded: Partial<Record<Lang, Dict>> = { ar: ar as unknown as Dict };

async function loadLang(lang: Lang): Promise<Dict> {
  const cached = loaded[lang];
  if (cached) return cached;
  const mod = await import("@/lib/i18n/en");
  loaded.en = mod.en;
  return mod.en;
}

const I18nContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
  dir: "rtl" | "ltr";
}>({ lang: "ar", setLang: () => {}, t: (k) => k, dir: "rtl" });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");
  const [dict, setDict] = useState<Dict>(loaded.ar as Dict);

  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? (localStorage.getItem("qeema:lang") as Lang | null) : null;
    if (saved === "ar" || saved === "en") setLangState(saved);
  }, []);

  useEffect(() => {
    let alive = true;
    void loadLang(lang).then((d) => {
      if (alive) setDict(d);
    });
    return () => {
      alive = false;
    };
  }, [lang]);

  useEffect(() => {
    const dir = lang === "ar" ? "rtl" : "ltr";
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("dir", dir);
      document.documentElement.setAttribute("lang", lang);
    }
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem("qeema:lang", l);
  };

  const t = (k: Key) => dict[k] ?? (loaded.ar as Dict)[k] ?? k;
  return (
    <I18nContext.Provider value={{ lang, setLang, t, dir: lang === "ar" ? "rtl" : "ltr" }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);

/**
 * Localized *data* field picker (not UI copy).
 * Use for records that carry both `*_ar`/`*_en` (or `nameAr`/`nameEn`) values.
 */
export function pick(lang: Lang, ar: string | null | undefined, en: string | null | undefined) {
  return (lang === "ar" ? ar || en : en || ar) ?? "";
}

/** Locale tag for Intl / toLocaleString calls. */
export const localeTag = (lang: Lang) => (lang === "ar" ? "ar" : "en-US");
