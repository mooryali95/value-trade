import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { listMyInvitations, acceptInvitation } from "@/lib/tenants/invitations.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/invitations")({
  head: () => ({
    meta: [
      { title: "الدعوات — قيمة | Invitations — Value Unit" },
      { name: "description", content: "دعوات الانضمام إلى الشركات." },
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
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
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

      {(!data || data.length === 0) ? (
        <EmptyState title={t("noIncomingInvitations")} description={t("noCompaniesDesc")} />
      ) : (
        <ul className="grid gap-3">
          {data.map((inv) => {
            const company = (inv as unknown as { companies: { name_ar: string; name_en: string; slug: string } }).companies;
            return (
              <li key={inv.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-4">
                <div>
                  <div className="text-sm font-semibold text-ink">{lang === "ar" ? company.name_ar : company.name_en}</div>
                  <div className="text-[11px] uppercase text-muted-foreground">
                    {company.slug} · {t(`${inv.role}Role` as never)} · {t("inviteExpires")} {new Date(inv.expires_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}
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