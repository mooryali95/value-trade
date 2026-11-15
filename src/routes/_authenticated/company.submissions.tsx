import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n, type Key } from "@/lib/i18n";
import { useActiveCompany } from "@/hooks/use-active-company";
import { listCompanySubmissions } from "@/lib/submissions/submissions.functions";
import { LifecycleSteps, NEXT_STEP, StageProgress, SubmissionStageBadge } from "@/lib/submissions/lifecycle";
import { SortHeader, Pager, comparator, clampPage } from "@/components/data-table-controls";
import { SubmissionDocuments } from "@/components/submission-documents";
import { sectorLabel } from "@/components/market-data";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useState } from "react";

const SearchSchema = z.object({
  companyId: z.string().uuid().optional(),
  q: z.string().catch("").default(""),
  status: z.string().catch("all").default("all"),
  asset: z.string().catch("all").default("all"),
  sortBy: z.string().catch("submitted").default("submitted"),
  sortDir: z.enum(["asc", "desc"]).catch("desc").default("desc"),
  page: z.coerce.number().int().catch(1).default(1),
  pageSize: z.coerce.number().int().catch(25).default(25),
});
type SearchState = z.infer<typeof SearchSchema>;

const ASSET_LABEL: Record<string, Key> = { stock: "g_assetStock", sukuk: "g_assetSukuk", brand: "g_assetBrand" };

export const Route = createFileRoute("/_authenticated/company/submissions")({
  validateSearch: (s: Record<string, unknown>) => SearchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "طلبات إدراج الشركة — وحدة القيمة | Company listing submissions — Value Unit" },
      { name: "description", content: "مراحل طلبات الإدراج المقدَّمة: المراجعة الشرعية ثم اعتماد الإدراج." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: CompanySubmissions,
});

function CompanySubmissions() {
  const { t, lang } = useI18n();
  const search = Route.useSearch();
  const { activeId } = useActiveCompany();
  const companyId = search.companyId ?? activeId ?? undefined;
  const { companyRole } = useMyRoles();
  const role = companyId ? companyRole(companyId) : undefined;
  const canManageDocs = role === "owner" || role === "finance";
  const [openDocs, setOpenDocs] = useState<string | null>(null);
  const navigate = useNavigate({ from: Route.fullPath });
  const patch = (p: Partial<SearchState>) => navigate({ search: (prev: SearchState) => ({ ...prev, ...p }), replace: true });
  const listFn = useServerFn(listCompanySubmissions);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["submissions", companyId],
    queryFn: () => listFn({ data: { companyId: companyId! } }),
    enabled: !!companyId,
  });
  const rows = useMemo(() => data ?? [], [data]);
  const cmp = comparator(search.sortDir);
  const filtered = useMemo(() => {
    const q = search.q.trim().toUpperCase();
    return rows.filter((r) => {
      if (search.status !== "all" && r.status !== search.status) return false;
      if (search.asset !== "all" && r.asset_class !== search.asset) return false;
      if (q && !(r.symbol.toUpperCase().includes(q) || (r.name_en ?? "").toUpperCase().includes(q) || (r.name_ar ?? "").includes(search.q.trim()))) return false;
      return true;
    });
  }, [rows, search.q, search.status, search.asset]);
  const sorted = useMemo(() => {
    const list = filtered.slice();
    list.sort((a, b) => {
      switch (search.sortBy) {
        case "symbol": return cmp(a.symbol, b.symbol);
        case "asset": return cmp(a.asset_class, b.asset_class);
        case "sector": return cmp(a.sector ?? "", b.sector ?? "");
        case "status": return cmp(a.status, b.status);
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

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("companies")}
        title={t("submissionsIn")}
        crumbs={[{ label: t("companies"), to: "/company/settings" }, { label: t("submissionsIn") }]}
      />
      <LifecycleSteps />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={search.q} onChange={(e) => patch({ q: e.target.value, page: 1 })} placeholder={t("g_searchSubmissions")} aria-label={t("g_searchSubmissions")} className="min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" />
        <select aria-label={t("g_filterStatus")} value={search.status} onChange={(e) => patch({ status: e.target.value, page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          <option value="all">{t("filterAll")}</option>
          <option value="pending">{t("d_stPending")}</option>
          <option value="approved">{t("d_stApproved")}</option>
          <option value="listed">{t("d_stListed")}</option>
          <option value="rejected">{t("d_stRejected")}</option>
        </select>
        <select aria-label={t("g_filterAssetClass")} value={search.asset} onChange={(e) => patch({ asset: e.target.value, page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          <option value="all">{t("filterAll")}</option>
          <option value="stock">{t("g_assetStock")}</option>
          <option value="sukuk">{t("g_assetSukuk")}</option>
          <option value="brand">{t("g_assetBrand")}</option>
        </select>
        <select aria-label={t("rowsPerPage")} value={String(pageSize)} onChange={(e) => patch({ pageSize: Number(e.target.value), page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} {t("rowsPerPage")}</option>)}
        </select>
        <button type="button" onClick={() => patch({ q: "", status: "all", asset: "all", page: 1 })} className="rounded-md border border-border px-2 py-1.5 text-xs text-ink-soft hover:border-[var(--gold-deep)]">{t("resetFilters")}</button>
      </div>
      {!companyId ? (
        <EmptyState title={t("g_noCompanyTitle")} description={t("g_noCompanyDesc")} />
      ) : isLoading ? (
        <LuxurySkeleton lines={5} />
      ) : isError ? (
        <ErrorState reset={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("g_noSubmissionsTitle")}
          description={t("g_noSubmissionsDesc")}
          action={
            canManageDocs ? (
              <Link
                to="/company/submit"
                search={{ companyId }}
                className="inline-flex min-h-11 items-center rounded-md gold-gradient px-4 py-2 text-xs font-semibold text-ink"
              >
                {t("g_submitFirst")}
              </Link>
            ) : undefined
          }
        />
      ) : sorted.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} hint={t("emptyHint")} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            <SortHeader active={search.sortBy === "symbol"} dir={search.sortDir} onClick={() => patch({ sortBy: "symbol", sortDir: search.sortBy === "symbol" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>{t("g_colSymbol")}</SortHeader>
            <SortHeader active={search.sortBy === "asset"} dir={search.sortDir} onClick={() => patch({ sortBy: "asset", sortDir: search.sortBy === "asset" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>{t("g_colClass")}</SortHeader>
            <SortHeader active={search.sortBy === "sector"} dir={search.sortDir} onClick={() => patch({ sortBy: "sector", sortDir: search.sortBy === "sector" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>{t("sector")}</SortHeader>
            <SortHeader active={search.sortBy === "submitted"} dir={search.sortDir} onClick={() => patch({ sortBy: "submitted", sortDir: search.sortBy === "submitted" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>{t("g_colSubmitted")}</SortHeader>
            <SortHeader active={search.sortBy === "status"} dir={search.sortDir} onClick={() => patch({ sortBy: "status", sortDir: search.sortBy === "status" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>{t("g_colStatus")}</SortHeader>
          </div>
          {paged.map((s) => (
            <div key={s.id} className="border-b border-border/40 last:border-b-0">
            <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto] items-center gap-3 px-4 py-3 text-xs">
              <div className="min-w-0">
                <div className="truncate font-semibold text-ink">{lang === "ar" ? s.name_ar : s.name_en}</div>
                <div className="text-[10px] font-mono uppercase text-muted-foreground">{s.symbol}</div>
              </div>
              <div>{ASSET_LABEL[s.asset_class] ? t(ASSET_LABEL[s.asset_class]) : s.asset_class}</div>
              <div className="text-muted-foreground">{sectorLabel(s.sector, t) || "—"}</div>
              <div className="text-muted-foreground">{new Date(s.submitted_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</div>
              <div className="flex items-center gap-2">
                <SubmissionStageBadge status={s.status} />
                <button
                  type="button"
                  onClick={() => setOpenDocs((cur) => (cur === s.id ? null : s.id))}
                  aria-expanded={openDocs === s.id}
                  className="rounded border border-border px-2 py-1 text-[10px] font-semibold text-ink-soft hover:border-[var(--gold-deep)]"
                >
                  {t("documents")}
                </button>
              </div>
            </div>
            <div className="space-y-1 px-4 pb-3 text-[11px]">
              <StageProgress status={s.status} />
              {NEXT_STEP[s.status] && (
                <p className="text-ink-soft">
                  <span className="font-semibold text-ink">{t("d_nextStep")}:</span> {t(NEXT_STEP[s.status])}
                </p>
              )}
              {s.review_reason && (
                <p className="text-ink-soft">
                  <span className="font-semibold text-ink">{t("d_reviewerNote")}:</span> {s.review_reason}
                </p>
              )}
              {s.listing_reason && (
                <p className="text-ink-soft">
                  <span className="font-semibold text-ink">{t("d_listingNote")}:</span> {s.listing_reason}
                </p>
              )}
            </div>
            {openDocs === s.id && (
              <div className="px-4 pb-3">
                <SubmissionDocuments submissionId={s.id} canUpload={canManageDocs} canDelete={role === "owner"} />
              </div>
            )}
            </div>
          ))}
          <Pager page={page} pageCount={pageCount} onPage={(p) => patch({ page: p })} labels={{ page: t("page"), of: t("of"), prev: t("prev"), next: t("next") }} />
        </div>
      )}
    </AppShell>
  );
}