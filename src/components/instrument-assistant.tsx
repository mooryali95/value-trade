import { useRef, useState } from "react";
import { ChatCircleText, PaperPlaneRight, Stop } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, type Key } from "@/lib/i18n";
import { useSignedIn } from "@/hooks/use-signed-in";
import { Panel } from "@/components/market-panels";
import { LiveRegion } from "@/components/live-region";

const QUICK: Key[] = ["ai_qSummary", "ai_qRisks", "ai_qPrice"];

/** "Ask about this asset": streamed, data-grounded answers for one instrument. */
export function InstrumentAssistant({ slug }: { slug: string }) {
  const { t, lang } = useI18n();
  const signedIn = useSignedIn();
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Key | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 2 || busy) return;
    setAsked(text); setAnswer(""); setError(null); setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/instrument-assistant", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify({ slug, question: text, lang }),
      });
      if (!res.ok || !res.body) {
        setError(res.status === 429 ? "ai_errLimit" : res.status === 402 || res.status === 403 ? "ai_errCredits" : res.status === 401 ? "ai_signIn" : "ai_errGeneric");
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setAnswer((a) => a + dec.decode(value, { stream: true }));
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError("ai_errGeneric");
    } finally {
      setBusy(false); abort.current = null;
    }
  }

  return (
    <Panel title={t("ai_title")}>
      <p className="mb-3 text-xs text-muted-foreground">{t("ai_desc")}</p>
      {signedIn === false ? (
        <Link to="/auth" className="inline-flex min-h-11 items-center rounded-md gold-gradient px-5 text-sm font-semibold text-ink">
          {t("ai_signIn")}
        </Link>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {QUICK.map((k) => (
              <button key={k} type="button" disabled={busy} onClick={() => { setQuestion(t(k)); ask(t(k)); }}
                className="inline-flex min-h-9 items-center rounded-full border border-border bg-card px-3 text-xs font-medium text-ink-soft hover:border-[var(--gold)]/50 disabled:opacity-50">
                {t(k)}
              </button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); ask(question); }} className="flex items-end gap-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(question); } }}
              placeholder={t("ai_placeholder")}
              aria-label={t("ai_placeholder")}
              maxLength={1000}
              rows={2}
              className="min-h-11 flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-ink focus:border-[var(--gold)] focus:outline-none"
            />
            {busy ? (
              <button type="button" onClick={() => abort.current?.abort()} aria-label={t("ai_stop")}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border bg-card text-ink"><Stop size={18} weight="fill" /></button>
            ) : (
              <button type="submit" aria-label={t("ai_ask")} disabled={question.trim().length < 2}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-md gold-gradient text-ink disabled:opacity-50"><PaperPlaneRight size={18} weight="fill" className="rtl:-scale-x-100" /></button>
            )}
          </form>
          {/* The answer streams in chunks; announce it once, when complete. */}
          <LiveRegion message={!busy && !error ? answer : busy ? t("ai_thinking") : ""} />
          {(asked || error) && (
            <div className="mt-4 space-y-2">
              {asked && (
                <div className="ms-auto w-fit max-w-[85%] rounded-lg bg-ink px-3 py-2 text-sm text-ivory">{asked}</div>
              )}
              {error ? (
                <p role="alert" className="text-sm text-[var(--bear)]">{t(error)}</p>
              ) : (
                <div className="flex gap-2">
                  <ChatCircleText size={20} weight="duotone" className="mt-0.5 shrink-0 text-[var(--gold-deep)]" aria-hidden />
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{answer || (busy ? t("ai_thinking") : "")}</div>
                </div>
              )}
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">{t("ai_disclaimer")}</p>
        </>
      )}
    </Panel>
  );
}
