import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { Badge } from "@/components/badge";
import { useI18n } from "@/lib/i18n";
import { errorCode, useErrorMessage } from "@/hooks/use-error-message";
import { companyRoleHintKey, companyRoleKey } from "@/lib/tenants/role-labels";
import { formatDay } from "@/lib/account/dates";
import { listMyInvitations, acceptInvitation } from "@/lib/tenants/invitations.functions";
import { toast } from "sonner";

// Older invitation e-mails link to /invitations?token=<uuid>: those open the
// invitation page, which also works before an account exists.
const SearchSchema = z.object({ token: z.string().uuid().optional().catch(undefined) });

export const Route = createFileRoute("/_authenticated/invitations")({
  validateSearch: (s: Record<string, unknown>) => SearchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "الدعوات — وحدة القيمة | Invitations — Value Unit" },
      { name: "description", content: "دعوات الانضمام إلى الشركات." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: InvitationsPage,
});

function InvitationsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listMyInvitations);
  const acceptFn = useServerFn(acceptInvitation);
  const errorMessage = useErrorMessage();
  const { token: linkToken } = Route.useSearch();

  useEffect(() => {
    if (linkToken) navigate({ to: "/invite/$token", params: { token: linkToken }, replace: true });
  }, [linkToken, navigate]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["my-invitations"],
    queryFn: () => listFn(),
    enabled: !linkToken,
    retry: (count, e) => errorCode(e) !== "EMAIL_NOT_CONFIRMED" && count < 1,
  });

  const acceptMut = useMutation({
    mutationFn: (token: string) => acceptFn({ data: { token } }),
    onSuccess: (res) => {
      toast.success(t("inviteAccepted"));
      for (const key of ["my-invitations", "my-companies", "my-roles", "account-status"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      try {
        window.localStorage.setItem("value.activeCompanyId", res.companyId);
      } catch {
        // storage blocked: the first company is selected instead
      }
      navigate({ to: "/company/settings" });
    },
    onError: (e: unknown) => {
      toast.error(errorMessage(e, { INVITATION_NOT_PENDING: "inviteNotPending" }));
      qc.invalidateQueries({ queryKey: ["my-invitations"] });
    },
  });

  if (linkToken || isLoading) return <AppShell><LuxurySkeleton lines={5} /></AppShell>;
  if (isError && errorCode(error) === "EMAIL_NOT_CONFIRMED") {
    return (
      <AppShell>
        <PageHeader eyebrow={t("incomingInvitations")} title={t("incomingInvitations")} crumbs={[{ label: t("incomingInvitations") }]} />
        <EmptyState title={t("r_errEmailNotConfirmed")} description={t("r_invitationsConfirmEmailDesc")} />
      </AppShell>
    );
  }
  if (isError) return <AppShell><div className="py-16"><ErrorState description={errorMessage(error)} reset={() => refetch()} /></div></AppShell>;

  const rows = data ?? [];
  const fmtDate = (iso: string) => formatDay(iso, lang);

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("incomingInvitations")}
        title={t("incomingInvitations")}
        description={t("r_invitationsDesc")}
        crumbs={[{ label: t("incomingInvitations") }]}
      />

      {rows.length === 0 ? (
        <EmptyState
          title={t("noIncomingInvitations")}
          description={t("r_invitationsEmptyDesc")}
          action={
            <Link to="/request-access" className="text-xs font-semibold text-[var(--gold-deep)] underline">
              {t("requestAccess")}
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-3">
          {rows.map((inv) => {
            const company = inv.companies;
            const expired = inv.status === "expired";
            const roleKey = companyRoleKey(inv.role);
            const hintKey = companyRoleHintKey(inv.role);
            return (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {company ? (lang === "ar" ? company.name_ar : company.name_en) : "—"}
                    </span>
                    {expired && <Badge variant="bear">{t("r_statusExpired")}</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {roleKey ? t(roleKey) : inv.role}
                    {hintKey && <> · {t(hintKey)}</>}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {expired ? t("r_inviteExpiredOn").replace("{date}", fmtDate(inv.expires_at)) : t("r_inviteValidUntil").replace("{date}", fmtDate(inv.expires_at))}
                  </div>
                  {expired && <p className="mt-1 text-[11px] text-muted-foreground">{t("r_inviteExpiredDesc")}</p>}
                </div>
                {!expired && (
                  <button
                    disabled={acceptMut.isPending}
                    onClick={() => acceptMut.mutate(inv.token)}
                    className="min-h-9 rounded-md gold-gradient px-4 text-xs font-semibold text-ink disabled:opacity-50"
                  >
                    {t("accept")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
