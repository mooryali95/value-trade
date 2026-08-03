import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { AccessDenied } from "@/components/access-denied";
import { useI18n } from "@/lib/i18n";
import { listPendingSubmissions, reviewSubmission } from "@/lib/submissions/submissions.functions";
import { StatusBadge } from "@/components/status-badge";
import { SortHeader, Pager, comparator, clampPage } from "@/components/data-table-controls";
import { useMyRoles } from "@/hooks/use-my-roles";
import { toast } from "sonner";

const SearchSchema = z.object({
  q: z.string().catch("").default(""),
  status: z.string().catch("all").default("all"),
  asset: z.string().catch("all").default("all"),
  sortBy: z.string().catch("submitted").default("submitted"),
  sortDir: z.enum(["asc", "desc"]).catch("desc").default("desc"),
  page: z.coerce.number().int().catch(1).default(1),
  pageSize: z.coerce.number().int().catch(25).default(25),
});
type SearchState = z.infer<typeof SearchSchema>;

export const Route = createFileRoute("/_authenticated/admin/submissions")({
  validateSearch: (s: Record<string, unknown>) => SearchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "لوحة اعتماد الطروحات — وحدة القيمة" },
      { name: "description", content: "مراجعة طروحات الشركات واعتمادها أو رفضها." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: AdminSubmissions,
});

type Row = { id: string; symbol: string; name_ar: string; name_en: string; asset_class: string; sector: string | null; status: string; submitted_at: string; companies: { name_ar: string; name_en: string; slug: string } | null };

function AdminSubmissions() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const patch = (p: Partial<SearchState>) => navigate({ search: (prev: SearchState) => ({ ...prev, ...p }), replace: true });
  const { isReviewer, isLoading: rolesLoading } = useMyRoles();
  const listFn = useServerFn(listPendingSubmissions);
  const reviewFn = useServerFn(reviewSubmission);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["admin-submissions"], queryFn: () => listFn() as Promise<Row[]> });
  const [reason, setReason] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (v: { submissionId: string; status: "approved" | "rejected"; reason?: string }) => reviewFn({ data: v }),
    onSuccess: () => { toast.success(t("submissionReviewed")); qc.invalidateQueries({ queryKey: ["admin-submissions"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error && e.message === "FORBIDDEN" ? t("reviewerRequired") : e instanceof Error ? e.message : "Error"),
  });

  if (isLoading) return <AppShell><LuxurySkeleton lines={6} /></AppShell>;
  if (isError) return <AppShell><div className="py-16"><ErrorState reset={() => refetch()} /></div></AppShell>;
  const rows = data ?? [];
  const cmp = comparator(search.sortDir);

  const filtered = useMemo(() => {
    const q = search.q.trim().toUpperCase();
    return rows.filter((r) => {
      if (search.status !== "all" && r.status !== search.status) return false;
      if (search.asset !== "all" && r.asset_class !== search.asset) return false;
      if (q && !(r.symbol.toUpperCase().includes(q) || (r.name_en ?? "").toUpperCase().includes(q) || (r.companies?.name_en ?? "").toUpperCase().includes(q))) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search.q, search.status, search.asset]);

  const sorted = useMemo(() => {
    const list = filtered.slice();
    list.sort((a, b) => {
      switch (search.sortBy) {
        case "symbol": return cmp(a.symbol, b.symbol);
        case "asset": return cmp(a.asset_class, b.asset_class);
        case "status": return cmp(a.status, b.status);
        case "company": return cmp(a.companies?.name_en ?? "", b.companies?.name_en ?? "");
        default: return cmp(a.submitted_at, b.submitted_at);
      }
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, search.sortBy, search.sortDir]);

  const pageSize = Math.max(5, Math.min(100, search.pageSize));
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = clampPage(search.page, pageCount);
  const paged = sorted.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  if (!rolesLoading && !isReviewer) {
    return (
      <AppShell>
        <div className="py-16"><AccessDenied /></div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title={t("submissionsAdmin")}
        description={!rolesLoading && !isReviewer ? t("reviewerRequired") : undefined}
        crumbs={[{ label: "Admin", to: "/admin/submissions" }, { label: t("submissionsAdmin") }]}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input aria-label={t("a11ySearchLabel")} value={search.q} onChange={(e) => patch({ q: e.target.value, page: 1 })} placeholder={t("search")} className="min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" />
        <select aria-label={t("a11yStatusFilter")} value={search.status} onChange={(e) => patch({ status: e.target.value, page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          <option value="all">{t("filterAll")}</option>
          <option value="pending">{t("pending")}</option>
          <option value="approved">{t("approve")}</option>
          <option value="rejected">{t("reject")}</option>
        </select>
        <select aria-label={t("a11yAssetTabs")} value={search.asset} onChange={(e) => patch({ asset: e.target.value, page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          <option value="all">{t("filterAll")}</option>
          <option value="stock">stock</option>
          <option value="sukuk">sukuk</option>
          <option value="brand">brand</option>
        </select>
        <select aria-label={t("a11yRowsPerPage")} value={String(pageSize)} onChange={(e) => patch({ pageSize: Number(e.target.value), page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} {t("rowsPerPage")}</option>)}
        </select>
        <button onClick={() => patch({ q: "", status: "all", asset: "all", page: 1 })} className="rounded-md border border-border px-2 py-1.5 text-xs text-ink-soft hover:border-[var(--gold-deep)]">{t("resetFilters")}</button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_1fr_1fr_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            <SortHeader active={search.sortBy === "symbol"} dir={search.sortDir} onClick={() => patch({ sortBy: "symbol", sortDir: search.sortBy === "symbol" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>Symbol</SortHeader>
            <SortHeader active={search.sortBy === "company"} dir={search.sortDir} onClick={() => patch({ sortBy: "company", sortDir: search.sortBy === "company" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>{t("companies")}</SortHeader>
            <SortHeader active={search.sortBy === "asset"} dir={search.sortDir} onClick={() => patch({ sortBy: "asset", sortDir: search.sortBy === "asset" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>Class</SortHeader>
            <SortHeader active={search.sortBy === "submitted"} dir={search.sortDir} onClick={() => patch({ sortBy: "submitted", sortDir: search.sortBy === "submitted" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>Submitted</SortHeader>
            <SortHeader active={search.sortBy === "status"} dir={search.sortDir} onClick={() => patch({ sortBy: "status", sortDir: search.sortBy === "status" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>Status</SortHeader>
          </div>
          {paged.map((s) => (
            <div key={s.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto] items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{lang === "ar" ? s.name_ar : s.name_en}</div>
                <div className="text-[10px] font-mono uppercase text-muted-foreground">
                  {s.symbol} · {s.asset_class} · {lang === "ar" ? s.companies?.name_ar : s.companies?.name_en}
                </div>
              </div>
              <input
                placeholder={t("reason")}
                value={reason[s.id] ?? ""}
                onChange={(e) => setReason((r) => ({ ...r, [s.id]: e.target.value }))}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={s.status} />
                {s.status === "pending" && (
                  <>
                    <button disabled={!isReviewer} title={!isReviewer ? t("reviewerRequired") : undefined} onClick={() => mutation.mutate({ submissionId: s.id, status: "approved", reason: reason[s.id] })} className="rounded border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bull)] disabled:opacity-40">{t("approve")}</button>
                    <button disabled={!isReviewer} title={!isReviewer ? t("reviewerRequired") : undefined} onClick={() => mutation.mutate({ submissionId: s.id, status: "rejected", reason: reason[s.id] })} className="rounded border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bear)] disabled:opacity-40">{t("reject")}</button>
                  </>
                )}
              </div>
            </div>
          ))}
          <Pager page={page} pageCount={pageCount} onPage={(p) => patch({ page: p })} labels={{ page: t("page"), of: t("of"), prev: t("prev"), next: t("next") }} />
        </div>
      )}
    </AppShell>
  );
}