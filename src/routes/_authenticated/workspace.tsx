import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { EmptyState } from "@/components/empty-state";
import { PermissionHint } from "@/components/permission-hint";
import { useI18n, pick } from "@/lib/i18n";
import { useErrorMessage } from "@/hooks/use-error-message";
import { Num } from "@/components/num";
import {
  ChangeText,
  MarketDataError,
  Monogram,
  PriceText,
  ShariahPill,
  indexBySymbol,
  markOf,
  sectorLabel,
  useMarketOverview,
} from "@/components/market-data";
import { useActiveCompany } from "@/hooks/use-active-company";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useConfirm } from "@/components/confirm-dialog";
import {
  getCompanyDetails,
  addCompanyBrand,
  removeCompanyBrand,
} from "@/lib/tenants/company.functions";
import { createInvitation } from "@/lib/tenants/invitations.functions";
import { BRAND_CAP, companyBrandRows } from "@/lib/tenants/company-brands";
import { listCompanySubmissions } from "@/lib/submissions/submissions.functions";
import { Building2, Users, Store, Plus, Send, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/workspace")({
  head: () => ({
    meta: [
      { title: "منصة الشركة — وحدة القيمة | Workspace — Value Unit" },
      { name: "description", content: "منصة تداول داخلية للشركات المستأجرة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const { t, lang } = useI18n();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { active, activeId, isLoading: coLoading } = useActiveCompany();
  const { companyRole } = useMyRoles();
  const role = activeId ? companyRole(activeId) : undefined;
  const canManageBrands = role === "owner" || role === "finance";
  const canInvite = role === "owner";

  const detailsFn = useServerFn(getCompanyDetails);
  const subsFn = useServerFn(listCompanySubmissions);
  const addBrandFn = useServerFn(addCompanyBrand);
  const removeBrandFn = useServerFn(removeCompanyBrand);
  const inviteFn = useServerFn(createInvitation);

  const market = useMarketOverview();
  const details = useQuery({
    queryKey: ["company-details", activeId],
    queryFn: () => detailsFn({ data: { companyId: activeId! } }),
    enabled: !!activeId,
  });
  const subs = useQuery({
    queryKey: ["company-submissions", activeId],
    queryFn: () => subsFn({ data: { companyId: activeId! } }),
    enabled: !!activeId,
  });

  const [newBrand, setNewBrand] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["company-details", activeId] });

  const addBrandMut = useMutation({
    mutationFn: (sym: string) => addBrandFn({ data: { companyId: activeId!, brandSymbol: sym } }),
    onSuccess: () => { toast.success(t("brandAdded")); setNewBrand(""); invalidate(); },
    onError: (e: unknown) =>
      toast.error(errorMessage(e)),
  });
  const removeBrandMut = useMutation({
    mutationFn: (brandId: string) => removeBrandFn({ data: { brandId } }),
    onSuccess: () => { toast.success(t("brandRemoved")); invalidate(); },
  });
  const inviteMut = useMutation({
    mutationFn: (email: string) =>
      inviteFn({ data: { companyId: activeId!, email, role: "finance", origin: typeof window !== "undefined" ? window.location.origin : undefined } }),
    onSuccess: (row: { notification?: { sent: boolean } }) => {
      toast.success(row?.notification?.sent ? t("inviteEmailSent") : t("inviteEmailNotConfigured"));
      setInviteEmail("");
    },
    onError: (e: unknown) =>
      toast.error(errorMessage(e)),
  });

  if (coLoading || (activeId && details.isLoading)) {
    return (
      <AppShell>
        <div className="space-y-4"><LuxurySkeleton lines={2} className="max-w-md" /><LuxurySkeleton lines={6} /></div>
      </AppShell>
    );
  }
  if (!activeId || !active) {
    return (
      <AppShell>
        <PageHeader title={t("ws_workspace")} />
        <div className="py-6">
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            title={t("u_wsNoCompanyTitle")}
            description={t("u_wsNoCompanyDesc")}
            action={
              <div className="flex flex-col justify-center gap-2 sm:flex-row">
                <Link to="/invitations" className="inline-flex min-h-11 items-center justify-center rounded-md gold-gradient px-5 text-sm font-semibold text-ink">
                  {t("incomingInvitations")}
                </Link>
                <Link
                  to="/request-access"
                  search={{ kind: "new" }}
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-card px-5 text-sm font-semibold text-ink hover:border-[var(--gold-deep)]"
                >
                  {t("u_ctaCompany")}
                </Link>
              </div>
            }
          />
        </div>
      </AppShell>
    );
  }

  // The company's brands: its roster (company_brands) together with the
  // instruments it owns (brands.company_id, e.g. listed through a product
  // submission), counted once each, as the database counts them against the
  // 30-brand cap (companyBrandRows, shared with the company settings). An
  // instrument the company owns stays on its list: only roster entries can
  // be removed here. A brand is "listed" only when it is published; its price
  // is the last trade or the listing reference price, both from the database.
  const listed = indexBySymbol(market.data?.instruments);
  const brandRows = companyBrandRows(details.data?.brands ?? [], details.data?.instruments ?? []).map((r) => ({
    ...r,
    instrument: listed.get(r.symbol) ?? null,
  }));
  const listedCount = brandRows.filter((r) => r.instrument).length;
  const totalValue24h = brandRows.reduce((s, r) => s + (r.instrument?.volume24hValue ?? 0), 0);
  const membersCount = details.data?.members?.length ?? 0;
  const pendingSubs = (subs.data ?? []).filter((s: { status: string }) => s.status === "pending").length;

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("ws_workspace")}
        title={pick(lang, active.name_ar, active.name_en)}
        crumbs={[{ label: t("companies"), to: "/company/settings" }, { label: t("ws_workspace") }]}
        actions={
          <>
            {canManageBrands && (
              <Link
                to="/company/submit"
                search={{ companyId: activeId }}
                className="inline-flex min-h-11 items-center gap-2 rounded-md gold-gradient px-4 text-sm font-semibold text-ink sm:min-h-10"
              >
                <Plus className="h-4 w-4" aria-hidden /> {t("submitProduct")}
              </Link>
            )}
            <Link
              to="/company/submissions"
              search={{ companyId: activeId, q: "", status: "all", asset: "all", sortBy: "submitted", sortDir: "desc" as const, page: 1, pageSize: 25 }}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-semibold text-ink hover:border-[var(--gold-deep)] sm:min-h-10"
            >
              <FileText className="h-4 w-4" aria-hidden /> {t("submissionsIn")}
            </Link>
          </>
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label={t("brandsCount")} value={<><Num value={brandRows.length} kind="qty" /> <span className="text-sm font-medium text-muted-foreground">/ <Num value={BRAND_CAP} kind="qty" /></span></>} icon={Building2} />
        <KPI label={t("e2_listedOnMarket")} value={<><Num value={listedCount} kind="qty" /> <span className="text-sm font-medium text-muted-foreground">/ <Num value={brandRows.length} kind="qty" /></span></>} icon={Store} />
        <KPI label={t("wsPendingSubmissions")} value={<Num value={pendingSubs} kind="qty" />} icon={FileText} />
        <KPI label={t("members")} value={<Num value={membersCount} kind="qty" />} icon={Users} />
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-ink">{t("companyBrands")}</h2>
            {listedCount > 0 && (
              <span className="text-xs text-muted-foreground">{t("e2_value24h")}: <Num value={totalValue24h} kind="currency" /></span>
            )}
          </div>
          <div className="mb-3 flex gap-2">
            <input
              value={newBrand}
              onChange={(e) => setNewBrand(e.target.value.toUpperCase())}
              placeholder={t("brandSymbol")}
              aria-label={t("brandSymbol")}
              disabled={!canManageBrands}
              dir="ltr"
              className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm focus:border-[var(--gold-deep)] focus:outline-none disabled:opacity-50 sm:min-h-10"
            />
            <button
              type="button"
              disabled={!canManageBrands || !newBrand || addBrandMut.isPending}
              onClick={() => addBrandMut.mutate(newBrand)}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md gold-gradient px-4 text-sm font-semibold text-ink disabled:opacity-50 sm:min-h-10"
            >
              <Plus className="h-3.5 w-3.5" /> {t("ws_addBrand")}
            </button>
          </div>
          {market.isError && !market.data && (
            <div className="mb-3">
              <MarketDataError error={market.error} onRetry={() => market.refetch()} />
            </div>
          )}
          {brandRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
              {t("wsNoBrands")}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-card">
              {brandRows.map((r) => (
                <div key={r.id ?? `owned:${r.symbol}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                  <div className="flex min-w-0 items-center gap-3">
                    <Monogram symbol={r.symbol} className="h-10 w-10" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">
                        {r.instrument ? pick(lang, r.instrument.nameAr, r.instrument.nameEn) : r.symbol}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span><span dir="ltr">{r.symbol}</span>{r.instrument?.sector ? ` · ${sectorLabel(r.instrument.sector, t)}` : ""}</span>
                        {r.instrument ? (
                          <ShariahPill status={r.instrument.shariahStatus} />
                        ) : (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">{t("e2_notListed")}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-end text-sm font-semibold text-ink">
                    {r.instrument ? <PriceText mark={markOf(r.instrument)} /> : <Num value={null} />}
                  </div>
                  <div className="hidden text-xs sm:block">
                    <ChangeText pct={r.instrument?.change24hPct ?? null} />
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
                    {r.instrument && (
                      <Link to="/market/$slug" params={{ slug: r.instrument.slug }} className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs text-ink-soft hover:border-[var(--gold-deep)] hover:text-ink">
                        {t("overview")}
                      </Link>
                    )}
                    {r.removable && r.id && (
                    <button
                      disabled={!canManageBrands}
                      onClick={async () => {
                        const ok = await confirm({
                          title: t("confirmRemoveBrandTitle"),
                          description: `${r.symbol} — ${t("confirmRemoveBrandDesc")}`,
                          confirmLabel: t("wsRemove"),
                          cancelLabel: t("cancel"),
                          tone: "danger",
                        });
                        if (ok && r.id) removeBrandMut.mutate(r.id);
                      }}
                      type="button"
                      className="inline-flex min-h-9 items-center rounded-md border border-[var(--bear)]/40 px-3 text-xs text-[var(--bear)] disabled:opacity-40"
                    >
                      {t("wsRemove")}
                    </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-card p-5 shadow-card">
            <h3 className="mb-2 text-[15px] font-bold text-ink">{t("ws_inviteBrandManager")}</h3>
            <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
              {t("ws_inviteDesc")}
            </p>
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              type="email"
              placeholder="name@company.com"
              aria-label={t("email")}
              dir="ltr"
              disabled={!canInvite}
              className="mb-2 min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm focus:border-[var(--gold-deep)] focus:outline-none disabled:opacity-50 sm:min-h-10"
            />
            <PermissionHint allowed={canInvite} reason={t("ownerRequired")}>
              <button
                disabled={!canInvite || !inviteEmail || inviteMut.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: t("ws_sendInvite"),
                    description: `${inviteEmail} · ${t("financeRole")}`,
                    confirmLabel: t("ws_sendInvite"),
                    cancelLabel: t("cancel"),
                  });
                  if (ok) inviteMut.mutate(inviteEmail);
                }}
                type="button"
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md gold-gradient text-sm font-semibold text-ink disabled:opacity-50 sm:min-h-10"
              >
                <Send className="h-3.5 w-3.5" /> {t("ws_sendInvite")}
              </button>
            </PermissionHint>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-5 shadow-card">
            <h3 className="mb-2 text-[15px] font-bold text-ink">{t("ws_publishPublic")}</h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {t("ws_publishDesc")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded border border-border/50 bg-secondary/30 py-2">
                <div className="text-lg font-bold text-ink"><Num value={market.data ? listedCount : null} kind="qty" /></div>
                <div className="text-xs text-muted-foreground">{t("e2_listed")}</div>
              </div>
              <div className="rounded border border-border/50 bg-secondary/30 py-2">
                <div className="text-lg font-bold text-ink"><Num value={market.data ? brandRows.length - listedCount : null} kind="qty" /></div>
                <div className="text-xs text-muted-foreground">{t("e2_notListed")}</div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function KPI({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <dt className="truncate text-xs font-medium text-muted-foreground">{label}</dt>
        <Icon className="h-4 w-4 shrink-0 text-[var(--gold-deep)]" aria-hidden />
      </div>
      <dd className="text-xl font-semibold text-ink">{value}</dd>
    </div>
  );
}
