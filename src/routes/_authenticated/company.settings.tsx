import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { useActiveCompany } from "@/hooks/use-active-company";
import {
  listMyCompanies, createCompany, getCompanyDetails,
  addCompanyMember, removeCompanyMember, addCompanyBrand, removeCompanyBrand,
} from "@/lib/tenants/company.functions";
import {
  listCompanyInvitations, createInvitation, revokeInvitation,
  resendInvitationEmail,
} from "@/lib/tenants/invitations.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/company/settings")({
  head: () => ({
    meta: [
      { title: "إعدادات الشركة — قيمة" },
      { name: "description", content: "أدر أعضاء شركتك وبرانداتها وطروحاتها." },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: CompanySettings,
});

function CompanySettings() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listMyCompanies);
  const createFn = useServerFn(createCompany);
  const detailsFn = useServerFn(getCompanyDetails);
  const addMemberFn = useServerFn(addCompanyMember);
  const removeMemberFn = useServerFn(removeCompanyMember);
  const addBrandFn = useServerFn(addCompanyBrand);
  const removeBrandFn = useServerFn(removeCompanyBrand);
  const listInvitesFn = useServerFn(listCompanyInvitations);
  const createInviteFn = useServerFn(createInvitation);
  const revokeInviteFn = useServerFn(revokeInvitation);
  const resendInviteFn = useServerFn(resendInvitationEmail);

  const list = useQuery({ queryKey: ["my-companies"], queryFn: () => listFn() });
  const { activeId: globalActiveId, setActive } = useActiveCompany();
  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? globalActiveId ?? list.data?.[0]?.company?.id ?? null;

  const details = useQuery({
    queryKey: ["company-details", activeId],
    queryFn: () => detailsFn({ data: { companyId: activeId! } }),
    enabled: !!activeId,
  });

  const [newCo, setNewCo] = useState({ slug: "", name_ar: "", name_en: "" });
  const [newMember, setNewMember] = useState({ userId: "", role: "viewer" as const });
  const [newBrand, setNewBrand] = useState("");
  const [newInvite, setNewInvite] = useState({ email: "", role: "viewer" as "owner"|"finance"|"shariah"|"trader"|"viewer" });

  const invitesQ = useQuery({
    queryKey: ["company-invitations", activeId],
    queryFn: () => listInvitesFn({ data: { companyId: activeId! } }),
    enabled: !!activeId,
  });
  const invalidateInvites = () => qc.invalidateQueries({ queryKey: ["company-invitations", activeId] });
  const inviteMut = useMutation({
    mutationFn: (v: { email: string; role: "finance"|"shariah"|"trader"|"viewer" }) =>
      createInviteFn({ data: { companyId: activeId!, email: v.email, role: v.role, origin: typeof window !== "undefined" ? window.location.origin : undefined } }),
    onSuccess: (row: { notification?: { sent: boolean; reason?: string } }) => {
      toast.success(row?.notification?.sent ? t("inviteEmailSent") : t("inviteEmailNotConfigured"));
      invalidateInvites();
      setNewInvite({ email: "", role: "viewer" });
    },
    onError: (e: unknown) => toast.error(e instanceof Error && e.message === "INVITATION_ALREADY_PENDING" ? t("inviteAlreadyPending") : e instanceof Error ? e.message : "Error"),
  });
  const revokeInviteMut = useMutation({
    mutationFn: (invitationId: string) => revokeInviteFn({ data: { invitationId } }),
    onSuccess: () => { toast.success(t("inviteRevoked")); invalidateInvites(); },
  });
  const resendMut = useMutation({
    mutationFn: (invitationId: string) => resendInviteFn({ data: { invitationId, origin: typeof window !== "undefined" ? window.location.origin : undefined } }),
    onSuccess: (row: { notification?: { sent: boolean } }) => toast.success(row?.notification?.sent ? t("inviteEmailSent") : t("inviteEmailNotConfigured")),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  const createMut = useMutation({
    mutationFn: (v: typeof newCo) => createFn({ data: v }),
    onSuccess: (row) => {
      toast.success(t("createCompany"));
      qc.invalidateQueries({ queryKey: ["my-companies"] });
      setNewCo({ slug: "", name_ar: "", name_en: "" });
      setSelected(row.id);
      setActive(row.id);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });
  const invalidateDetails = () => qc.invalidateQueries({ queryKey: ["company-details", activeId] });
  const memberMut = useMutation({
    mutationFn: (v: { userId: string; role: "owner"|"finance"|"shariah"|"trader"|"viewer" }) =>
      addMemberFn({ data: { companyId: activeId!, userId: v.userId, role: v.role } }),
    onSuccess: () => { toast.success(t("memberAdded")); invalidateDetails(); setNewMember({ userId: "", role: "viewer" }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });
  const removeMemberMut = useMutation({
    mutationFn: (memberId: string) => removeMemberFn({ data: { memberId } }),
    onSuccess: () => { toast.success(t("memberRemoved")); invalidateDetails(); },
  });
  const brandMut = useMutation({
    mutationFn: (sym: string) => addBrandFn({ data: { companyId: activeId!, brandSymbol: sym } }),
    onSuccess: () => { toast.success(t("brandAdded")); invalidateDetails(); setNewBrand(""); },
    onError: (e: unknown) => toast.error(e instanceof Error && e.message === "BRAND_CAP_REACHED" ? t("brandCapReached") : "Error"),
  });
  const removeBrandMut = useMutation({
    mutationFn: (brandId: string) => removeBrandFn({ data: { brandId } }),
    onSuccess: () => { toast.success(t("brandRemoved")); invalidateDetails(); },
  });

  return (
    <AppShell>
      <header className="mb-6">
        <div className="h-px hairline-gold mb-3" />
        <h1 className="text-2xl font-bold text-ink md:text-3xl">{t("companySettings")}</h1>
      </header>

      {list.isLoading ? (
        <LuxurySkeleton lines={4} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* Left: company list + create form */}
          <aside className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-card">
              <div className="border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">{t("companies")}</div>
              {(list.data ?? []).length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">{t("noCompaniesYet")}</div>
              ) : (
                <ul>
                  {list.data!.map((m) => (
                    <li key={m.company.id}>
                      <button
                        onClick={() => { setSelected(m.company.id); setActive(m.company.id); }}
                        className={`flex w-full items-center justify-between border-b border-border/40 px-4 py-2.5 text-start text-sm last:border-b-0 ${activeId === m.company.id ? "bg-[var(--gold-soft)] text-[var(--gold-deep)]" : "text-ink hover:bg-secondary/50"}`}
                      >
                        <span className="truncate">{lang === "ar" ? m.company.name_ar : m.company.name_en}</span>
                        <span className="text-[10px] uppercase text-muted-foreground">{t(`${m.role}Role` as never)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-border/60 bg-card p-4">
              <div className="mb-2 text-xs font-semibold text-ink">{t("createCompany")}</div>
              <div className="grid gap-2">
                <input value={newCo.slug} onChange={(e) => setNewCo({ ...newCo, slug: e.target.value })} placeholder={t("slug")} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" />
                <input value={newCo.name_ar} onChange={(e) => setNewCo({ ...newCo, name_ar: e.target.value })} placeholder={t("nameAr")} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" />
                <input value={newCo.name_en} onChange={(e) => setNewCo({ ...newCo, name_en: e.target.value })} placeholder={t("nameEn")} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" />
                <button
                  disabled={createMut.isPending || !newCo.slug || !newCo.name_ar || !newCo.name_en}
                  onClick={() => createMut.mutate(newCo)}
                  className="rounded-md gold-gradient px-3 py-2 text-xs font-semibold text-ink disabled:opacity-50"
                >
                  {t("createCompany")}
                </button>
              </div>
            </div>
          </aside>

          {/* Right: details */}
          <div className="space-y-6">
            {!activeId ? (
              <EmptyState title={t("noCompaniesYet")} description={t("noCompaniesDesc")} />
            ) : details.isLoading ? (
              <LuxurySkeleton lines={6} />
            ) : !details.data?.company ? (
              <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
            ) : (
              <>
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-4">
                  <div>
                    <div className="text-lg font-semibold text-ink">{lang === "ar" ? details.data.company.name_ar : details.data.company.name_en}</div>
                    <div className="text-[11px] uppercase text-muted-foreground">{details.data.company.slug} · {details.data.company.plan}</div>
                  </div>
                  <div className="flex gap-2">
                    <Link to="/company/submit" search={{ companyId: activeId }} className="rounded-md border border-border px-3 py-1.5 text-xs text-ink hover:border-[var(--gold-deep)]">{t("submitProduct")}</Link>
                    <Link to="/company/submissions" search={{ companyId: activeId }} className="rounded-md border border-border px-3 py-1.5 text-xs text-ink hover:border-[var(--gold-deep)]">{t("submissionsIn")}</Link>
                  </div>
                </div>

                {/* Members */}
                <section className="rounded-xl border border-border/60 bg-card">
                  <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                    <h2 className="text-sm font-semibold text-ink">{t("companyMembers")}</h2>
                  </div>
                  <div className="grid gap-2 border-b border-border/40 p-4 sm:grid-cols-[1fr_140px_auto]">
                    <input value={newMember.userId} onChange={(e) => setNewMember({ ...newMember, userId: e.target.value })} placeholder={t("memberUserId")} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" />
                    <select value={newMember.role} onChange={(e) => setNewMember({ ...newMember, role: e.target.value as never })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                      {(["owner","finance","shariah","trader","viewer"] as const).map((r) => (
                        <option key={r} value={r}>{t(`${r}Role` as never)}</option>
                      ))}
                    </select>
                    <button
                      disabled={memberMut.isPending || !newMember.userId}
                      onClick={() => memberMut.mutate(newMember)}
                      className="rounded-md gold-gradient px-3 py-2 text-xs font-semibold text-ink disabled:opacity-50"
                    >
                      {t("addMember")}
                    </button>
                  </div>
                  <ul>
                    {details.data.members.map((m) => (
                      <li key={m.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border/40 px-4 py-2 text-xs last:border-b-0">
                        <span className="truncate font-mono text-ink-soft">{m.user_id}</span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase">{t(`${m.role}Role` as never)}</span>
                        <button onClick={() => removeMemberMut.mutate(m.id)} className="rounded border border-[var(--bear)]/40 px-2 py-0.5 text-[10px] text-[var(--bear)]">{t("removeMember")}</button>
                      </li>
                    ))}
                  </ul>
                </section>

                {/* Brands */}
                <section className="rounded-xl border border-border/60 bg-card">
                  <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                    <h2 className="text-sm font-semibold text-ink">{t("companyBrands")}</h2>
                    <span className="text-[10px] uppercase text-muted-foreground">{details.data.brands.length}/30 · {t("brandCap")}</span>
                  </div>
                  <div className="grid gap-2 border-b border-border/40 p-4 sm:grid-cols-[1fr_auto]">
                    <input value={newBrand} onChange={(e) => setNewBrand(e.target.value.toUpperCase())} placeholder={t("brandSymbol")} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" />
                    <button
                      disabled={brandMut.isPending || !newBrand || details.data.brands.length >= 30}
                      onClick={() => brandMut.mutate(newBrand)}
                      className="rounded-md gold-gradient px-3 py-2 text-xs font-semibold text-ink disabled:opacity-50"
                    >
                      {t("addBrand")}
                    </button>
                  </div>
                  <ul>
                    {details.data.brands.map((b) => (
                      <li key={b.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border/40 px-4 py-2 text-xs last:border-b-0">
                        <span className="font-mono font-semibold text-ink">{b.brand_symbol}</span>
                        <span className="text-muted-foreground">{new Date(b.added_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</span>
                        <button onClick={() => removeBrandMut.mutate(b.id)} className="rounded border border-[var(--bear)]/40 px-2 py-0.5 text-[10px] text-[var(--bear)]">{t("removeMember")}</button>
                      </li>
                    ))}
                  </ul>
                </section>

                {/* Invitations */}
                <section className="rounded-xl border border-border/60 bg-card">
                  <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                    <h2 className="text-sm font-semibold text-ink">{t("invitations")}</h2>
                  </div>
                  <div className="grid gap-2 border-b border-border/40 p-4 sm:grid-cols-[1fr_140px_auto]">
                    <input
                      type="email"
                      value={newInvite.email}
                      onChange={(e) => setNewInvite({ ...newInvite, email: e.target.value })}
                      placeholder={t("inviteEmail")}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
                    />
                    <select
                      value={newInvite.role}
                      onChange={(e) => setNewInvite({ ...newInvite, role: e.target.value as never })}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    >
                      {(["finance","shariah","trader","viewer"] as const).map((r) => (
                        <option key={r} value={r}>{t(`${r}Role` as never)}</option>
                      ))}
                    </select>
                    <button
                      disabled={inviteMut.isPending || !newInvite.email || newInvite.role === "owner"}
                      onClick={() => inviteMut.mutate({ email: newInvite.email, role: newInvite.role as "finance"|"shariah"|"trader"|"viewer" })}
                      className="rounded-md gold-gradient px-3 py-2 text-xs font-semibold text-ink disabled:opacity-50"
                    >{t("inviteMember")}</button>
                  </div>
                  <ul>
                    {(invitesQ.data ?? []).filter((i) => i.status === "pending").map((inv) => {
                      const link = `${typeof window !== "undefined" ? window.location.origin : ""}/invitations?token=${inv.token}`;
                      return (
                        <li key={inv.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-border/40 px-4 py-2 text-xs last:border-b-0">
                          <div className="min-w-0">
                            <div className="truncate text-ink">{inv.email}</div>
                            <div className="text-[10px] uppercase text-muted-foreground">{t(`${inv.role}Role` as never)} · {t("inviteExpires")} {new Date(inv.expires_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</div>
                          </div>
                          <button
                            onClick={() => {
                              navigator.clipboard?.writeText(link);
                              toast.success(t("inviteLinkCopied"));
                            }}
                            className="rounded border border-border px-2 py-0.5 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]"
                          >{t("inviteCopyLink")}</button>
                          <button
                            disabled={resendMut.isPending}
                            onClick={() => resendMut.mutate(inv.id)}
                            className="rounded border border-border px-2 py-0.5 text-[10px] text-ink-soft hover:border-[var(--gold-deep)] disabled:opacity-50"
                          >{t("inviteResendEmail")}</button>
                          <button
                            onClick={() => revokeInviteMut.mutate(inv.id)}
                            className="rounded border border-[var(--bear)]/40 px-2 py-0.5 text-[10px] text-[var(--bear)]"
                          >{t("revoke")}</button>
                          <span className="text-[10px] text-muted-foreground">{new Date(inv.created_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</span>
                        </li>
                      );
                    })}
                    {(invitesQ.data ?? []).filter((i) => i.status === "pending").length === 0 && (
                      <li className="px-4 py-3 text-xs text-muted-foreground">{t("noIncomingInvitations")}</li>
                    )}
                  </ul>
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}