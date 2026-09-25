import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardText } from "@phosphor-icons/react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { formatDateTime } from "@/components/market-data";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useActiveCompany } from "@/hooks/use-active-company";
import { useMyRoles } from "@/hooks/use-my-roles";
import { AccessDenied } from "@/components/access-denied";
import { listAuditLog, type AuditRow } from "@/lib/audit/audit.functions";
import { PageHeader, HeaderAction } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/company/audit")({
  head: () => ({
    meta: [
      { title: "سجل التدقيق · Audit Log — Value Unit" },
      { name: "description", content: "سجل عمليات الشركة الزمني. · Chronological company activity trail." },
      { property: "og:title", content: "Audit Log — Value Unit" },
      { property: "og:description", content: "Chronological company activity trail." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CompanyAuditPage,
  errorComponent: () => <AuditFallback kind="error" />,
  notFoundComponent: () => <AuditFallback kind="notFound" />,
});

function CompanyAuditPage() {
  const { t, lang } = useI18n();
  const { active, isLoading: coLoading } = useActiveCompany();
  const { companyRole, isLoading: rolesLoading } = useMyRoles();
  const listFn = useServerFn(listAuditLog);
  const myRole = active ? companyRole(active.id) : undefined;
  const isOwner = myRole === "owner";

  const q = useQuery<AuditRow[]>({
    queryKey: ["audit-log", active?.id],
    queryFn: () => listFn({ data: { companyId: active!.id, limit: 100 } }),
    enabled: !!active && isOwner,
    staleTime: 30_000,
  });

  if (coLoading || (active && rolesLoading)) {
    return (
      <AppShell>
        <LuxurySkeleton lines={6} />
      </AppShell>
    );
  }
  if (!active) {
    return (
      <AppShell>
        <PageHeader title={t("auditLog")} description={t("auditLogDesc")} />
        <EmptyState
          icon={<ClipboardText size={22} weight="duotone" />}
          title={t("u_wsNoCompanyTitle")}
          description={t("u_auditNoCompanyDesc")}
          action={
            <Link to="/invitations" className="inline-flex min-h-11 items-center rounded-md gold-gradient px-5 text-sm font-semibold text-ink">
              {t("incomingInvitations")}
            </Link>
          }
        />
      </AppShell>
    );
  }
  if (!isOwner) return <AppShell><div className="py-16"><AccessDenied backTo="/company/settings" /></div></AppShell>;

  const rows = q.data ?? [];

  return (
    <AppShell>
      <AuditContent rows={rows} isLoading={q.isLoading} isError={q.isError} onRetry={() => q.refetch()} companyName={lang === "ar" ? active.name_ar : active.name_en} />
    </AppShell>
  );
}

function AuditContent({
  rows,
  isLoading,
  isError,
  onRetry,
  companyName,
}: {
  rows: AuditRow[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  companyName: string;
}) {
  const { t, lang } = useI18n();
  const [actionFilter, setActionFilter] = useState<string>("");
  const [entityFilter, setEntityFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const actions = useMemo(() => Array.from(new Set(rows.map((r) => r.action))).sort(), [rows]);
  const entities = useMemo(() => Array.from(new Set(rows.map((r) => r.entity))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter && r.action !== actionFilter) return false;
      if (entityFilter && r.entity !== entityFilter) return false;
      if (q) {
        const hay = `${r.action} ${r.entity} ${r.entity_id ?? ""} ${r.actor_id} ${JSON.stringify(r.metadata)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, actionFilter, entityFilter, search]);

  function exportCsv() {
    const header = ["created_at", "action", "entity", "entity_id", "actor_id", "company_id", "metadata"];
    const escape = (v: unknown) => {
      const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [header.join(",")];
    for (const r of filtered) {
      lines.push([r.created_at, r.action, r.entity, r.entity_id ?? "", r.actor_id, r.company_id ?? "", r.metadata].map(escape).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `audit-${companyName}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        eyebrow={companyName}
        title={t("auditLog")}
        description={t("auditLogDesc")}
        crumbs={[{ label: t("companies"), to: "/company/settings" }, { label: t("auditLog") }]}
        actions={
          <HeaderAction variant="secondary" onClick={exportCsv} disabled={filtered.length === 0}>
            {t("auditExportCsv")}
          </HeaderAction>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("auditSearchPlaceholder")}
          aria-label={t("auditSearchPlaceholder")}
          className="min-h-11 rounded-md border border-border bg-card px-3 text-sm text-ink outline-none focus:border-[var(--gold-deep)] sm:min-h-10"
        />
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          aria-label={t("auditFilterAction")}
          className="min-h-11 rounded-md border border-border bg-card px-3 text-sm text-ink outline-none focus:border-[var(--gold-deep)] sm:min-h-10"
        >
          <option value="">{t("auditFilterAction")} — {t("auditAll")}</option>
          {actions.map((a) => (<option key={a} value={a}>{a}</option>))}
        </select>
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          aria-label={t("auditFilterEntity")}
          className="min-h-11 rounded-md border border-border bg-card px-3 text-sm text-ink outline-none focus:border-[var(--gold-deep)] sm:min-h-10"
        >
          <option value="">{t("auditFilterEntity")} — {t("auditAll")}</option>
          {entities.map((a) => (<option key={a} value={a}>{a}</option>))}
        </select>
      </div>
      {isError && (
        <div className="mb-4">
          <ErrorState reset={onRetry} />
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-card">
        <table className="w-full min-w-[640px] text-start text-sm">
          <thead className="bg-secondary/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-start">{t("auditWhen")}</th>
              <th className="px-4 py-2 text-start">{t("auditAction")}</th>
              <th className="px-4 py-2 text-start">{t("auditEntity")}</th>
              <th className="px-4 py-2 text-start">{t("auditActor")}</th>
              <th className="px-4 py-2 text-start">{t("auditDetails")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-ink-soft">
                  {isLoading ? t("loading") : rows.length === 0 ? t("auditEmpty") : t("auditNoMatches")}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-soft">{formatDateTime(r.created_at, lang)}</td>
                  <td className="px-4 py-2.5"><code className="text-xs font-medium text-ink" dir="ltr">{r.action}</code></td>
                  <td className="px-4 py-2.5 text-xs text-ink-soft"><span dir="ltr">{r.entity}{r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ""}</span></td>
                  <td className="px-4 py-2.5 text-xs text-ink-soft"><code dir="ltr">{r.actor_id.slice(0, 8)}</code></td>
                  <td className="max-w-[320px] px-4 py-2.5 text-xs text-ink-soft">
                    <code className="block truncate rounded bg-secondary/50 px-2 py-0.5 text-[11px]" dir="ltr" title={JSON.stringify(r.metadata)}>{JSON.stringify(r.metadata)}</code>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function AuditFallback({ kind }: { kind: "error" | "notFound" }) {
  const { t } = useI18n();
  return (
    <AppShell>
      <div className="py-16">
        {kind === "error" ? <ErrorState /> : <EmptyState title={t("notFoundTitle")} />}
      </div>
    </AppShell>
  );
}
