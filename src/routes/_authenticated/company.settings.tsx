import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader, HeaderLink } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useActiveCompany } from "@/hooks/use-active-company";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useConfirm } from "@/components/confirm-dialog";
import { Badge } from "@/components/badge";
import { COMPANY_ROLES, INVITABLE_ROLES, companyRoleHintKey, companyRoleKey } from "@/lib/tenants/role-labels";
import { formatDay } from "@/lib/account/dates";
import { BRAND_CAP, companyBrandRows } from "@/lib/tenants/company-brands";
import { Num } from "@/components/num";
import {
  listMyCompanies,
  createCompany,
  getCompanyDetails,
  removeCompanyMember,
  updateCompanyMemberRole,
  addCompanyBrand,
  removeCompanyBrand,
} from "@/lib/tenants/company.functions";
import {
  listCompanyInvitations,
  createInvitation,
  revokeInvitation,
  unrevokeInvitation,
  resendInvitationEmail,
} from "@/lib/tenants/invitations.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/company/settings")({
  head: () => ({
    meta: [
      { title: "إعدادات الشركة — وحدة القيمة | Company settings — Value Unit" },
      { name: "description", content: "أدر أعضاء شركتك وعلاماتها التجارية ودعواتها. · Manage your company's members, brands and invitations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ reset }) => (
    <AppShell>
      <div className="py-16">
        <ErrorState reset={reset} />
      </div>
    </AppShell>
  ),
  component: CompanySettings,
});

function CompanySettings() {
  const { t, lang } = useI18n();
  const roleLabel = (r: string) => {
    const k = companyRoleKey(r);
    return k ? t(k) : r;
  };
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const listFn = useServerFn(listMyCompanies);
  const createFn = useServerFn(createCompany);
  const detailsFn = useServerFn(getCompanyDetails);
  const removeMemberFn = useServerFn(removeCompanyMember);
  const updateMemberRoleFn = useServerFn(updateCompanyMemberRole);
  const addBrandFn = useServerFn(addCompanyBrand);
  const removeBrandFn = useServerFn(removeCompanyBrand);
  const listInvitesFn = useServerFn(listCompanyInvitations);
  const createInviteFn = useServerFn(createInvitation);
  const revokeInviteFn = useServerFn(revokeInvitation);
  const unrevokeInviteFn = useServerFn(unrevokeInvitation);
  const resendInviteFn = useServerFn(resendInvitationEmail);

  const list = useQuery({ queryKey: ["my-companies"], queryFn: () => listFn() });
  const { activeId: globalActiveId, setActive } = useActiveCompany();
  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? globalActiveId ?? list.data?.[0]?.company?.id ?? null;
  const { companyRole, isAdmin } = useMyRoles();
  const myRole = activeId ? companyRole(activeId) : undefined;
  const canManageMembers = myRole === "owner";
  const canManageBrands = myRole === "owner" || myRole === "finance";
  const canManageInvites = myRole === "owner";

  const details = useQuery({
    queryKey: ["company-details", activeId],
    queryFn: () => detailsFn({ data: { companyId: activeId! } }),
    enabled: !!activeId,
  });
  // Roster and owned instruments, as the workspace and the brand cap count them.
  const brandRows = companyBrandRows(details.data?.brands ?? [], details.data?.instruments ?? []);

  const [newCo, setNewCo] = useState({ slug: "", name_ar: "", name_en: "" });
  const [newBrand, setNewBrand] = useState("");
  const [newInvite, setNewInvite] = useState({
    email: "",
    role: "viewer" as "owner" | "finance" | "shariah" | "trader" | "viewer",
  });

  const invitesQ = useQuery({
    queryKey: ["company-invitations", activeId],
    queryFn: () => listInvitesFn({ data: { companyId: activeId! } }),
    enabled: !!activeId,
  });
  const invalidateInvites = () =>
    qc.invalidateQueries({ queryKey: ["company-invitations", activeId] });
  const inviteMut = useMutation({
    mutationFn: (v: { email: string; role: "finance" | "shariah" | "trader" | "viewer" }) =>
      createInviteFn({
        data: {
          companyId: activeId!,
          email: v.email,
          role: v.role,
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      }),
    onSuccess: (res) => {
      if (res.notification.sent) toast.success(t("inviteEmailSent"));
      else toast.warning(t("inviteEmailNotConfigured"));
      invalidateInvites();
      setNewInvite({ email: "", role: "viewer" });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const revokeInviteMut = useMutation({
    mutationFn: (invitationId: string) => revokeInviteFn({ data: { invitationId } }),
    onSuccess: (_res, invitationId) => {
      invalidateInvites();
      toast.success(t("inviteRevoked"), {
        action: {
          label: t("undo"),
          onClick: async () => {
            try {
              await unrevokeInviteFn({ data: { invitationId } });
              toast.success(t("undone"));
              invalidateInvites();
            } catch {
              toast.error(t("undoFailed"));
            }
          },
        },
      });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const resendMut = useMutation({
    mutationFn: (v: { invitationId: string; reissue: boolean }) => resendInviteFn({ data: v }),
    onSuccess: (res) => {
      if (res.notification.sent) toast.success(res.reissued ? t("r_inviteReissued") : t("r_inviteResent"));
      else toast.warning(t("r_inviteEmailFailed"));
      invalidateInvites();
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
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
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const invalidateDetails = () => qc.invalidateQueries({ queryKey: ["company-details", activeId] });
  const removeMemberMut = useMutation({
    mutationFn: (memberId: string) => removeMemberFn({ data: { memberId } }),
    onSuccess: () => {
      toast.success(t("memberRemoved"));
      invalidateDetails();
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const memberRoleMut = useMutation({
    mutationFn: (v: {
      memberId: string;
      role: "owner" | "finance" | "shariah" | "trader" | "viewer";
    }) => updateMemberRoleFn({ data: v }),
    onSuccess: () => {
      toast.success(t("memberRoleUpdated"));
      invalidateDetails();
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const brandMut = useMutation({
    mutationFn: (sym: string) => addBrandFn({ data: { companyId: activeId!, brandSymbol: sym } }),
    onSuccess: () => {
      toast.success(t("brandAdded"));
      invalidateDetails();
      setNewBrand("");
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const removeBrandMut = useMutation({
    mutationFn: (brandId: string) => removeBrandFn({ data: { brandId } }),
    onSuccess: () => {
      toast.success(t("brandRemoved"));
      invalidateDetails();
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("companies")}
        title={t("companySettings")}
        crumbs={[
          { label: t("companies"), to: "/company/settings" },
          { label: t("companySettings") },
        ]}
        actions={
          <HeaderLink to="/company/audit" variant="secondary">
            {t("auditLog")}
          </HeaderLink>
        }
      />

      {list.isLoading ? (
        <LuxurySkeleton lines={4} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* Left: company list + create form */}
          <aside className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-card">
              <div className="border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("companies")}
              </div>
              {(list.data ?? []).length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">{t("noCompaniesYet")}</div>
              ) : (
                <ul>
                  {list.data!.map((m) => (
                    <li key={m.company.id}>
                      <button
                        onClick={() => {
                          setSelected(m.company.id);
                          setActive(m.company.id);
                        }}
                        className={`flex w-full items-center justify-between border-b border-border/40 px-4 py-2.5 text-start text-sm last:border-b-0 ${activeId === m.company.id ? "bg-[var(--gold-soft)] text-[var(--gold-deep)]" : "text-ink hover:bg-secondary/50"}`}
                      >
                        <span className="truncate">
                          {lang === "ar" ? m.company.name_ar : m.company.name_en}
                        </span>
                        <span className="text-[10px] uppercase text-muted-foreground">
                          {roleLabel(m.role)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {isAdmin ? (
              <div className="rounded-xl border border-border/60 bg-card p-4">
                <div className="mb-2 text-xs font-semibold text-ink">{t("createCompany")}</div>
                <div className="mb-2 text-[10px] text-muted-foreground">
                  {t("adminDirectCreateNote")}
                </div>
                <div className="grid gap-2">
                  <input
                    value={newCo.slug}
                    onChange={(e) => setNewCo({ ...newCo, slug: e.target.value })}
                    placeholder={t("slug")}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
                  />
                  <input
                    value={newCo.name_ar}
                    onChange={(e) => setNewCo({ ...newCo, name_ar: e.target.value })}
                    placeholder={t("nameAr")}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
                  />
                  <input
                    value={newCo.name_en}
                    onChange={(e) => setNewCo({ ...newCo, name_en: e.target.value })}
                    placeholder={t("nameEn")}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
                  />
                  <button
                    disabled={
                      createMut.isPending || !newCo.slug || !newCo.name_ar || !newCo.name_en
                    }
                    onClick={() => createMut.mutate(newCo)}
                    className="rounded-md gold-gradient px-3 py-2 text-xs font-semibold text-ink disabled:opacity-50"
                  >
                    {t("createCompany")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border/60 bg-card p-4">
                <div className="mb-2 text-xs font-semibold text-ink">{t("wantNewCompany")}</div>
                <p className="mb-3 text-xs text-muted-foreground">{t("wantNewCompanyDesc")}</p>
                <Link
                  to="/request-access"
                  search={{ kind: "new" }}
                  className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--gold-deep)] hover:border-[var(--gold-deep)]"
                >
                  {t("requestAccess")}
                </Link>
              </div>
            )}
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
                    <div className="text-lg font-semibold text-ink">
                      {lang === "ar" ? details.data.company.name_ar : details.data.company.name_en}
                    </div>
                    {/* The company's address on the platform; plan tiers are not offered yet. */}
                    <div className="font-mono text-[11px] text-muted-foreground" dir="ltr">
                      {details.data.company.slug}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {myRole && (
                      <span className="rounded-full border border-[var(--gold-deep)]/40 bg-[var(--gold-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--gold-deep)]">
                        {t("yourRoleHere")}: {roleLabel(myRole)}
                      </span>
                    )}
                    {canManageBrands && (
                      <Link
                        to="/company/submit"
                        search={{ companyId: activeId }}
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-ink hover:border-[var(--gold-deep)]"
                      >
                        {t("submitProduct")}
                      </Link>
                    )}
                    <Link
                      to="/company/submissions"
                      search={{
                        companyId: activeId,
                        q: "",
                        status: "all",
                        asset: "all",
                        sortBy: "submitted",
                        sortDir: "desc" as const,
                        page: 1,
                        pageSize: 25,
                      }}
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-ink hover:border-[var(--gold-deep)]"
                    >
                      {t("submissionsIn")}
                    </Link>
                  </div>
                </div>

                {/* Members */}
                <section className="rounded-xl border border-border/60 bg-card">
                  <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                    <h2 className="text-sm font-semibold text-ink">{t("companyMembers")}</h2>
                    {!canManageMembers && (
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {t("permMembersOwnerOnly")}
                      </span>
                    )}
                  </div>
                  {canManageMembers && (
                    <p className="border-b border-border/40 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
                      {t("r_membersJoinByInvite")}
                    </p>
                  )}
                  <ul>
                    {details.data.members.map((m) => (
                      <li
                        key={m.id}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border/40 px-4 py-2 text-xs last:border-b-0"
                      >
                        <span className="min-w-0 truncate text-ink-soft" dir="ltr" title={m.user_id}>
                          {m.email ?? <span className="font-mono">{m.user_id}</span>}
                        </span>
                        {canManageMembers ? (
                          <select
                            aria-label={t("memberRole")}
                            value={m.role}
                            disabled={memberRoleMut.isPending}
                            onChange={(e) =>
                              memberRoleMut.mutate({
                                memberId: m.id,
                                role: e.target.value as never,
                              })
                            }
                            className="rounded-md border border-border bg-background px-2 py-0.5 text-[10px] uppercase"
                          >
                            {COMPANY_ROLES.map(
                              (r) => (
                                <option key={r} value={r}>
                                  {roleLabel(r)}
                                </option>
                              ),
                            )}
                          </select>
                        ) : (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase">
                            {roleLabel(m.role)}
                          </span>
                        )}
                        {canManageMembers ? (
                          <button
                            onClick={async () => {
                              const ok = await confirm({
                                title: t("confirmRemoveMemberTitle"),
                                description: t("confirmRemoveMemberDesc"),
                                confirmLabel: t("removeMember"),
                                cancelLabel: t("cancel"),
                                tone: "danger",
                              });
                              if (ok) removeMemberMut.mutate(m.id);
                            }}
                            className="rounded border border-[var(--bear)]/40 px-2 py-0.5 text-[10px] text-[var(--bear)]"
                          >
                            {t("removeMember")}
                          </button>
                        ) : (
                          <span />
                        )}
                      </li>
                    ))}
                  </ul>
                </section>

                {/* Brands */}
                <section className="rounded-xl border border-border/60 bg-card">
                  <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                    <h2 className="text-sm font-semibold text-ink">{t("companyBrands")}</h2>
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {/* Counted as the database counts them against the cap (roster
                          and owned instruments), the same list as the workspace. */}
                      <Num value={brandRows.length} kind="qty" />/<Num value={BRAND_CAP} kind="qty" /> · {t("brandCap")}
                      {!canManageBrands && <> · {t("permBrandsOwnerFinance")}</>}
                    </span>
                  </div>
                  {canManageBrands && (
                    <div className="grid gap-2 border-b border-border/40 p-4 sm:grid-cols-[1fr_auto]">
                      <input
                        value={newBrand}
                        onChange={(e) => setNewBrand(e.target.value.toUpperCase())}
                        placeholder={t("brandSymbol")}
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
                      />
                      <button
                        disabled={
                          brandMut.isPending ||
                          !newBrand ||
                          (brandRows.length >= BRAND_CAP && !brandRows.some((r) => r.owned && r.symbol === newBrand.trim()))
                        }
                        onClick={() => brandMut.mutate(newBrand)}
                        className="rounded-md gold-gradient px-3 py-2 text-xs font-semibold text-ink disabled:opacity-50"
                      >
                        {t("addBrand")}
                      </button>
                    </div>
                  )}
                  <ul>
                    {brandRows.map((b) => (
                      <li
                        key={b.id ?? `owned:${b.symbol}`}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border/40 px-4 py-2 text-xs last:border-b-0"
                      >
                        <span className="font-mono font-semibold text-ink" dir="ltr" style={{ textAlign: "start" }}>{b.symbol}</span>
                        <span className="text-muted-foreground">
                          {b.owned ? t("fl_ownedInstrument") : formatDay(b.addedAt, lang)}
                        </span>
                        {canManageBrands && b.removable && b.id ? (
                          <button
                            onClick={async () => {
                              const ok = await confirm({
                                title: t("confirmRemoveBrandTitle"),
                                description: `${t("confirmRemoveBrandDesc")} · ${b.symbol}`,
                                confirmLabel: t("removeMember"),
                                cancelLabel: t("cancel"),
                                tone: "danger",
                              });
                              if (ok && b.id) removeBrandMut.mutate(b.id);
                            }}
                            className="rounded border border-[var(--bear)]/40 px-2 py-0.5 text-[10px] text-[var(--bear)]"
                          >
                            {t("removeMember")}
                          </button>
                        ) : (
                          <span />
                        )}
                      </li>
                    ))}
                  </ul>
                </section>

                {/* Invitations */}
                <section className="rounded-xl border border-border/60 bg-card">
                  <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                    <h2 className="text-sm font-semibold text-ink">{t("invitations")}</h2>
                    {!canManageInvites && (
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {t("permInvitesOwnerOnly")}
                      </span>
                    )}
                  </div>
                  {canManageInvites && (
                    <form
                      className="border-b border-border/40 p-4"
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!newInvite.email.trim() || newInvite.role === "owner" || inviteMut.isPending) return;
                        inviteMut.mutate({
                          email: newInvite.email.trim(),
                          role: newInvite.role as "finance" | "shariah" | "trader" | "viewer",
                        });
                      }}
                    >
                      <div className="grid gap-2 sm:grid-cols-[1fr_170px_auto]">
                        <input
                          type="email"
                          dir="ltr"
                          value={newInvite.email}
                          maxLength={320}
                          onChange={(e) => setNewInvite({ ...newInvite, email: e.target.value })}
                          placeholder={t("inviteEmail")}
                          aria-label={t("inviteEmail")}
                          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
                        />
                        <select
                          value={newInvite.role}
                          aria-label={t("r_arRoleLabel")}
                          onChange={(e) =>
                            setNewInvite({ ...newInvite, role: e.target.value as never })
                          }
                          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                        >
                          {INVITABLE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          disabled={
                            inviteMut.isPending || !newInvite.email.trim() || newInvite.role === "owner"
                          }
                          className="rounded-md gold-gradient px-3 py-2 text-xs font-semibold text-ink disabled:opacity-50"
                        >
                          {t("inviteMember")}
                        </button>
                      </div>
                      {companyRoleHintKey(newInvite.role) && (
                        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                          {t(companyRoleHintKey(newInvite.role)!)}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("r_roleTradingNote")}</p>
                    </form>
                  )}
                  <ul>
                    {(invitesQ.data ?? [])
                      .filter((i) => i.status === "pending" || i.status === "expired")
                      .map((inv) => {
                        const expired = inv.status === "expired";
                        return (
                          <li
                            key={inv.id}
                            className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 px-4 py-2.5 text-xs last:border-b-0"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-ink" dir="ltr">{inv.email}</span>
                                <Badge variant={expired ? "bear" : "gold"}>
                                  {expired ? t("r_statusExpired") : t("r_statusAwaitingAcceptance")}
                                </Badge>
                              </div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground">
                                {roleLabel(inv.role)} ·{" "}
                                {(expired ? t("r_inviteExpiredOn") : t("r_inviteValidUntil")).replace(
                                  "{date}",
                                  formatDay(inv.expiresAt, lang),
                                )}
                              </div>
                            </div>
                            {canManageInvites && (
                              <div className="flex flex-wrap gap-1.5">
                                {inv.inviteUrl && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard
                                        ?.writeText(inv.inviteUrl!)
                                        .then(() => toast.success(t("inviteLinkCopied")))
                                        .catch(() => undefined);
                                    }}
                                    className="rounded border border-border px-2 py-0.5 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]"
                                  >
                                    {t("inviteCopyLink")}
                                  </button>
                                )}
                                {!expired && (
                                  <button
                                    type="button"
                                    disabled={resendMut.isPending}
                                    onClick={() => resendMut.mutate({ invitationId: inv.id, reissue: false })}
                                    className="rounded border border-border px-2 py-0.5 text-[10px] text-ink-soft hover:border-[var(--gold-deep)] disabled:opacity-50"
                                  >
                                    {t("inviteResendEmail")}
                                  </button>
                                )}
                                {expired && (
                                  <button
                                    type="button"
                                    disabled={resendMut.isPending}
                                    onClick={() => resendMut.mutate({ invitationId: inv.id, reissue: true })}
                                    className="rounded border border-[var(--gold-deep)]/40 px-2 py-0.5 text-[10px] font-semibold text-[var(--gold-deep)] disabled:opacity-50"
                                  >
                                    {t("r_inviteReissue")}
                                  </button>
                                )}
                                {!expired && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const ok = await confirm({
                                        title: t("confirmRevokeInviteTitle"),
                                        description: `${t("confirmRevokeInviteDesc")} · ${inv.email}`,
                                        confirmLabel: t("revoke"),
                                        cancelLabel: t("cancel"),
                                        tone: "danger",
                                      });
                                      if (ok) revokeInviteMut.mutate(inv.id);
                                    }}
                                    className="rounded border border-[var(--bear)]/40 px-2 py-0.5 text-[10px] text-[var(--bear)]"
                                  >
                                    {t("revoke")}
                                  </button>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    {(invitesQ.data ?? []).filter((i) => i.status === "pending" || i.status === "expired").length === 0 && (
                      <li className="px-4 py-3 text-xs text-muted-foreground">
                        {t("r_noOutgoingInvitations")}
                      </li>
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
