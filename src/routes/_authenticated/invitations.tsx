import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { useErrorMessage } from "@/hooks/use-error-message";
import { listMyInvitations, acceptInvitation } from "@/lib/tenants/invitations.functions";
import { toast } from "sonner";

// The invitation email links to /invitations?token=<uuid>.
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

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["my-invitations"],
    queryFn: () => listFn(),
  });

  const acceptMut = useMutation({
    mutationFn: (token: string) => acceptFn({ data: { token } }),
    onSuccess: () => {
      toast.success(t("inviteAccepted"));
      qc.invalidateQueries({ queryKey: ["my-invitations"] });
      qc.invalidateQueries({ queryKey: ["my-companies"] });
      navigate({ to: "/company/settings" });
    },
    onError: (e: unknown) => {
      toast.error(
        errorMessage(e, {
          INVITATION_EXPIRED: "inviteExpired",
          INVITATION_NOT_PENDING: "inviteNotPending",
          INVITATION_NOT_FOUND: "errInvitationNotFound",
          INVITATION_EMAIL_MISMATCH: "errInvitationEmailMismatch",
        }),
      );
      qc.invalidateQueries({ queryKey: ["my-invitations"] });
    },
  });

  if (isLoading) return <AppShell><LuxurySkeleton lines={5} /></AppShell>;
  if (isError) return <AppShell><div className="py-16"><ErrorState reset={() => refetch()} /></div></AppShell>;

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("incomingInvitations")}
        title={t("incomingInvitations")}
        crumbs={[{ label: t("incomingInvitations") }]}
      />

      {linkToken && !(data ?? []).some((inv) => inv.token === linkToken) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--gold-deep)]/40 bg-card p-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink">{t("inviteLinkTitle")}</div>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("inviteLinkDesc")}</p>
          </div>
          <button
            disabled={acceptMut.isPending}
            onClick={() => acceptMut.mutate(linkToken)}
            className="rounded-md gold-gradient px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
          >{t("accept")}</button>
        </div>
      )}

      {(!data || data.length === 0) ? (
        <EmptyState title={t("noIncomingInvitations")} description={t("noCompaniesDesc")} />
      ) : (
        <ul className="grid gap-3">
          {data.map((inv) => {
            const company = inv.companies;
            const fromLink = inv.token === linkToken;
            return (
              <li
                key={inv.id}
                aria-current={fromLink ? "true" : undefined}
                className={`flex items-center justify-between rounded-xl border bg-card p-4 ${fromLink ? "border-[var(--gold-deep)]" : "border-border/60"}`}
              >
                <div>
                  <div className="text-sm font-semibold text-ink">{company ? (lang === "ar" ? company.name_ar : company.name_en) : "—"}</div>
                  <div className="text-[11px] uppercase text-muted-foreground">
                    {company?.slug ?? ""} · {t(`${inv.role}Role` as never)} · {t("inviteExpires")} {new Date(inv.expires_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}
                  </div>
                </div>
                <button
                  disabled={acceptMut.isPending}
                  onClick={() => acceptMut.mutate(inv.token)}
                  className="rounded-md gold-gradient px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
                >{t("accept")}</button>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}