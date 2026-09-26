import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useErrorMessage } from "@/hooks/use-error-message";
import { BrandMark } from "@/components/brand-mark";
import { authErrorCode, authRedirectErrorCode, type AuthErrorCode } from "@/lib/security/auth-errors";
import { hasPasswordIdentity, openedFromMailboxLink, passwordIssue, PASSWORD_MIN_LENGTH } from "@/lib/security/password-policy";
import { safeRedirect } from "@/lib/security/redirect";
import { requestPasswordReset } from "@/lib/account/password.functions";
import { Loader2, KeyRound, CheckCircle2, ShieldAlert } from "lucide-react";

const searchSchema = z.object({
  flow: z.enum(["invite", "recovery"]).optional().catch(undefined),
  next: z.string().max(2048).optional().catch(undefined),
});

export const Route = createFileRoute("/auth_/update-password")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "كلمة المرور — وحدة القيمة | Password — Value Unit" },
      { name: "description", content: "اختر كلمة مرور لحسابك في وحدة القيمة. · Choose a password for your Value Unit account." },
      { property: "og:title", content: "Password — Value Unit" },
      { property: "og:description", content: "Choose a password for your Value Unit account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UpdatePasswordPage,
});

/**
 * Where people choose a password:
 *  - "link": the page was opened from a recovery or invitation e-mail link
 *    (PASSWORD_RECOVERY event, or a session whose sign-in method is that
 *    link, less than an hour ago). No current password is asked.
 *  - "reauth": a normal signed-in session with a password. The current
 *    password is checked first, so an unattended session cannot change it.
 *  - "no_password": a Google-only account outside a link: it can get a
 *    set-password link by e-mail instead.
 *  - "link_error": the link was expired, already used or invalid.
 *  - "no_session": nobody is signed in and there is no link.
 */
type Mode = "checking" | "link" | "reauth" | "no_password" | "link_error" | "no_session" | "done";

function UpdatePasswordPage() {
  const { t, dir } = useI18n();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const resetFn = useServerFn(requestPasswordReset);
  const flow = search.flow ?? "recovery";
  const next = safeRedirect(search.next, "/");
  const [mode, setMode] = useState<Mode>("checking");
  const [linkError, setLinkError] = useState<AuthErrorCode | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recovered = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // Errors Supabase appends to the redirect of an expired or used link.
    const urlError =
      typeof window !== "undefined"
        ? authRedirectErrorCode(window.location.hash) ?? authRedirectErrorCode(window.location.search)
        : null;

    const classify = (session: Session | null) => {
      if (cancelled) return;
      if (!session) {
        if (urlError) {
          setLinkError(urlError);
          setMode("link_error");
        } else {
          setMode((m) => (m === "checking" ? "no_session" : m));
        }
        return;
      }
      setEmail(session.user.email ?? null);
      const nextMode: Mode =
        recovered.current || openedFromMailboxLink(session.access_token)
          ? "link"
          : hasPasswordIdentity(session.user)
            ? "reauth"
            : "no_password";
      // Once the password is set, later auth events do not change the page.
      setMode((m) => (m === "done" ? m : m === "link" && nextMode === "reauth" ? m : nextMode));
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") recovered.current = true;
      if (event === "SIGNED_OUT") {
        if (!cancelled) setMode((m) => (m === "done" ? m : "no_session"));
        return;
      }
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        classify(session);
      }
    });
    // The client parses the link's tokens on start; give it a moment before
    // concluding that there is no session.
    const timer = setTimeout(() => {
      supabase.auth.getSession().then(({ data }) => classify(data.session));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const issue = passwordIssue(password, confirm);
    if (issue) {
      setError(errorMessage(new Error(issue)));
      return;
    }
    setLoading(true);
    try {
      if (mode === "reauth") {
        if (!email || !current) throw new Error("AUTH_INVALID_CREDENTIALS");
        const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: current });
        if (authErr) throw new Error(authErrorCode(authErr));
      }
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw new Error(authErrorCode(updErr));
      // Every other device signed in to this account is signed out.
      await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
      setMode("done");
      setCurrent("");
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(errorMessage(err, undefined, "r_authFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function sendSetPasswordLink() {
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      await resetFn({ data: { email } });
      setNotice(t("r_pwLinkSentToYou"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const title = flow === "invite" ? t("r_pwCreateTitle") : mode === "reauth" ? t("r_pwChangeTitle") : t("updatePassword");
  const backToInvite = next.startsWith("/invite/");

  return (
    <main dir={dir} className="flex min-h-dvh items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center gap-3">
          <BrandMark size={40} />
        </Link>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>

        {mode === "checking" ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("loading")}
          </div>
        ) : mode === "link_error" || mode === "no_session" ? (
          <div className="mt-6 space-y-3">
            <p role="alert" className="flex items-start gap-2 rounded-md border border-[var(--bear)]/40 bg-[var(--bear)]/5 px-3 py-2 text-xs leading-relaxed text-[var(--bear)]">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{mode === "link_error" && linkError ? errorMessage(new Error(linkError)) : t("resetSessionMissing")}</span>
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {backToInvite ? t("r_pwExpiredInviteHint") : t("r_pwExpiredRecoveryHint")}
            </p>
            <div className="flex flex-wrap gap-2">
              {backToInvite ? (
                <a
                  href={next}
                  className="inline-flex min-h-11 items-center rounded-md gold-gradient px-4 text-sm font-semibold text-ink"
                >
                  {t("r_pwBackToInvitation")}
                </a>
              ) : (
                <Link
                  to="/auth"
                  search={{ mode: "forgot", redirect: undefined }}
                  className="inline-flex min-h-11 items-center rounded-md gold-gradient px-4 text-sm font-semibold text-ink"
                >
                  {t("r_pwRequestNewLink")}
                </Link>
              )}
              <Link
                to="/auth"
                search={{ redirect: undefined, mode: undefined }}
                className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm text-ink"
              >
                {t("backToSignin")}
              </Link>
            </div>
          </div>
        ) : mode === "done" ? (
          <div className="mt-6 space-y-4">
            <p className="flex items-start gap-2 rounded-md border border-[var(--bull)]/40 bg-[var(--bull)]/5 px-3 py-2 text-sm leading-relaxed text-[var(--bull)]" role="status">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{t("r_pwUpdatedOthersSignedOut")}</span>
            </p>
            <button
              type="button"
              onClick={() => navigate({ href: next, replace: true })}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md gold-gradient text-sm font-semibold text-ink"
            >
              {backToInvite ? t("r_pwContinueToInvitation") : t("r_continue")}
            </button>
          </div>
        ) : mode === "no_password" ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm leading-relaxed text-ink-soft">{t("r_pwGoogleOnly")}</p>
            <div aria-live="polite" aria-atomic="true">
              {error && <p role="alert" className="rounded-md border border-[var(--bear)]/40 bg-[var(--bear)]/5 px-3 py-2 text-xs text-[var(--bear)]">{error}</p>}
              {notice && <p className="rounded-md border border-[var(--bull)]/40 bg-[var(--bull)]/5 px-3 py-2 text-xs text-[var(--bull)]">{notice}</p>}
            </div>
            <button
              type="button"
              disabled={loading || !email || !!notice}
              onClick={() => void sendSetPasswordLink()}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md gold-gradient text-sm font-semibold text-ink disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t("r_pwSendSetLink")}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-3" noValidate>
            {email && (
              <p className="text-xs text-muted-foreground">
                {t("r_pwForAccount")} <span dir="ltr" className="font-medium text-ink">{email}</span>
              </p>
            )}
            {mode === "reauth" && (
              <PasswordField
                label={t("r_pwCurrent")}
                value={current}
                onChange={setCurrent}
                autoComplete="current-password"
              />
            )}
            <PasswordField label={t("newPassword")} value={password} onChange={setPassword} autoComplete="new-password" describedBy="pw-rules" />
            <PasswordField label={t("confirmPassword")} value={confirm} onChange={setConfirm} autoComplete="new-password" />
            <p id="pw-rules" className="text-[11px] leading-relaxed text-muted-foreground">
              {t("r_pwRules").replace("{n}", String(PASSWORD_MIN_LENGTH))}
            </p>

            <div aria-live="polite" aria-atomic="true">
              {error && (
                <div role="alert" className="rounded-md border border-[var(--bear)]/40 bg-[var(--bear)]/5 px-3 py-2 text-xs leading-relaxed text-[var(--bear)]">
                  {error}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md gold-gradient text-sm font-semibold text-ink disabled:opacity-70"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {flow === "invite" ? t("r_pwCreateCta") : t("updatePassword")}
            </button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("r_pwOthersSignedOutNote")}</p>
          </form>
        )}
      </div>
    </main>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  describedBy?: string;
}) {
  return (
    <label className="block rounded-md border border-input bg-card px-3 py-2 shadow-sm focus-within:border-primary/60">
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <input
          type="password"
          required
          autoComplete={autoComplete}
          aria-label={label}
          aria-describedby={describedBy}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-sm text-ink outline-none"
          placeholder="••••••••"
          dir="ltr"
        />
      </div>
    </label>
  );
}
