import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

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
      { title: "إلغاء الاشتراك · Unsubscribe — وحدة القيمة" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [token, setToken] = useState<string>("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(t);
    if (!t) {
      setState({ kind: "invalid" });
      return;
    }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(t)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) return setState({ kind: "invalid" });
        if (body.valid === false && body.reason === "already_unsubscribed")
          return setState({ kind: "already" });
        if (body.valid) return setState({ kind: "valid" });
        setState({ kind: "invalid" });
      })
      .catch(() => setState({ kind: "error", message: "تعذّر الاتصال بالخادم." }));
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
      setState({ kind: "error", message: body.error ?? "حدث خطأ." });
    } catch {
      setState({ kind: "error", message: "تعذّر الاتصال بالخادم." });
    }
  }

  return (
    <div dir="rtl" className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-16">
      <div className="w-full rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 h-px w-16 hairline-gold" />
        <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--gold-deep)]">Value · Unit</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">إلغاء الاشتراك</h1>
        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-ink-soft">Unsubscribe</p>
        <div className="mt-6 text-sm leading-7 text-ink">
          {state.kind === "loading" && <p>جارٍ التحقّق من الرابط…</p>}
          {state.kind === "invalid" && (
            <p className="text-[color:var(--burgundy)]">
              الرابط غير صالح أو منتهي الصلاحية.
              <br />
              <span className="text-xs text-ink-soft">This link is invalid or has expired.</span>
            </p>
          )}
          {state.kind === "already" && (
            <p>
              تم إلغاء اشتراكك من قبل. لن تصلك رسائل تسويقية أو تنبيهات بعد الآن.
              <br />
              <span className="text-xs text-ink-soft">You are already unsubscribed.</span>
            </p>
          )}
          {state.kind === "valid" && (
            <>
              <p>
                هل تودّ إلغاء الاشتراك من بريد وحدة القيمة؟
                <br />
                <span className="text-xs text-ink-soft">
                  Confirm to stop receiving emails from Value Unit.
                </span>
              </p>
              <button
                onClick={confirm}
                className="mt-6 inline-flex items-center rounded-md border border-[var(--gold-deep)] bg-ink px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ivory transition hover:opacity-90"
              >
                تأكيد إلغاء الاشتراك · Confirm
              </button>
            </>
          )}
          {state.kind === "submitting" && <p>جارٍ التنفيذ…</p>}
          {state.kind === "done" && (
            <p>
              تم إلغاء اشتراكك بنجاح.
              <br />
              <span className="text-xs text-ink-soft">You have been unsubscribed.</span>
            </p>
          )}
          {state.kind === "error" && (
            <p className="text-[color:var(--burgundy)]">{state.message}</p>
          )}
        </div>
        <p className="mt-8 text-[10px] uppercase tracking-[0.24em] text-[var(--gold-deep)]">Value Unit</p>
      </div>
    </div>
  );
}