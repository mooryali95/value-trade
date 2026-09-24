import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { BrandMark } from "@/components/brand-mark";
import { Loader2, KeyRound } from "lucide-react";

export const Route = createFileRoute("/auth_/update-password")({
  head: () => ({
    meta: [
      { title: "تحديث كلمة المرور — وحدة القيمة | Update password" },
      { name: "description", content: "اختر كلمة مرور جديدة لحسابك في وحدة القيمة." },
      { property: "og:title", content: "Update password — Value Unit" },
      { property: "og:description", content: "Set a new password for your Value Unit account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UpdatePasswordPage,
});

function UpdatePasswordPage() {
  const { t, dir } = useI18n();
  const navigate = useNavigate();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The recovery link hands us a session; without one there is nothing to update.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setReady(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) setReady(true);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("passwordsDontMatch"));
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setNotice(t("passwordUpdated"));
      setTimeout(() => navigate({ to: "/", replace: true }), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main dir={dir} className="flex min-h-dvh items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center gap-3">
          <BrandMark size={40} />
          <span className="text-lg font-bold text-ink">{t("brand")}</span>
        </Link>
        <h1 className="text-2xl font-bold text-ink">{t("updatePassword")}</h1>

        {ready === false ? (
          <div className="mt-6 space-y-3">
            <p className="rounded-md border border-[var(--bear)]/40 bg-[var(--bear)]/5 px-3 py-2 text-xs text-[var(--bear)]">
              {t("resetSessionMissing")}
            </p>
            <Link
              to="/auth"
              search={{ redirect: undefined }}
              className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm text-ink"
            >
              {t("backToSignin")}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-3">
            <label className="block rounded-md border border-input bg-card px-3 py-2 shadow-sm focus-within:border-primary/60">
              <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("newPassword")}
              </div>
              <div className="flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  aria-label={t("newPassword")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-transparent text-sm text-ink outline-none"
                  placeholder="••••••••"
                />
              </div>
            </label>
            <label className="block rounded-md border border-input bg-card px-3 py-2 shadow-sm focus-within:border-primary/60">
              <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("confirmPassword")}
              </div>
              <div className="flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  aria-label={t("confirmPassword")}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full bg-transparent text-sm text-ink outline-none"
                  placeholder="••••••••"
                />
              </div>
            </label>

            <div aria-live="polite" aria-atomic="true">
              {error && (
                <div className="rounded-md border border-[var(--bear)]/40 bg-[var(--bear)]/5 px-3 py-2 text-xs text-[var(--bear)]">
                  {error}
                </div>
              )}
              {notice && (
                <div className="rounded-md border border-[var(--bull)]/40 bg-[var(--bull)]/5 px-3 py-2 text-xs text-[var(--bull)]">
                  {notice}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || ready === null}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md gold-gradient text-sm font-semibold text-ink disabled:opacity-70"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("updatePassword")}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
