import { createFileRoute } from "@tanstack/react-router";
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
  head: () => ({ meta: [{ title: "Audit log — Value" }] }),
  component: CompanyAuditPage,
  errorComponent: () => <AuditFallback kind="error" />,
  notFoundComponent: () => <AuditFallback kind="notFound" />,
});

function CompanyAuditPage() {
  const { t, lang } = useI18n();
  const { active } = useActiveCompany();
  const { companyRole } = useMyRoles();
  const listFn = useServerFn(listAuditLog);
  const myRole = active ? companyRole(active.id) : undefined;
  const isOwner = myRole === "owner";

  const q = useQuery<AuditRow[]>({
    queryKey: ["audit-log", active?.id],
    queryFn: () => listFn({ data: { companyId: active!.id, limit: 100 } }),
    enabled: !!active && isOwner,
    staleTime: 30_000,
  });

  if (!active) return <div className="p-8 text-sm text-ink-soft">—</div>;
  if (!isOwner) return <div className="p-8"><AccessDenied backTo="/company/settings" /></div>;

  const rows = q.data ?? [];

  return <AuditContent rows={rows} isLoading={q.isLoading} companyName={lang === "ar" ? active.name_ar : active.name_en} />;
}

function AuditContent({ rows, isLoading, companyName }: { rows: AuditRow[]; isLoading: boolean; companyName: string }) {
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
    <div className="mx-auto max-w-5xl p-6">
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
          className="rounded-md border border-border bg-card px-3 py-2 text-sm text-ink outline-none focus:border-[var(--gold-deep)]"
        />
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm text-ink outline-none focus:border-[var(--gold-deep)]"
        >
          <option value="">{t("auditFilterAction")} — {t("auditAll")}</option>
          {actions.map((a) => (<option key={a} value={a}>{a}</option>))}
        </select>
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm text-ink outline-none focus:border-[var(--gold-deep)]"
        >
          <option value="">{t("auditFilterEntity")} — {t("auditAll")}</option>
          {entities.map((a) => (<option key={a} value={a}>{a}</option>))}
        </select>
      </div>
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <table className="w-full text-start text-sm">
          <thead className="bg-secondary/40 text-[11px] uppercase tracking-[0.14em] text-ink-soft">
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
                  {isLoading ? "…" : rows.length === 0 ? t("auditEmpty") : t("auditNoMatches")}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="px-4 py-2 text-xs text-ink-soft">
                    {new Date(r.created_at).toLocaleString(lang === "ar" ? "ar" : "en")}
                  </td>
                  <td className="px-4 py-2 font-medium text-ink">{r.action}</td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{r.entity}{r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ""}</td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{r.actor_id.slice(0, 8)}</td>
                  <td className="px-4 py-2 text-xs text-ink-soft">
                    <code className="rounded bg-secondary/50 px-2 py-0.5 text-[10px]">{JSON.stringify(r.metadata)}</code>
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
    <div className="p-8 text-sm text-ink-soft">
      {kind === "error" ? t("loadFailed") : t("notFoundTitle")}
    </div>
  );
}
