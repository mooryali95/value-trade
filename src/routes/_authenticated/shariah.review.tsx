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
import { ShariahPill, formatDateTime, instrumentName, sectorLabel } from "@/components/market-data";
import { FreeText } from "@/components/free-text";
import { recordShariahDecision, listShariahDecisions, updateShariahDecision, listDecisionAudit, listReviewInstruments } from "@/lib/trading/shariah.functions";
import { SubmissionStageBadge } from "@/lib/submissions/lifecycle";
import { SortHeader, Pager, comparator, clampPage } from "@/components/data-table-controls";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useErrorMessage } from "@/hooks/use-error-message";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
      { property: "og:title", content: "لوحة المراجعة الشرعية — وحدة القيمة | Shariah review — Value Unit" },
      { property: "og:description", content: "اعتماد أو رفض أو طلب معلومات عن الأدوات المدرجة." },
      { title: "لوحة المراجعة الشرعية — وحدة القيمة | Shariah review — Value Unit" },
      { name: "description", content: "اعتماد أو رفض أو طلب معلومات عن الأدوات المدرجة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: ReviewPage,
});

function ReviewPage() {
  const { t, lang } = useI18n();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const patch = (p: Partial<SearchState>) => navigate({ search: (prev: SearchState) => ({ ...prev, ...p }), replace: true });
  const { isReviewer, isLoading: rolesLoading } = useMyRoles();
  const listFn = useServerFn(listShariahDecisions);
  const recordFn = useServerFn(recordShariahDecision);
  const updateFn = useServerFn(updateShariahDecision);
  const auditFn = useServerFn(listDecisionAudit);
  const { data: decisions, isLoading, isError: decisionsError, refetch: refetchDecisions } = useQuery({ queryKey: ["shariah-decisions"], queryFn: () => listFn(), enabled: isReviewer });
  const [reason, setReason] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<null | { id: string; status: "halal" | "non_halal" | "reviewing"; reason: string; changeReason: string; symbol: string }>(null);
  const [openAudit, setOpenAudit] = useState<string | null>(null);
  // A ruling takes effect at once (a non-compliant one cancels resting buys):
  // the reviewer confirms it first. One that changes the status of the ruling
  // in force needs a written change reason (the server and the database
  // require it too).
  type Status = "halal" | "non_halal" | "reviewing";
  const [confirm, setConfirm] = useState<null | { symbol: string; status: Status; reason?: string; current: Status | null; changeReason: string }>(null);
  const needsChangeReason = !!confirm && confirm.current != null && confirm.current !== confirm.status;
  const audit = useQuery({
    queryKey: ["shariah-audit", openAudit],
    queryFn: () => auditFn({ data: { decisionId: openAudit! } }),
    enabled: !!openAudit,
  });

  const mutation = useMutation({
    mutationFn: (v: { symbol: string; status: Status; reason?: string; changeReason?: string }) => recordFn({ data: v }),
    onSuccess: (_res, v) => {
      setConfirm(null);
      toast.success(t("d_rulingSaved").replace("{symbol}", v.symbol));
      setReason((r) => ({ ...r, [v.symbol]: "" }));
      qc.invalidateQueries({ queryKey: ["shariah-decisions"] });
      qc.invalidateQueries({ queryKey: ["review-instruments"] });
      qc.invalidateQueries({ queryKey: ["market-overview"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e, { FORBIDDEN: "reviewerRequired" })),
  });
  const editMut = useMutation({
    mutationFn: (v: { id: string; status: "halal" | "non_halal" | "reviewing"; reason?: string; changeReason: string }) => updateFn({ data: v }),
    onSuccess: () => {
      toast.success(t("submitDecision"));
      qc.invalidateQueries({ queryKey: ["shariah-decisions"] });
      qc.invalidateQueries({ queryKey: ["shariah-audit"] });
      setEditing(null);
    },
    onError: (e: unknown) => toast.error(errorMessage(e, { FORBIDDEN: "reviewerRequired" })),
  });

  // Instruments to rule on: every instrument, listed or not, each with the
  // ruling currently in force (reviewer_instruments; role checked in SQL).
  const poolFn = useServerFn(listReviewInstruments);
  const market = useQuery({ queryKey: ["review-instruments"], queryFn: () => poolFn(), enabled: isReviewer });
  const [poolQ, setPoolQ] = useState("");
  const [poolNeeds, setPoolNeeds] = useState(false);
  // Seeded instruments with no company and no ruling (the delisted demo
  // set) are hidden unless asked for: nothing to rule on for a listing.
  const [poolSeeded, setPoolSeeded] = useState(false);
  const poolAll = market.data ?? [];
  const poolNeedle = poolQ.trim().toLowerCase();
  const poolMatches = poolAll.filter(
    (b) =>
      (poolSeeded || b.hasCompany || b.published || b.shariahStatus != null) &&
      (!poolNeeds || b.shariahStatus == null || b.shariahStatus === "reviewing") &&
      (!poolNeedle || b.symbol.toLowerCase().includes(poolNeedle) || b.nameEn.toLowerCase().includes(poolNeedle) || b.nameAr.includes(poolQ.trim())),
  );
  // Instruments without a ruling, then under review, first.
  const rank = (s: string | null) => (s == null ? 0 : s === "reviewing" ? 1 : s === "non_halal" ? 2 : 3);
  const pool = poolMatches
    .slice()
    .sort((a, b) => Number(b.hasCompany) - Number(a.hasCompany) || rank(a.shariahStatus) - rank(b.shariahStatus) || a.symbol.localeCompare(b.symbol))
    .slice(0, 50);

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
        eyebrow={t("shariahReview")}
        title={t("shariahReview")}
        description={!rolesLoading && !isReviewer ? t("reviewerRequired") : undefined}
        crumbs={[{ label: t("shariahReview") }]}
      />

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">{t("d_poolTitle")}</h2>
            <p className="text-[11px] text-muted-foreground">{t("d_poolDesc")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
              <input type="checkbox" checked={poolNeeds} onChange={(e) => setPoolNeeds(e.target.checked)} />
              {t("d_filterNeedsRuling")}
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
              <input type="checkbox" checked={poolSeeded} onChange={(e) => setPoolSeeded(e.target.checked)} />
              {t("d_showSeeded")}
            </label>
            <input
              value={poolQ}
              onChange={(e) => setPoolQ(e.target.value)}
              placeholder={t("e2_searchInstruments")}
              aria-label={t("e2_searchInstruments")}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
            />
          </div>
        </div>
        {market.isLoading || rolesLoading ? (
          <LuxurySkeleton lines={4} />
        ) : market.isError || !market.data ? (
          <ErrorState description={errorMessage(market.error)} reset={() => market.refetch()} />
        ) : poolAll.length === 0 ? (
          <EmptyState title={t("d_poolEmptyTitle")} description={t("d_poolEmptyDesc")} />
        ) : pool.length === 0 ? (
          <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} hint={t("emptyHint")} />
        ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          {pool.map((b) => (
            <div key={b.symbol} className="grid grid-cols-1 gap-2 border-b border-border/40 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto] md:items-center md:gap-3">
              <div className="min-w-0">
                <div className="break-words text-sm font-semibold text-ink md:truncate">{instrumentName(b, lang)}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span><span dir="ltr" className="font-mono uppercase">{b.symbol}</span>{b.sector ? ` · ${sectorLabel(b.sector, t)}` : ""}</span>
                  <ShariahPill status={b.shariahStatus} />
                  <span className="rounded-full border border-border px-2 py-0.5 normal-case">{b.published ? t("e2_published") : t("e2_unpublished")}</span>
                  {b.submissionStatus && <SubmissionStageBadge status={b.submissionStatus} />}
                </div>
              </div>
              <input
                placeholder={t("reason")}
                aria-label={`${t("reason")} · ${b.symbol}`}
                value={reason[b.symbol] ?? ""}
                onChange={(e) => setReason((r) => ({ ...r, [b.symbol]: e.target.value }))}
                className="min-h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <button disabled={!isReviewer || mutation.isPending} title={!isReviewer ? t("reviewerRequired") : undefined} onClick={() => setConfirm({ symbol: b.symbol, status: "halal", reason: reason[b.symbol] || undefined, current: b.shariahStatus, changeReason: "" })} className="min-h-9 rounded border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bull)] disabled:opacity-40">{t("approve")}</button>
                <button disabled={!isReviewer || mutation.isPending} title={!isReviewer ? t("reviewerRequired") : undefined} onClick={() => setConfirm({ symbol: b.symbol, status: "reviewing", reason: reason[b.symbol] || undefined, current: b.shariahStatus, changeReason: "" })} className="min-h-9 rounded border border-border px-3 py-1.5 text-[11px] font-semibold text-ink-soft disabled:opacity-40">{t("requestInfo")}</button>
                <button disabled={!isReviewer || mutation.isPending} title={!isReviewer ? t("reviewerRequired") : undefined} onClick={() => setConfirm({ symbol: b.symbol, status: "non_halal", reason: reason[b.symbol] || undefined, current: b.shariahStatus, changeReason: "" })} className="min-h-9 rounded border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bear)] disabled:opacity-40">{t("reject")}</button>
              </div>
            </div>
          ))}
          {poolMatches.length > pool.length && (
            <p className="px-4 py-2 text-[11px] text-muted-foreground">{t("e2_reviewPoolMore").replace("{n}", String(poolMatches.length - pool.length))}</p>
          )}
        </div>
        )}
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
              <option value="halal">{t("e2_shariahHalal")}</option>
              <option value="reviewing">{t("e2_shariahReviewing")}</option>
              <option value="non_halal">{t("e2_shariahNonHalal")}</option>
            </select>
            <select value={String(pageSize)} onChange={(e) => patch({ pageSize: Number(e.target.value), page: 1 })} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} {t("rowsPerPage")}</option>)}
            </select>
            <button onClick={() => patch({ q: "", status: "all", page: 1 })} className="rounded-md border border-border px-2 py-1 text-xs text-ink-soft hover:border-[var(--gold-deep)]">{t("resetFilters")}</button>
          </div>
        </div>
        {isLoading || rolesLoading ? (
          <LuxurySkeleton lines={4} />
        ) : decisionsError ? (
          <ErrorState reset={() => refetchDecisions()} />
        ) : sorted.length === 0 ? (
          search.q || search.status !== "all" ? (
            <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} hint={t("emptyHint")} />
          ) : (
            <EmptyState title={t("emptyDecisionsTitle")} description={t("emptyDecisionsDesc")} />
          )
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <div className="hidden grid-cols-[auto_minmax(8rem,1fr)_auto_auto_auto] items-center gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground md:grid">
              <SortHeader active={search.sortBy === "symbol"} dir={search.sortDir} onClick={() => patch({ sortBy: "symbol", sortDir: search.sortBy === "symbol" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>{t("e2_colSymbol")}</SortHeader>
              <div>{t("reason")}</div>
              <SortHeader active={search.sortBy === "updated"} dir={search.sortDir} onClick={() => patch({ sortBy: "updated", sortDir: search.sortBy === "updated" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>{t("lastUpdated")}</SortHeader>
              <SortHeader active={search.sortBy === "status"} dir={search.sortDir} onClick={() => patch({ sortBy: "status", sortDir: search.sortBy === "status" && search.sortDir === "asc" ? "desc" : "asc", page: 1 })}>{t("filterStatus")}</SortHeader>
              <div>{t("auditTrail")}</div>
            </div>
            {paged.map((d) => (
              <div key={d.id} className="border-b border-border/40 px-4 py-3 last:border-b-0">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs md:grid-cols-[auto_minmax(8rem,1fr)_auto_auto_auto]">
                  <span className="font-mono font-semibold text-ink" dir="ltr">{d.symbol}</span>
                  <span className="justify-self-end md:order-4 md:justify-self-auto"><ShariahPill status={d.status as "halal" | "non_halal" | "reviewing"} /></span>
                  <FreeText text={d.reason} className="col-span-2 break-words text-muted-foreground md:order-2 md:col-span-1" />
                  <span className="text-[10px] tabular-nums text-muted-foreground md:order-3">
                    {formatDateTime(d.updated_at ?? d.created_at, lang)}
                  </span>
                  <div className="flex justify-end gap-1 md:order-5">
                    <button
                      onClick={() => setOpenAudit((cur) => cur === d.id ? null : d.id)}
                      className="min-h-8 rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]"
                    >{t("auditTrail")}</button>
                    <button
                      disabled={!isReviewer}
                      title={!isReviewer ? t("reviewerRequired") : undefined}
                      onClick={() => setEditing({ id: d.id, status: d.status as never, reason: d.reason ?? "", changeReason: "", symbol: d.symbol })}
                      className="min-h-8 rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)] disabled:opacity-40"
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
                            <span className="text-[10px] tabular-nums text-muted-foreground">{formatDateTime(a.changed_at, lang)}</span>
                            <span className="inline-flex flex-wrap items-center gap-1 text-ink-soft">
                              {a.previous_status ? <ShariahPill status={a.previous_status as "halal" | "non_halal" | "reviewing"} /> : "—"}
                              <span aria-hidden>{lang === "ar" ? "←" : "→"}</span>
                              <ShariahPill status={a.new_status as "halal" | "non_halal" | "reviewing"} />
                            </span>
                            {a.change_reason && <FreeText text={a.change_reason} className="break-words text-muted-foreground" />}
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

      <Dialog open={!!confirm} onOpenChange={(o) => !o && !mutation.isPending && setConfirm(null)}>
        {confirm && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("d_confirmRuling").replace("{symbol}", confirm.symbol)}</DialogTitle>
              <DialogDescription>{t("d_confirmRulingDesc")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">{t("shariahStatus")}:</span>
                {needsChangeReason && (
                  <>
                    <ShariahPill status={confirm.current} />
                    <span aria-hidden>{lang === "ar" ? "←" : "→"}</span>
                  </>
                )}
                <ShariahPill status={confirm.status} />
              </div>
              {confirm.reason && <p className="text-ink-soft"><span className="text-muted-foreground">{t("reason")}:</span> {confirm.reason}</p>}
              {needsChangeReason && (
                <label className="grid gap-1">
                  <span className="text-muted-foreground">{t("changeReason")}</span>
                  <textarea
                    value={confirm.changeReason}
                    onChange={(e) => setConfirm({ ...confirm, changeReason: e.target.value })}
                    rows={2}
                    maxLength={600}
                    required
                    aria-describedby="ruling-change-reason-hint"
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
                  />
                  <span id="ruling-change-reason-hint" className="text-[11px] text-muted-foreground">{t("fl_changeReasonHint")}</span>
                </label>
              )}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setConfirm(null)} disabled={mutation.isPending} className="rounded border border-border px-3 py-1.5 text-xs text-ink-soft">{t("cancel")}</button>
                <button
                  type="button"
                  disabled={mutation.isPending || (needsChangeReason && !confirm.changeReason.trim())}
                  onClick={() =>
                    mutation.mutate({
                      symbol: confirm.symbol,
                      status: confirm.status,
                      reason: confirm.reason,
                      changeReason: needsChangeReason ? confirm.changeReason.trim() : undefined,
                    })
                  }
                  className="rounded-md gold-gradient px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
                >{mutation.isPending ? t("loading") : t("submitDecision")}</button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {t("editDecision")} · {editing.symbol}
              </DialogTitle>
              <DialogDescription>{t("editDecisionDesc")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <select aria-label={t("shariahStatus")} value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as never })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                <option value="halal">{t("e2_shariahHalal")}</option>
                <option value="reviewing">{t("e2_shariahReviewing")}</option>
                <option value="non_halal">{t("e2_shariahNonHalal")}</option>
              </select>
              <textarea aria-label={t("reason")} value={editing.reason} onChange={(e) => setEditing({ ...editing, reason: e.target.value })} placeholder={t("reason")} rows={2} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" />
              <textarea aria-label={t("changeReason")} value={editing.changeReason} onChange={(e) => setEditing({ ...editing, changeReason: e.target.value })} placeholder={t("changeReason")} rows={2} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" required />
              <div className="mt-2 flex justify-end gap-2">
                <button onClick={() => setEditing(null)} className="rounded border border-border px-3 py-1.5 text-xs text-ink-soft">{t("cancel")}</button>
                <button
                  disabled={editMut.isPending || !editing.changeReason.trim()}
                  onClick={() => editMut.mutate({ id: editing.id, status: editing.status, reason: editing.reason || undefined, changeReason: editing.changeReason })}
                  className="rounded-md gold-gradient px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
                >{t("submitDecision")}</button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </AppShell>
  );
}