import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Building2, CheckCircle2, Clock3, Loader2, Mail, ShieldAlert, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useI18n } from "@/lib/i18n";
import { useErrorMessage } from "@/hooks/use-error-message";
import { BrandMark } from "@/components/brand-mark";
import { authErrorCode } from "@/lib/security/auth-errors";
import { clearPostAuthRedirect, stashPostAuthRedirect } from "@/lib/security/redirect";
import { companyRoleHintKey, companyRoleKey } from "@/lib/tenants/role-labels";
import { formatDay } from "@/lib/account/dates";
import { fill } from "@/lib/account/fill";
import {
  acceptInvitation,
  getInvitationPreview,
  sendInvitationAccountLink,
  type InvitationPreview,
} from "@/lib/tenants/invitations.functions";

const TokenSchema = z.string().uuid();

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [
      { property: "og:title", content: "دعوة — وحدة القيمة | Invitation — Value Unit" },
      { property: "og:description", content: "دعوة للانضمام إلى شركة على منصة وحدة القيمة. · An invitation to join a company on Value Unit." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "دعوة — وحدة القيمة | Invitation — Value Unit" },
      { name: "description", content: "دعوة للانضمام إلى شركة على منصة وحدة القيمة. · An invitation to join a company on Value Unit." },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: InvitePage,
});

type SessionInfo = { email: string | null } | null;

function InvitePage() {
  const { token } = Route.useParams();
  const valid = TokenSchema.safeParse(token).success;
  const { t, lang, dir } = useI18n();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const previewFn = useServerFn(getInvitationPreview);
  const linkFn = useServerFn(sendInvitationAccountLink);
  const acceptFn = useServerFn(acceptInvitation);
  const [session, setSession] = useState<SessionInfo | undefined>(undefined);
  const [linkSent, setLinkSent] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [mismatch, setMismatch] = useState(false);

  useEffect(() => {
    let mounted = true;
    // Signed in on this page: the post-sign-in target (this invitation) has
    // been reached, so it must not pull the user back here later.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) clearPostAuthRedirect();
      if (mounted) setSession(data.session ? { email: data.session.user.email ?? null } : null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) clearPostAuthRedirect();
      if (mounted) setSession(s ? { email: s.user.email ?? null } : null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const preview = useQuery({
    queryKey: ["invitation-preview", token],
    queryFn: () => previewFn({ data: { token } }),
    enabled: valid,
    retry: false,
    staleTime: 30_000,
  });

  const sendLink = useMutation({
    mutationFn: () => linkFn({ data: { token } }),
    onSuccess: () => {
      setLinkSent(true);
      setMessage(null);
    },
    onError: (e: unknown) => setMessage({ tone: "error", text: errorMessage(e) }),
  });

  const accept = useMutation({
    mutationFn: () => acceptFn({ data: { token } }),
    onSuccess: (res) => {
      clearPostAuthRedirect();
      for (const key of ["my-roles", "my-companies", "my-invitations", "account-status", "invitation-preview"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      try {
        window.localStorage.setItem("value.activeCompanyId", res.companyId);
      } catch {
        // storage blocked: the first company is selected instead
      }
      navigate({ to: "/company/settings", replace: true });
    },
    onError: (e: unknown) => {
      const code = e instanceof Error ? e.message : "";
      setMismatch(code === "INVITATION_EMAIL_MISMATCH");
      // The invitee's own wording (the default message addresses the owner).
      setMessage({ tone: "error", text: errorMessage(e, { ALREADY_MEMBER: "fx3_errAlreadyMemberInvitee" }) });
      qc.invalidateQueries({ queryKey: ["invitation-preview", token] });
    },
  });

  async function google() {
    setMessage(null);
    stashPostAuthRedirect(`/invite/${token}`);
    try {
      const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
      if (result.error) setMessage({ tone: "error", text: errorMessage(new Error(authErrorCode(result.error)), undefined, "r_authOAuthFailed") });
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(new Error(authErrorCode(err)), undefined, "r_authOAuthFailed") });
    }
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    setMismatch(false);
    setMessage(null);
  }

  const data: InvitationPreview | undefined = preview.data;
  const companyName =
    data && data.found ? (lang === "ar" ? data.companyNameAr || data.companyNameEn : data.companyNameEn || data.companyNameAr) : null;
  const roleKey = data && data.found ? companyRoleKey(data.role) : null;
  const roleHintKey = data && data.found ? companyRoleHintKey(data.role) : null;
  const fmtDate = (iso: string | null) =>
    formatDay(iso, lang, "long");

  return (
    <main dir={dir} className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg">
        <Link to="/" className="mb-8 flex items-center gap-3">
          <BrandMark size={40} />
        </Link>

        <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--gold)]/40 bg-background px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--gold-deep)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" aria-hidden />
            {t("r_inviteEyebrow")}
          </div>

          {!valid || (data && !data.found) ? (
            <Problem title={t("r_inviteInvalidTitle")} body={t("r_inviteInvalidDesc")} />
          ) : preview.isLoading || session === undefined ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("loading")}
            </div>
          ) : preview.isError ? (
            <Problem title={t("r_inviteLoadFailed")} body={errorMessage(preview.error)} />
          ) : data && data.found ? (
            <>
              {data.status === "revoked" ? (
                <Problem title={t("r_inviteInvalidTitle")} body={t("r_inviteRevokedDesc")} />
              ) : (
                <>
                  <h1 className="mt-2 text-2xl font-bold leading-snug text-ink">
                    {t("r_inviteTitle").replace("{company}", companyName ?? "—")}
                  </h1>
                  <dl className="mt-4 grid gap-2 text-sm">
                    <div className="flex items-start gap-2">
                      <Building2 className="mt-0.5 h-4 w-4 text-[var(--gold-deep)]" aria-hidden />
                      <dt className="sr-only">{t("r_inviteCompany")}</dt>
                      <dd className="text-ink">{companyName}</dd>
                    </div>
                    {roleKey && (
                      <div className="flex items-start gap-2">
                        <UserRound className="mt-0.5 h-4 w-4 text-[var(--gold-deep)]" aria-hidden />
                        <dt className="sr-only">{t("r_inviteRole")}</dt>
                        <dd>
                          <span className="font-medium text-ink">{t(roleKey)}</span>
                          {roleHintKey && <span className="block text-xs text-muted-foreground">{t(roleHintKey)}</span>}
                        </dd>
                      </div>
                    )}
                    {data.emailHint && (
                      <div className="flex items-start gap-2">
                        <Mail className="mt-0.5 h-4 w-4 text-[var(--gold-deep)]" aria-hidden />
                        <dt className="sr-only">{t("email")}</dt>
                        <dd className="text-ink-soft">
                          {t("r_inviteSentTo")} <span dir="ltr">{data.emailHint}</span>
                        </dd>
                      </div>
                    )}
                    {data.status === "pending" && data.expiresAt && (
                      <div className="flex items-start gap-2">
                        <Clock3 className="mt-0.5 h-4 w-4 text-[var(--gold-deep)]" aria-hidden />
                        <dt className="sr-only">{t("inviteExpires")}</dt>
                        <dd className="text-ink-soft">{t("r_inviteValidUntil").replace("{date}", fmtDate(data.expiresAt))}</dd>
                      </div>
                    )}
                  </dl>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("r_inviteTradingNote")}</p>

                  {data.status === "expired" ? (
                    <Problem title={t("r_inviteExpiredTitle")} body={t("r_inviteExpiredDesc")} />
                  ) : data.status === "accepted" ? (
                    <div className="mt-5 space-y-3">
                      <p className="flex items-start gap-2 rounded-md border border-[var(--bull)]/40 bg-[var(--bull)]/5 px-3 py-2 text-sm text-[var(--bull)]">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        {t("r_inviteAlreadyAccepted")}
                      </p>
                      <Link
                        to={session ? "/company/settings" : "/auth"}
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-md gold-gradient text-sm font-semibold text-ink"
                      >
                        {session ? t("r_inviteOpenCompany") : t("signin")}
                      </Link>
                    </div>
                  ) : session ? (
                    <div className="mt-5 space-y-3">
                      <p className="text-xs text-muted-foreground">
                        {t("r_inviteSignedInAs")} <span dir="ltr" className="font-medium text-ink">{session.email ?? "—"}</span>
                      </p>
                      <button
                        type="button"
                        disabled={accept.isPending}
                        onClick={() => {
                          setMessage(null);
                          accept.mutate();
                        }}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md gold-gradient text-sm font-semibold text-ink disabled:opacity-60"
                      >
                        {accept.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                        {t("r_inviteAccept")}
                      </button>
                      {mismatch && (
                        <button
                          type="button"
                          onClick={() => void signOut()}
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-border text-sm text-ink"
                        >
                          {t("r_inviteSignOutSwitch")}
                        </button>
                      )}
                    </div>
                  ) : linkSent ? (
                    <div className="mt-5 space-y-2" role="status">
                      <p className="flex items-start gap-2 rounded-md border border-[var(--bull)]/40 bg-[var(--bull)]/5 px-3 py-2 text-sm leading-relaxed text-[var(--bull)]">
                        <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>{fill(t("r_inviteLinkSent"), { email: <bdi dir="ltr">{data.emailHint ?? ""}</bdi> })}</span>
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{t("r_inviteLinkSentHint")}</p>
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      <p className="text-sm font-medium text-ink">{t("r_inviteHowToContinue")}</p>
                      <button
                        type="button"
                        disabled={sendLink.isPending}
                        onClick={() => {
                          setMessage(null);
                          sendLink.mutate();
                        }}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md gold-gradient text-sm font-semibold text-ink disabled:opacity-60"
                      >
                        {sendLink.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                        {t("r_inviteCreateAccount")}
                      </button>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("r_inviteCreateAccountHint")}</p>
                      <Link
                        to="/auth"
                        search={{ redirect: `/invite/${token}`, mode: undefined }}
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-border text-sm text-ink"
                      >
                        {t("r_inviteHaveAccount")}
                      </Link>
                      <button
                        type="button"
                        onClick={() => void google()}
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-border bg-card text-sm text-ink"
                      >
                        {t("r_inviteContinueGoogle")}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          ) : null}

          <div aria-live="polite" aria-atomic="true" className="mt-3">
            {message && (
              <p
                role={message.tone === "error" ? "alert" : undefined}
                className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${
                  message.tone === "error"
                    ? "border-[var(--bear)]/40 bg-[var(--bear)]/5 text-[var(--bear)]"
                    : "border-border bg-secondary/40 text-ink-soft"
                }`}
              >
                {message.text}
                {mismatch && data && data.found && data.emailHint && (
                  <span className="mt-1 block" dir="auto">
                    {fill(t("r_inviteMismatchHint"), { email: <bdi dir="ltr">{data.emailHint}</bdi> })}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 space-y-2" role="status">
      <p className="flex items-start gap-2 text-base font-semibold text-ink">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--bear)]" aria-hidden />
        {title}
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
