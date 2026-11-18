import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { BrandMark } from "@/components/brand-mark";

type State =
  | { kind: "loading" }
  | { kind: "valid" }
  | { kind: "already" }
  | { kind: "invalid" }
  | { kind: "submitting" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export const Route = createFileRoute("/unsubscribe")({
  head: () => ({
    meta: [
      { name: "description", content: "إلغاء الاشتراك · Unsubscribe — وحدة القيمة — متابعة وإدارة الخدمة على منصة وحدة القيمة." },
      { property: "og:title", content: "إلغاء الاشتراك · Unsubscribe — وحدة القيمة" },
      { property: "og:description", content: "إلغاء الاشتراك · Unsubscribe — وحدة القيمة — متابعة وإدارة الخدمة على منصة وحدة القيمة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "إلغاء الاشتراك · Unsubscribe — وحدة القيمة" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { t, dir } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [token, setToken] = useState<string>("");

  useEffect(() => {
    const tok = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(tok);
    if (!tok) {
      setState({ kind: "invalid" });
      return;
    }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(tok)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) return setState({ kind: "invalid" });
        if (body.valid === false && body.reason === "already_unsubscribed")
          return setState({ kind: "already" });
        if (body.valid) return setState({ kind: "valid" });
        setState({ kind: "invalid" });
      })
      .catch(() => setState({ kind: "error", message: "network" }));
  }, []);

  async function confirm() {
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/email/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.success) return setState({ kind: "done" });
      if (body.reason === "already_unsubscribed") return setState({ kind: "already" });
      setState({ kind: "error", message: "failed" });
    } catch {
      setState({ kind: "error", message: "network" });
    }
  }

  return (
    <div dir={dir} className="mx-auto flex min-h-dvh max-w-lg items-center px-4 py-16 sm:px-6">
      <div className="w-full rounded-2xl border border-border/70 bg-card p-6 text-center shadow-card sm:p-8">
        <div className="flex justify-center">
          <BrandMark size={34} />
        </div>
        <div className="mx-auto my-5 h-px w-16 hairline-gold" />
        <h1 className="text-2xl font-bold text-ink">{t("u_unsubTitle")}</h1>
        <div className="mt-5 text-sm leading-7 text-ink" role="status" aria-live="polite" aria-atomic="true">
          {state.kind === "loading" && <p>{t("u_unsubChecking")}</p>}
          {state.kind === "invalid" && <p className="text-[color:var(--burgundy)]">{t("u_unsubInvalid")}</p>}
          {state.kind === "already" && <p>{t("u_unsubAlready")}</p>}
          {state.kind === "valid" && (
            <>
              <p>{t("u_unsubConfirmQ")}</p>
              <button
                type="button"
                onClick={confirm}
                className="mt-6 inline-flex min-h-11 items-center rounded-md gold-gradient px-6 text-sm font-semibold text-ink transition hover:brightness-105"
              >
                {t("u_unsubConfirm")}
              </button>
            </>
          )}
          {state.kind === "submitting" && <p>{t("u_unsubWorking")}</p>}
          {state.kind === "done" && <p>{t("u_unsubDone")}</p>}
          {state.kind === "error" && (
            <p className="text-[color:var(--burgundy)]">
              {state.message === "network" ? t("u_unsubNetwork") : t("u_unsubFailed")}
            </p>
          )}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
          <Link to="/" className="inline-flex min-h-9 items-center text-[var(--gold-ink)] underline-offset-4 hover:underline">
            {t("backHome")}
          </Link>
          <Link to="/legal/privacy" className="inline-flex min-h-9 items-center text-ink-soft underline-offset-4 hover:underline">
            {t("legalPrivacy")}
          </Link>
        </div>
      </div>
    </div>
  );
}
