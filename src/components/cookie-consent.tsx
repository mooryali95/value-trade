import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";

const KEY = "cookie-consent:v1";

export function CookieConsent() {
  const { t, lang, dir } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!window.localStorage.getItem(KEY)) setOpen(true);
    } catch {
      // ignore
    }
  }, []);

  const decide = (value: "accepted" | "rejected") => {
    try {
      window.localStorage.setItem(KEY, value);
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
            {t("legalCookies")}
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => decide("rejected")}
            className="min-h-11 rounded-md border border-border px-3 py-1.5 text-caption font-semibold text-ink-soft hover:border-[var(--gold-deep)]"
          >
            {t("cc_essentials")}
          </button>
          <button
            onClick={() => decide("accepted")}
            className="min-h-11 rounded-md gold-gradient px-4 py-1.5 text-caption font-semibold text-ink"
          >
            {t("cc_accept")}
          </button>
        </div>
      </div>
    </div>
  );
}