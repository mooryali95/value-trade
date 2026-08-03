import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import {
  listAccessRequests,
  approveAccessRequest,
  rejectAccessRequest,
  type AccessRequestRow,
} from "@/lib/access/access-requests.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/access-requests")({
  head: () => ({
    meta: [{ title: "طلبات الانضمام — وحدة القيمة" }, { name: "robots", content: "noindex" }],
  }),
  errorComponent: ({ reset }) => (
    <AppShell>
      <div className="py-16">
        <ErrorState reset={reset} />
      </div>
    </AppShell>
  ),
  component: AccessRequestsPage,
});

type Row = AccessRequestRow;

const ROLE_OPTIONS = ["finance", "shariah", "trader", "viewer"] as const;

function slugify(nameEn: string): string {
  return (
    nameEn
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "company"
  );
}

function AccessRequestsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listAccessRequests);
  const approveFn = useServerFn(approveAccessRequest);
  const rejectFn = useServerFn(rejectAccessRequest);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["access-requests"],
    queryFn: () => listFn(),
  });

  const [roleById, setRoleById] = useState<Record<string, string>>({});
  const [sectorById, setSectorById] = useState<Record<string, string>>({});
  const [slugById, setSlugById] = useState<Record<string, string>>({});

  const approve = useMutation({
    mutationFn: (row: Row) => {
      if (row.requested_company_id) {
        return approveFn({
          data: {
            requestId: row.id,
            role: (roleById[row.id] ?? "viewer") as (typeof ROLE_OPTIONS)[number],
            origin: typeof window !== "undefined" ? window.location.origin : undefined,
          },
        });
      }
      const defaultSlug = slugify(row.new_company_name_en ?? "");
      return approveFn({
        data: {
          requestId: row.id,
          sector: sectorById[row.id] ?? "",
          slug: slugById[row.id] || defaultSlug,
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("accessRequestApproved"));
      qc.invalidateQueries({ queryKey: ["access-requests"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error && e.message === "INVITATION_ALREADY_PENDING" ? t("inviteAlreadyPending") : e instanceof Error ? e.message : "Error"),
  });

  const reject = useMutation({
    mutationFn: (requestId: string) => rejectFn({ data: { requestId } }),
    onSuccess: () => {
      toast.success(t("accessRequestRejected"));
      qc.invalidateQueries({ queryKey: ["access-requests"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  if (isLoading)
    return (
      <AppShell>
        <LuxurySkeleton lines={6} />
      </AppShell>
    );
  if (isError)
    return (
      <AppShell>
        <div className="py-16">
          <ErrorState reset={() => refetch()} />
        </div>
      </AppShell>
    );

  const rows = data ?? [];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title={t("accessRequestsQueue")}
        description={t("accessRequestsQueueDesc")}
        crumbs={[{ label: t("accessRequestsQueue") }]}
      />

      {rows.length === 0 ? (
        <EmptyState title={t("noAccessRequests")} description="" />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const isNewCompany = !r.requested_company_id;
            return (
              <div key={r.id} className="rounded-xl border border-border/60 bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-ink">
                      {r.full_name} ·{" "}
                      <span className="font-normal text-muted-foreground">{r.email}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {isNewCompany
                        ? `${t("newCompanyRequest")} — ${lang === "ar" ? r.new_company_name_ar : r.new_company_name_en}`
                        : `${t("joinCompanyRequest")} — ${lang === "ar" ? r.companies?.name_ar : r.companies?.name_en}`}
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isNewCompany ? (
                    <>
                      <input
                        placeholder={t("classifySector")}
                        value={sectorById[r.id] ?? ""}
                        onChange={(e) => setSectorById((s) => ({ ...s, [r.id]: e.target.value }))}
                        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
                      />
                      <input
                        placeholder={t("companySlug")}
                        value={slugById[r.id] ?? slugify(r.new_company_name_en ?? "")}
                        onChange={(e) => setSlugById((s) => ({ ...s, [r.id]: e.target.value }))}
                        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono focus:border-[var(--gold-deep)] focus:outline-none"
                      />
                    </>
                  ) : (
                    <select
                      value={roleById[r.id] ?? "viewer"}
                      onChange={(e) => setRoleById((s) => ({ ...s, [r.id]: e.target.value }))}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    disabled={approve.isPending || (isNewCompany && !sectorById[r.id])}
                    onClick={() => approve.mutate(r)}
                    className="rounded border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bull)] disabled:opacity-40"
                  >
                    {t("approve")}
                  </button>
                  <button
                    disabled={reject.isPending}
                    onClick={() => reject.mutate(r.id)}
                    className="rounded border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bear)] disabled:opacity-40"
                  >
                    {t("reject")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
