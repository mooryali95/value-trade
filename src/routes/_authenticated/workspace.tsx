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
import { getBrand } from "@/lib/mock-data";
import { formatCurrency, formatPct, formatInt } from "@/lib/format";
import { useActiveCompany } from "@/hooks/use-active-company";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useConfirm } from "@/components/confirm-dialog";
import {
  getCompanyDetails,
  addCompanyBrand,
  removeCompanyBrand,
} from "@/lib/tenants/company.functions";
import { createInvitation } from "@/lib/tenants/invitations.functions";
import { listCompanySubmissions } from "@/lib/submissions/submissions.functions";
import { Building2, Users, TrendingUp, Plus, Send, FileText } from "lucide-react";

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
      toast.error(e instanceof Error && e.message === "BRAND_CAP_REACHED" ? t("brandCapReached") : "Error"),
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
      toast.error(e instanceof Error && e.message === "INVITATION_ALREADY_PENDING" ? t("inviteAlreadyPending") : "Error"),
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
        <div className="py-16">
          <EmptyState
            title={t("ws_workspace")}
            description={t("wsNoCompany")}
            action={
              <Link to="/company/settings" className="rounded-md gold-gradient px-4 py-2 text-xs font-semibold text-[oklch(0.16_0.04_260)]">
                {t("companySettings")}
              </Link>
            }
          />
        </div>
      </AppShell>
    );
  }

  const brandRows = (details.data?.brands ?? []).map((row: { id: string; brand_symbol: string }) => {
    const b = getBrand(row.brand_symbol.toLowerCase());
    return { id: row.id, symbol: row.brand_symbol, brand: b ?? null };
  });
  const totalCap = brandRows.reduce((s, r) => s + (r.brand?.marketCap ?? 0), 0);
  const totalVol = brandRows.reduce((s, r) => s + (r.brand?.volume24h ?? 0), 0);
  const membersCount = details.data?.members?.length ?? 0;
  const pendingSubs = (subs.data ?? []).filter((s: { status: string }) => s.status === "pending").length;

  return (
    <AppShell>
      <PageHeader
        eyebrow={`${active.plan ?? "—"} · Tenant`}
        title={pick(lang, active.name_ar, active.name_en)}
        crumbs={[{ label: t("companies"), to: "/company/settings" }, { label: t("ws_workspace") }]}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <KPI label={t("brandsCount")} value={`${brandRows.length}/30`} icon={Building2} />
        <KPI label={t("marketCap")} value={formatCurrency(totalCap, true, lang)} icon={TrendingUp} />
        <KPI label={t("wsPendingSubmissions")} value={String(pendingSubs)} icon={FileText} />
        <KPI label={t("members")} value={String(membersCount)} icon={Users} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">{t("companyBrands")}</h2>
            <span className="num text-xs text-muted-foreground">{formatInt(totalVol, true)} · {t("volume24h")}</span>
          </div>
          <div className="mb-3 flex gap-2">
            <input
              value={newBrand}
              onChange={(e) => setNewBrand(e.target.value.toUpperCase())}
              placeholder="AAPL"
              disabled={!canManageBrands}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs focus:border-primary/50 focus:outline-none disabled:opacity-50"
            />
            <button
              disabled={!canManageBrands || !newBrand || addBrandMut.isPending}
              onClick={() => addBrandMut.mutate(newBrand)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md gold-gradient px-3 py-2 text-xs font-semibold text-[oklch(0.16_0.04_260)] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> {t("ws_addBrand")}
            </button>
          </div>
          {brandRows.length === 0 ? (
            <div className="rounded-xl border border-border/60 bg-card/60 p-6 text-center text-xs text-muted-foreground">
              {t("wsNoBrands")}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
              {brandRows.map((r) => (
                <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[10px] font-bold text-ivory" style={{ background: r.brand?.color ?? "var(--gold-deep)" }}>{r.symbol.slice(0, 3)}</div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {r.brand ? pick(lang, r.brand.nameAr, r.brand.nameEn) : r.symbol}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{r.symbol}{r.brand ? ` · ${r.brand.sector}` : ""}</div>
                    </div>
                  </div>
                  <div className="num text-xs text-foreground">{r.brand ? r.brand.price.toFixed(2) : "—"}</div>
                  <div className={`hidden num text-xs sm:block ${(r.brand?.change24h ?? 0) >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                    {r.brand ? formatPct(r.brand.change24h) : "—"}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.brand && (
                      <Link to="/market/$slug" params={{ slug: r.brand.slug }} className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-primary">
                        {t("overview")}
                      </Link>
                    )}
                    <button
                      disabled={!canManageBrands}
                      onClick={async () => {
                        const ok = await confirm({
                          title: t("brandRemoved"),
                          description: r.symbol,
                          confirmLabel: t("wsRemove"),
                          cancelLabel: t("cancel"),
                          tone: "danger",
                        });
                        if (ok) removeBrandMut.mutate(r.id);
                      }}
                      className="rounded border border-[var(--bear)]/40 px-2 py-1 text-[10px] text-[var(--bear)] disabled:opacity-40"
                    >
                      {t("wsRemove")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-card/60 p-5">
            <h3 className="mb-3 text-sm font-semibold text-foreground">{t("ws_inviteBrandManager")}</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("ws_inviteDesc")}
            </p>
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              type="email"
              placeholder="brand@company.com"
              disabled={!canInvite}
              className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-xs focus:border-primary/50 focus:outline-none disabled:opacity-50"
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
                className="inline-flex w-full items-center justify-center gap-2 rounded-md gold-gradient py-2 text-xs font-semibold text-[oklch(0.16_0.04_260)] disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" /> {t("ws_sendInvite")}
              </button>
            </PermissionHint>
          </div>

          <div className="rounded-xl border border-border/60 bg-card/60 p-5">
            <h3 className="mb-3 text-sm font-semibold text-foreground">{t("ws_publishPublic")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("ws_publishDesc")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded border border-border/50 bg-secondary/30 py-2">
                <div className="text-lg font-bold text-foreground">{brandRows.filter((r) => r.brand?.shariah === "halal").length}</div>
                <div className="text-[10px] text-muted-foreground">{t("halal")}</div>
              </div>
              <div className="rounded border border-border/50 bg-secondary/30 py-2">
                <div className="text-lg font-bold text-foreground">{brandRows.filter((r) => r.brand?.shariah !== "halal").length}</div>
                <div className="text-[10px] text-muted-foreground">{t("reviewing")}</div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function KPI({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="font-mono text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}