import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { useActiveCompany } from "@/hooks/use-active-company";
import { listCompanySubmissions } from "@/lib/submissions/submissions.functions";
import { StatusBadge } from "@/components/status-badge";
import { SortHeader, Pager, comparator, clampPage } from "@/components/data-table-controls";

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

export const Route = createFileRoute("/_authenticated/company/submissions")({
  validateSearch: (s: Record<string, unknown>) => SearchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "طروحات الشركة — قيمة" },
      { name: "description", content: "حالة الطروحات المقدَّمة للاعتماد." },
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
  const navigate = useNavigate({ from: Route.fullPath });
  const patch = (p: Partial<SearchState>) => navigate({ search: (prev: SearchState) => ({ ...prev, ...p }), replace: true });
  const listFn = useServerFn(listCompanySubmissions);
  const { data, isLoading } = useQuery({
    queryKey: ["submissions", companyId],
    queryFn: () => listFn({ data: { companyId: companyId! } }),
    enabled: !!companyId,
  });
  const rows = data ?? [];
  const cmp = comparator(search.sortDir);
  const filtered = useMemo(() => {
    const q = search.q.trim().toUpperCase();
    return rows.filter((r) => {
      if (search.status !== "all" && r.status !== search.status) return false;
      if (search.asset !== "all" && r.asset_class !== search.asset) return false;
      if (q && !(r.symbol.toUpperCase().includes(q) || (r.name_en ?? "").toUpperCase().includes(q))) return false;
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
      <header className="mb-6">
        <div className="h-px hairline-gold mb-3" />
        <h1 className="text-2xl font-bold text-ink md:text-3xl">{t("submissionsIn")}</h1>
      </header>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={search.q} onChange={(e) => patch({ q: e.target.value, page: 1 })} placeholder={t("search")} className="min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" />
        <select value={search.status} onChange={(e) => patch({ status: e.target.value, page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          <option value="all">{t("filterAll")}</option>
          <option value="pending">{t("pending")}</option>
          <option value="approved">{t("approve")}</option>
          <option value="rejected">{t("reject")}</option>
        </select>
        <select value={search.asset} onChange={(e) => patch({ asset: e.target.value, page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          <option value="all">{t("filterAll")}</option>
          <option value="stock">stock</option>
          <option value="sukuk">sukuk</option>
          <option value="brand">brand</option>
        </select>
        <select value={String(pageSize)} onChange={(e) => patch({ pageSize: Number(e.target.value), page: 1 })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} {t("rowsPerPage")}</option>)}
        </select>
        <button onClick={() => patch({ q: "", status: "all", asset: "all", page: 1 })} className="rounded-md border border-border px-2 py-1.5 text-xs text-ink-soft hover:border-[var(--gold-deep)]">{t("resetFilters")}</button>
      </div>
      {isLoading ? (
        <LuxurySkeleton lines={5} />
      ) : sorted.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            <SortHeader active={search.sortBy === "symbol"} dir={search.sortDir} onClick={() => patch({ sortBy: "symbol", sortDir: search.sortBy === "symbol" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>Symbol</SortHeader>
            <SortHeader active={search.sortBy === "asset"} dir={search.sortDir} onClick={() => patch({ sortBy: "asset", sortDir: search.sortBy === "asset" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>Class</SortHeader>
            <SortHeader active={search.sortBy === "sector"} dir={search.sortDir} onClick={() => patch({ sortBy: "sector", sortDir: search.sortBy === "sector" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>Sector</SortHeader>
            <SortHeader active={search.sortBy === "submitted"} dir={search.sortDir} onClick={() => patch({ sortBy: "submitted", sortDir: search.sortBy === "submitted" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>Submitted</SortHeader>
            <SortHeader active={search.sortBy === "status"} dir={search.sortDir} onClick={() => patch({ sortBy: "status", sortDir: search.sortBy === "status" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>Status</SortHeader>
          </div>
          {paged.map((s) => (
            <div key={s.id} className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0">
              <div className="min-w-0">
                <div className="truncate font-semibold text-ink">{lang === "ar" ? s.name_ar : s.name_en}</div>
                <div className="text-[10px] font-mono uppercase text-muted-foreground">{s.symbol}</div>
              </div>
              <div className="font-mono">{s.asset_class}</div>
              <div className="text-muted-foreground">{s.sector ?? "—"}</div>
              <div className="text-muted-foreground">{new Date(s.submitted_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</div>
              <div><StatusBadge status={s.status} /></div>
            </div>
          ))}
          <Pager page={page} pageCount={pageCount} onPage={(p) => patch({ page: p })} labels={{ page: t("page"), of: t("of"), prev: t("prev"), next: t("next") }} />
        </div>
      )}
    </AppShell>
  );
}