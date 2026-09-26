import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ar, type Key } from "@/lib/i18n/ar";

export type Lang = "ar" | "en";
export type { Key };

/**
 * The language is persisted in a first-party cookie so the server can render
 * `<html lang dir>` (and the matching copy) on first paint. The old
 * localStorage key is still read once as a migration path.
 */
export const LANG_COOKIE = "vu_lang";
const LEGACY_STORAGE_KEY = "qeema:lang";
const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseLang(value: string | null | undefined): Lang | null {
  return value === "ar" || value === "en" ? value : null;
}

/** Reads the language cookie from a `Cookie` header / `document.cookie` string. */
export function langFromCookieString(cookie: string | null | undefined): Lang | null {
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === LANG_COOKIE) return parseLang(part.slice(i + 1).trim());
  }
  return null;
}

function persistLang(l: Lang) {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${LANG_COOKIE}=${l}; Max-Age=${LANG_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${
      location.protocol === "https:" ? "; Secure" : ""
    }`;
  } catch {
    // cookies blocked: the choice still applies for this page view
  }
  try {
    localStorage.setItem(LEGACY_STORAGE_KEY, l);
  } catch {
    // storage blocked
  }
}

/**
 * Arabic (default) ships in the main bundle; English is code-split and
 * fetched on demand. `ensureLang` is awaited by the root route before the
 * first render (server and hydration) so an English page renders English
 * copy without a hydration mismatch.
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

export async function ensureLang(lang: Lang): Promise<void> {
  await loadLang(lang);
}

const I18nContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
  dir: "rtl" | "ltr";
}>({ lang: "ar", setLang: () => {}, t: (k) => (loaded.ar as Dict)[k] ?? k, dir: "rtl" });

export function I18nProvider({
  children,
  initialLang = "ar",
}: {
  children: ReactNode;
  initialLang?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [dict, setDict] = useState<Dict>(() => loaded[initialLang] ?? (loaded.ar as Dict));

  // Migration: a language saved only in localStorage (before the cookie
  // existed) is applied once and copied into the cookie.
  useEffect(() => {
    if (langFromCookieString(document.cookie)) return;
    let saved: Lang | null = null;
    try {
      saved = parseLang(localStorage.getItem(LEGACY_STORAGE_KEY));
    } catch {
      saved = null;
    }
    if (saved) {
      persistLang(saved);
      if (saved !== initialLang) setLangState(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    persistLang(l);
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
