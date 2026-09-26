import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useI18n } from "@/lib/i18n";
import { useErrorMessage } from "@/hooks/use-error-message";
import { BrandMark } from "@/components/brand-mark";
import { ENABLE_LEGACY_SELF_SIGNUP } from "@/lib/config/feature-flags";
import { authErrorCode, authRedirectErrorCode } from "@/lib/security/auth-errors";
import { passwordIssue } from "@/lib/security/password-policy";
import { consumePostAuthRedirect, safeRedirect, stashPostAuthRedirect } from "@/lib/security/redirect";
import { requestPasswordReset } from "@/lib/account/password.functions";
import { Loader2, Mail, KeyRound, User as UserIcon, MailOpen, type LucideIcon } from "lucide-react";

const searchSchema = z.object({
  redirect: z.string().max(2048).optional().catch(undefined),
  mode: z.enum(["signin", "forgot"]).optional().catch(undefined),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "دخول — وحدة القيمة | Sign in — Value Unit" },
      {
        name: "description",
        content: "دخول أو إنشاء حساب في منصة وحدة القيمة. · Sign in to Value Unit.",
      },
      { property: "og:title", content: "Sign in — Value Unit" },
      { property: "og:description", content: "Access your Value Unit trading account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { t, dir } = useI18n();
  const errorMessage = useErrorMessage();
  const search = useSearch({ from: "/auth" }) as { redirect?: string; mode?: "signin" | "forgot" };
  const navigate = useNavigate();
  const resetFn = useServerFn(requestPasswordReset);
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">(search.mode === "forgot" ? "forgot" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const navigated = useRef(false);

  const target = safeRedirect(search.redirect);
  // Signing in on the way to an invitation (or from an older invitation
  // e-mail that linked to /invitations?token=...): people without an account
  // create it from the invitation page instead.
  const inviteToken =
    /^\/invite\/([0-9a-f-]{36})$/i.exec(target.split(/[?#]/)[0])?.[1] ??
    /^\/invitations\?(?:.*&)?token=([0-9a-f-]{36})(?:&|$)/i.exec(target)?.[1] ??
    null;

  // An e-mail link or the Google broker can come back with an error in the
  // URL (e.g. #error=access_denied&error_code=otp_expired): show it in the
  // user's language instead of failing silently.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const code = authRedirectErrorCode(window.location.hash) ?? authRedirectErrorCode(window.location.search);
    if (code) {
      setError(errorMessage(new Error(code)));
      try {
        const params = new URLSearchParams(window.location.search);
        for (const k of ["error", "error_code", "error_description"]) params.delete(k);
        const qs = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
      } catch {
        // ignore: the message is shown either way
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const go = () => {
      if (navigated.current) return;
      navigated.current = true;
      // `href` keeps the query of the target (e.g. /invitations?token=...).
      navigate({ href: consumePostAuthRedirect() ?? target, replace: true });
    };
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) go();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // A recovery link that lands here still has to choose a password.
      if (event === "PASSWORD_RECOVERY") {
        navigated.current = true;
        navigate({ to: "/auth/update-password", search: { flow: "recovery" }, replace: true });
        return;
      }
      if (session) go();
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, target]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "forgot") {
        await resetFn({ data: { email: email.trim() } });
        setNotice(t("resetLinkSent"));
      } else if (mode === "signup") {
        const issue = passwordIssue(password);
        if (issue) throw new Error(issue);
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName || email.split("@")[0] },
          },
        });
        if (error) throw new Error(authErrorCode(error));
        setNotice(t("auth_accountCreated"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error(authErrorCode(error));
      }
    } catch (err: unknown) {
      setError(errorMessage(err, undefined, "r_authFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    setError(null);
    // The broker returns to the site origin: remember where to go next.
    stashPostAuthRedirect(target);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        setError(errorMessage(new Error(authErrorCode(result.error)), undefined, "r_authOAuthFailed"));
        setLoading(false);
        return;
      }
      if (result.redirected) return;
      // Session set; effect above navigates
    } catch (err: unknown) {
      setError(errorMessage(new Error(authErrorCode(err)), undefined, "r_authOAuthFailed"));
      setLoading(false);
    }
  }

  return (
    <div dir={dir} className="min-h-dvh bg-background text-foreground">
      <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
        {/* Brand side */}
        <aside className="relative hidden overflow-hidden ivory-gradient lg:block">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(700px circle at 30% 30%, oklch(0.72 0.11 82 / 0.18), transparent 60%), radial-gradient(500px circle at 80% 80%, oklch(0.38 0.11 20 / 0.08), transparent 60%)",
            }}
          />
          {/* Decorative concentric rings */}
          <svg
            aria-hidden
            className="absolute inset-0 h-full w-full text-[var(--gold)]/25"
            viewBox="0 0 800 800"
            fill="none"
          >
            <circle cx="380" cy="420" r="120" stroke="currentColor" strokeWidth="0.8" />
            <circle cx="380" cy="420" r="200" stroke="currentColor" strokeWidth="0.6" />
            <circle cx="380" cy="420" r="290" stroke="currentColor" strokeWidth="0.5" />
            <circle cx="380" cy="420" r="380" stroke="currentColor" strokeWidth="0.4" />
            <circle cx="380" cy="420" r="14" fill="oklch(0.72 0.11 82)" />
            <line x1="0" y1="420" x2="800" y2="420" stroke="currentColor" strokeWidth="0.4" />
          </svg>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 end-0 w-px hairline-gold"
          />
          <div className="relative flex h-full flex-col justify-between p-12">
            <Link to="/" className="flex items-center gap-3 w-fit">
              <BrandMark size={44} />
            </Link>

            <div className="max-w-md">
              <div className="mb-4 h-px w-24 hairline-gold" />
              <h1 className="text-4xl font-bold leading-tight text-ink md:text-5xl">
                {t("authTagline")}
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t("authNote")}</p>
            </div>

            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              © {new Date().getFullYear()} · {t("brand")}
            </div>
          </div>
        </aside>

        {/* Form side */}
        <main className="flex items-center justify-center bg-background px-6 py-10">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <Link to="/" className="flex items-center gap-3">
                <BrandMark size={40} />
              </Link>
            </div>

            <div className="mb-6">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--gold)]/40 bg-card px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--gold-deep)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
                {mode === "forgot" ? t("forgotPasswordTitle") : mode === "signin" ? t("signin") : t("signup")}
              </div>
              <h2 className="text-2xl font-bold text-ink md:text-3xl">
                {mode === "forgot" ? t("forgotPasswordTitle") : mode === "signin" ? t("signinCta") : t("signupCta")}
              </h2>
            </div>

            {/* Tabs (only while self-service sign-up exists; sign-in alone needs none) */}
            {ENABLE_LEGACY_SELF_SIGNUP && (
            <div className="mb-2 grid grid-cols-2 rounded-lg border border-border bg-card p-1 text-sm font-medium">
              <button
                onClick={() => {
                  setMode("signin");
                  setError(null);
                  setNotice(null);
                }}
                className={`rounded-md py-2 transition ${mode === "signin" ? "bg-secondary text-ink" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t("signin")}
              </button>
              {ENABLE_LEGACY_SELF_SIGNUP && (
                <button
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                    setNotice(null);
                  }}
                  className={`rounded-md py-2 transition ${mode === "signup" ? "bg-secondary text-ink" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t("signup")}
                </button>
              )}
            </div>
            )}

            {inviteToken && (
              <div className="mb-3 rounded-md border border-[var(--gold-deep)]/40 bg-card px-3 py-2.5 text-xs leading-relaxed text-ink">
                <p>{t("r_authFromInvitation")}</p>
                <Link
                  to="/invite/$token"
                  params={{ token: inviteToken }}
                  className="mt-1 inline-block font-semibold text-[var(--gold-deep)] underline"
                >
                  {t("r_authOpenInvitation")}
                </Link>
              </div>
            )}

            <div className="mb-5 space-y-2 rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              <p className="flex items-start gap-2">
                <MailOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--gold-deep)]" aria-hidden />
                <span>{t("r_authInvitedHint")}</span>
              </p>
              <p>
                {t("r_authNoAccountHint")}{" "}
                <Link to="/request-access" className="font-medium text-[var(--gold-deep)] underline">
                  {t("requestAccess")}
                </Link>
              </p>
              {ENABLE_LEGACY_SELF_SIGNUP && mode === "signup" && (
                <span className="block mt-1 opacity-70">{t("signupLegacyNote")}</span>
              )}
            </div>

            {(mode !== "signup" || ENABLE_LEGACY_SELF_SIGNUP) && (
              <form onSubmit={handleEmail} className="space-y-3">
                {mode === "signup" && (
                  <Field icon={UserIcon} label={t("fullName")}>
                    <input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      aria-label={t("fullName")}
                      className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted-foreground"
                      placeholder={t("auth_fullName")}
                    />
                  </Field>
                )}
                <Field icon={Mail} label={t("email")}>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    aria-label={t("email")}
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted-foreground"
                    placeholder="you@company.com"
                  />
                </Field>
                {mode === "forgot" && (
                  <p className="text-xs leading-relaxed text-muted-foreground">{t("r_forgotHint")}</p>
                )}
                {mode !== "forgot" && (
                <Field icon={KeyRound} label={t("password")}>
                  <input
                    type="password"
                    required
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    minLength={mode === "signin" ? undefined : 8}
                    aria-label={t("password")}
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted-foreground"
                    placeholder="••••••••"
                  />
                </Field>
                )}

                <div aria-live="polite" aria-atomic="true" className="space-y-2">
                  {error && (
                    <div role="alert" className="rounded-md border border-[var(--bear)]/40 bg-[var(--bear)]/5 px-3 py-2 text-xs leading-relaxed text-[var(--bear)]">
                      {error}
                    </div>
                  )}
                  {notice && (
                    <div className="rounded-md border border-[var(--bull)]/40 bg-[var(--bull)]/5 px-3 py-2 text-xs leading-relaxed text-[var(--bull)]">
                      {notice}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md gold-gradient py-2.5 text-sm font-semibold text-ink shadow-sm transition hover:brightness-105 disabled:opacity-70"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {mode === "forgot"
                    ? t("forgotPasswordCta")
                    : mode === "signin"
                      ? t("signinCta")
                      : t("signupCta")}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === "forgot" ? "signin" : "forgot");
                    setError(null);
                    setNotice(null);
                  }}
                  className="mx-auto block min-h-11 px-2 text-[11px] text-muted-foreground underline hover:text-[var(--gold-deep)]"
                >
                  {mode === "forgot" ? t("backToSignin") : t("forgotPassword")}
                </button>
              </form>
            )}

            <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              {t("orContinueWith")}
              <div className="h-px flex-1 bg-border" />
            </div>

            <button
              onClick={handleGoogle}
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2.5 rounded-md border border-border bg-card py-2.5 text-sm font-medium text-ink shadow-sm transition hover:border-primary/60 hover:bg-secondary disabled:opacity-70"
            >
              <GoogleIcon />
              {t("google")}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <label className="block rounded-md border border-input bg-card px-3 py-2 shadow-sm transition focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30">
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {children}
      </div>
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.6 14.7 2.6 12 2.6 6.8 2.6 2.6 6.8 2.6 12S6.8 21.4 12 21.4c6.9 0 11.5-4.9 11.5-11.7 0-.8-.1-1.4-.2-2H12z"
      />
      <path
        fill="#4285F4"
        d="M23.3 12c0-.8-.1-1.4-.2-2H12v3.9h6.4c-.3 1.5-1.2 2.7-2.5 3.6l4 3.1c2.3-2.1 3.4-5.2 3.4-8.6z"
      />
      <path
        fill="#FBBC05"
        d="M6.2 14.3c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9L2 7.4C1.3 8.8 1 10.3 1 12s.3 3.2 1 4.6l4.2-2.3z"
      />
      <path
        fill="#34A853"
        d="M12 21.4c3.2 0 5.9-1.1 7.9-2.9l-4-3.1c-1.1.7-2.4 1.2-3.9 1.2-3 0-5.5-2-6.4-4.7L1.4 14.2C3.4 18.4 7.4 21.4 12 21.4z"
      />
    </svg>
  );
}
