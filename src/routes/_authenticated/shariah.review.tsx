import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { AccessDenied } from "@/components/access-denied";
import { useI18n } from "@/lib/i18n";
import { BRANDS } from "@/lib/mock-data";
import { recordShariahDecision, listShariahDecisions, updateShariahDecision, listDecisionAudit } from "@/lib/trading/shariah.functions";
import { StatusBadge } from "@/components/status-badge";
import { SortHeader, Pager, comparator, clampPage } from "@/components/data-table-controls";
import { useMyRoles } from "@/hooks/use-my-roles";
import { toast } from "sonner";

const SearchSchema = z.object({
  q: z.string().catch("").default(""),
  status: z.string().catch("all").default("all"),
  sortBy: z.string().catch("updated").default("updated"),
  sortDir: z.enum(["asc", "desc"]).catch("desc").default("desc"),
  page: z.coerce.number().int().catch(1).default(1),
  pageSize: z.coerce.number().int().catch(25).default(25),
});
type SearchState = z.infer<typeof SearchSchema>;

export const Route = createFileRoute("/_authenticated/shariah/review")({
  validateSearch: (s: Record<string, unknown>) => SearchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "لوحة المراجعة الشرعية — قيمة" },
      { name: "description", content: "اعتماد أو رفض أو طلب معلومات عن الأدوات المدرجة." },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: ReviewPage,
});

function ReviewPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const patch = (p: Partial<SearchState>) => navigate({ search: (prev: SearchState) => ({ ...prev, ...p }), replace: true });
  const { isReviewer, isLoading: rolesLoading } = useMyRoles();
  const listFn = useServerFn(listShariahDecisions);
  const recordFn = useServerFn(recordShariahDecision);
  const updateFn = useServerFn(updateShariahDecision);
  const auditFn = useServerFn(listDecisionAudit);
  const { data: decisions, isLoading } = useQuery({ queryKey: ["shariah-decisions"], queryFn: () => listFn() });
  const [reason, setReason] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<null | { id: string; status: "halal" | "non_halal" | "reviewing"; reason: string; changeReason: string; symbol: string }>(null);
  const [openAudit, setOpenAudit] = useState<string | null>(null);
  const audit = useQuery({
    queryKey: ["shariah-audit", openAudit],
    queryFn: () => auditFn({ data: { decisionId: openAudit! } }),
    enabled: !!openAudit,
  });

  const mutation = useMutation({
    mutationFn: (v: { symbol: string; status: "halal" | "non_halal" | "reviewing"; reason?: string }) => recordFn({ data: v }),
    onSuccess: () => {
      toast.success(t("submitDecision"));
      qc.invalidateQueries({ queryKey: ["shariah-decisions"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error && e.message === "FORBIDDEN" ? t("reviewerRequired") : e instanceof Error ? e.message : "Error"),
  });
  const editMut = useMutation({
    mutationFn: (v: { id: string; status: "halal" | "non_halal" | "reviewing"; reason?: string; changeReason: string }) => updateFn({ data: v }),
    onSuccess: () => {
      toast.success(t("submitDecision"));
      qc.invalidateQueries({ queryKey: ["shariah-decisions"] });
      qc.invalidateQueries({ queryKey: ["shariah-audit"] });
      setEditing(null);
    },
    onError: (e: unknown) => toast.error(e instanceof Error && e.message === "FORBIDDEN" ? t("reviewerRequired") : e instanceof Error ? e.message : "Error"),
  });

  const pool = BRANDS.filter((b) => b.assetClass !== "sukuk" || b.shariah === "reviewing").slice(0, 20);

  const cmp = comparator(search.sortDir);
  const filtered = useMemo(() => {
    const q = search.q.trim().toUpperCase();
    return (decisions ?? []).filter((d) => {
      if (search.status !== "all" && d.status !== search.status) return false;
      if (q && !d.symbol.toUpperCase().includes(q)) return false;
      return true;
    });
  }, [decisions, search.q, search.status]);
  const sorted = useMemo(() => {
    const list = filtered.slice();
    list.sort((a, b) => {
      switch (search.sortBy) {
        case "symbol": return cmp(a.symbol, b.symbol);
        case "status": return cmp(a.status, b.status);
        case "created": return cmp(a.created_at, b.created_at);
        default: return cmp(a.updated_at ?? a.created_at, b.updated_at ?? b.created_at);
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
        <div className="mb-3 h-px hairline-gold" />
        <h1 className="text-2xl font-bold text-ink md:text-3xl">{t("shariahReview")}</h1>
        {!rolesLoading && !isReviewer && (
          <p className="mt-2 text-xs text-[var(--bear)]">{t("reviewerRequired")}</p>
        )}
      </header>

      <section className="mb-8">
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          {pool.map((b) => (
            <div key={b.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto] items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{lang === "ar" ? b.nameAr : b.nameEn}</div>
                <div className="text-[10px] uppercase text-muted-foreground">{b.symbol} · {b.sector}</div>
              </div>
              <input
                placeholder={t("reason")}
                value={reason[b.symbol] ?? ""}
                onChange={(e) => setReason((r) => ({ ...r, [b.symbol]: e.target.value }))}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
              />
              <div className="flex gap-2">
                <button disabled={!isReviewer} title={!isReviewer ? t("reviewerRequired") : undefined} onClick={() => mutation.mutate({ symbol: b.symbol, status: "halal", reason: reason[b.symbol] })} className="rounded border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bull)] disabled:opacity-40">{t("approve")}</button>
                <button disabled={!isReviewer} title={!isReviewer ? t("reviewerRequired") : undefined} onClick={() => mutation.mutate({ symbol: b.symbol, status: "reviewing", reason: reason[b.symbol] })} className="rounded border border-border px-3 py-1.5 text-[11px] font-semibold text-ink-soft disabled:opacity-40">{t("requestInfo")}</button>
                <button disabled={!isReviewer} title={!isReviewer ? t("reviewerRequired") : undefined} onClick={() => mutation.mutate({ symbol: b.symbol, status: "non_halal", reason: reason[b.symbol] })} className="rounded border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bear)] disabled:opacity-40">{t("reject")}</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">{t("decisions")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search.q}
              onChange={(e) => patch({ q: e.target.value, page: 1 })}
              placeholder={t("search")}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
            />
            <select
              value={search.status}
              onChange={(e) => patch({ status: e.target.value, page: 1 })}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="all">{t("filterAll")}</option>
              <option value="halal">{t("halal")}</option>
              <option value="reviewing">{t("reviewing")}</option>
              <option value="non_halal">{t("reject")}</option>
            </select>
            <select value={String(pageSize)} onChange={(e) => patch({ pageSize: Number(e.target.value), page: 1 })} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} {t("rowsPerPage")}</option>)}
            </select>
            <button onClick={() => patch({ q: "", status: "all", page: 1 })} className="rounded-md border border-border px-2 py-1 text-xs text-ink-soft hover:border-[var(--gold-deep)]">{t("resetFilters")}</button>
          </div>
        </div>
        {isLoading ? (
          <LuxurySkeleton lines={4} />
        ) : sorted.length === 0 ? (
          <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <SortHeader active={search.sortBy === "symbol"} dir={search.sortDir} onClick={() => patch({ sortBy: "symbol", sortDir: search.sortBy === "symbol" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>Symbol</SortHeader>
              <div>Reason</div>
              <SortHeader active={search.sortBy === "updated"} dir={search.sortDir} onClick={() => patch({ sortBy: "updated", sortDir: search.sortBy === "updated" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>{t("lastUpdated")}</SortHeader>
              <SortHeader active={search.sortBy === "status"} dir={search.sortDir} onClick={() => patch({ sortBy: "status", sortDir: search.sortBy === "status" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>Status</SortHeader>
              <div>{t("auditTrail")}</div>
            </div>
            {paged.map((d) => (
              <div key={d.id} className="border-b border-border/40 px-4 py-3 last:border-b-0">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-3 text-xs">
                  <span className="font-mono font-semibold text-ink">{d.symbol}</span>
                  <span className="truncate text-muted-foreground">{d.reason ?? "—"}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {new Date(d.updated_at ?? d.created_at).toLocaleString(lang === "ar" ? "ar" : "en-US", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                  </span>
                  <StatusBadge status={d.status} />
                  <div className="flex gap-1">
                    <button
                      onClick={() => setOpenAudit((cur) => cur === d.id ? null : d.id)}
                      className="rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]"
                    >{t("auditTrail")}</button>
                    <button
                      disabled={!isReviewer}
                      title={!isReviewer ? t("reviewerRequired") : undefined}
                      onClick={() => setEditing({ id: d.id, status: d.status as never, reason: d.reason ?? "", changeReason: "", symbol: d.symbol })}
                      className="rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)] disabled:opacity-40"
                    >{t("editDecision")}</button>
                  </div>
                </div>
                {openAudit === d.id && (
                  <div className="mt-3 rounded border border-border/40 bg-background/50 p-3 text-[11px]">
                    {audit.isLoading ? (
                      <span className="text-muted-foreground">…</span>
                    ) : (audit.data ?? []).length === 0 ? (
                      <span className="text-muted-foreground">{t("noAuditYet")}</span>
                    ) : (
                      <ul className="space-y-1">
                        {audit.data!.map((a) => (
                          <li key={a.id} className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[10px] text-muted-foreground">{new Date(a.changed_at).toLocaleString(lang === "ar" ? "ar" : "en-US")}</span>
                            <span className="text-ink-soft">{a.previous_status ?? "—"} → <span className="font-semibold text-ink">{a.new_status}</span></span>
                            {a.change_reason && <span className="truncate text-muted-foreground">· {a.change_reason}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))}
            <Pager page={page} pageCount={pageCount} onPage={(p) => patch({ page: p })} labels={{ page: t("page"), of: t("of"), prev: t("prev"), next: t("next") }} />
          </div>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-border bg-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">{t("editDecision")} · {editing.symbol}</h3>
            <div className="grid gap-2">
              <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as never })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                <option value="halal">{t("halal")}</option>
                <option value="reviewing">{t("reviewing")}</option>
                <option value="non_halal">{t("reject")}</option>
              </select>
              <textarea value={editing.reason} onChange={(e) => setEditing({ ...editing, reason: e.target.value })} placeholder={t("reason")} rows={2} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" />
              <textarea value={editing.changeReason} onChange={(e) => setEditing({ ...editing, changeReason: e.target.value })} placeholder={t("changeReason")} rows={2} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" required />
              <div className="mt-2 flex justify-end gap-2">
                <button onClick={() => setEditing(null)} className="rounded border border-border px-3 py-1.5 text-xs text-ink-soft">{t("cancelled")}</button>
                <button
                  disabled={editMut.isPending || !editing.changeReason.trim()}
                  onClick={() => editMut.mutate({ id: editing.id, status: editing.status, reason: editing.reason || undefined, changeReason: editing.changeReason })}
                  className="rounded-md gold-gradient px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
                >{t("submitDecision")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}