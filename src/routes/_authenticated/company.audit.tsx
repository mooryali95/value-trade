import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useI18n } from "@/lib/i18n";
import { useActiveCompany } from "@/hooks/use-active-company";
import { useMyRoles } from "@/hooks/use-my-roles";
import { AccessDenied } from "@/components/access-denied";
import { listAuditLog, type AuditRow } from "@/lib/audit/audit.functions";

export const Route = createFileRoute("/_authenticated/company/audit")({
  head: () => ({ meta: [{ title: "Audit log — Value" }] }),
  component: CompanyAuditPage,
  errorComponent: () => <div className="p-8 text-sm text-ink-soft">Failed to load audit log.</div>,
  notFoundComponent: () => <div className="p-8 text-sm text-ink-soft">Not found.</div>,
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

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <div className="mb-3 h-px w-16 hairline-gold" />
        <h1 className="text-2xl font-semibold text-ink">{t("auditLog")}</h1>
        <p className="mt-1 text-xs text-ink-soft">{t("auditLogDesc")}</p>
      </header>
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-ink-soft">
                  {q.isLoading ? "…" : t("auditEmpty")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
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