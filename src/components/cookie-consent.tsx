import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";

/**
 * Informational notice, not a consent manager: the app sets no advertising or
 * analytics cookies, only the browser-storage items listed on /legal/cookies,
 * all needed for the feature they support. Dismissal is remembered in
 * localStorage under KEY (listed on the cookie policy page).
 */
const KEY = "cookie-notice:v1";

export function CookieConsent() {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!window.localStorage.getItem(KEY)) setOpen(true);
    } catch {
      // Storage unavailable (private mode): keep the notice hidden rather than nag on every page.
    }
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, "dismissed");
    } catch {
      // ignore
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      dir={dir}
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-border/70 bg-card/95 px-4 py-4 shadow-luxury backdrop-blur-lg md:inset-x-6 md:bottom-6 md:rounded-xl md:border"
      role="region"
      aria-label={t("legalCookies")}
    >
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="min-w-0 text-caption leading-relaxed text-ink-soft md:text-body">
          {t("cc_text")}
          <Link
            to="/legal/cookies"
            className="text-[var(--gold-deep)] underline underline-offset-2"
          >
            {t("cc_link")}
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="min-h-11 rounded-md gold-gradient px-4 py-1.5 text-caption font-semibold text-ink"
          >
            {t("cc_dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
