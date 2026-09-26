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
import { Num } from "@/components/num";
import { ShariahPill } from "@/components/market-data";
import { useI18n, type Key } from "@/lib/i18n";
import {
  approveListing,
  declineListing,
  listListingHolders,
  listPendingSubmissions,
  reviewSubmission,
  type QueueSubmission,
} from "@/lib/submissions/submissions.functions";
import { LifecycleSteps, SubmissionStageBadge } from "@/lib/submissions/lifecycle";
import { isValidOrderQty, isValidReferencePrice } from "@/lib/trading/calc";
import { SortHeader, Pager, comparator, clampPage } from "@/components/data-table-controls";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useErrorMessage } from "@/hooks/use-error-message";
import { SubmissionDocuments } from "@/components/submission-documents";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

const ASSET_LABEL: Record<string, Key> = { stock: "g_assetStock", sukuk: "g_assetSukuk", brand: "g_assetBrand" };
const HOLDER_ROLE: Record<string, Key> = { owner: "r_roleOwner", finance: "r_roleFinance" };

/** Lifecycle error codes -> messages (the rest go through CODE_TO_KEY). */
const LIFECYCLE_ERRORS: Partial<Record<string, Key>> = {
  FORBIDDEN: "reviewerRequired",
  SUBMISSION_NOT_PENDING: "errSubmissionNotPending",
  SUBMISSION_NOT_FOUND: "errSubmissionNotPending",
  SUBMISSION_NOT_APPROVED: "d_errNotApproved",
  SUBMISSION_TRANSITION_FORBIDDEN: "d_errTransition",
  INVALID_SYMBOL: "errInvalidSymbol",
  SHARIAH_RULING_CONFLICT: "d_errRulingConflict",
  RULING_CHANGE_REASON_REQUIRED: "d_errRulingChangeReason",
  SHARIAH_RULING_REQUIRED: "fx_publishNeedsRuling",
  SHARIAH_NOT_HALAL: "d_errNotHalal",
  REJECTION_REASON_REQUIRED: "rejectionReasonRequired",
  BRAND_CAP_REACHED: "d_errBrandCap",
};

export const Route = createFileRoute("/_authenticated/admin/submissions")({
  validateSearch: (s: Record<string, unknown>) => SearchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "طلبات الإدراج واعتمادها — وحدة القيمة | Listing submissions — Value Unit" },
      { name: "description", content: "المراجعة الشرعية لطلبات الشركات واعتماد إدراجها في السوق." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: AdminSubmissions,
});

function AdminSubmissions() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const patch = (p: Partial<SearchState>) => navigate({ search: (prev: SearchState) => ({ ...prev, ...p }), replace: true });
  const { isReviewer, isAdmin, isLoading: rolesLoading } = useMyRoles();
  const allowed = isReviewer || isAdmin;
  const listFn = useServerFn(listPendingSubmissions);
  const reviewFn = useServerFn(reviewSubmission);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-submissions"],
    queryFn: () => listFn(),
    enabled: allowed,
  });
  const [reason, setReason] = useState<Record<string, string>>({});
  const [replace, setReplace] = useState<Record<string, boolean>>({});
  const [listing, setListing] = useState<QueueSubmission | null>(null);
  const [declining, setDeclining] = useState<QueueSubmission | null>(null);
  const errorMessage = useErrorMessage();

  const mutation = useMutation({
    mutationFn: (v: { submissionId: string; status: "approved" | "rejected"; reason?: string; replaceRuling?: boolean }) =>
      reviewFn({ data: v }),
    onSuccess: (res) => {
      toast.success(
        t(res.status === "approved" ? (res.rulingRecorded ? "d_approvedToast" : "d_approvedKeptToast") : "d_rejectedToast"),
      );
      qc.invalidateQueries({ queryKey: ["admin-submissions"] });
      qc.invalidateQueries({ queryKey: ["shariah-decisions"] });
      qc.invalidateQueries({ queryKey: ["review-instruments"] });
    },
    onError: (e: unknown) => {
      toast.error(errorMessage(e, LIFECYCLE_ERRORS));
      qc.invalidateQueries({ queryKey: ["admin-submissions"] });
    },
  });

  const rows = useMemo(() => data ?? [], [data]);
  const cmp = comparator(search.sortDir);

  const filtered = useMemo(() => {
    const q = search.q.trim().toUpperCase();
    const qAr = search.q.trim();
    return rows.filter((r) => {
      if (search.status !== "all" && r.status !== search.status) return false;
      if (search.asset !== "all" && r.asset_class !== search.asset) return false;
      if (q && !(r.symbol.toUpperCase().includes(q) || (r.name_en ?? "").toUpperCase().includes(q) || (r.name_ar ?? "").includes(qAr) || (r.companies?.name_en ?? "").toUpperCase().includes(q) || (r.companies?.name_ar ?? "").includes(qAr))) return false;
      return true;
    });
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

  if (!rolesLoading && !allowed) {
    return (
      <AppShell>
        <div className="py-16"><AccessDenied /></div>
      </AppShell>
    );
  }

  if (rolesLoading || isLoading) return <AppShell><LuxurySkeleton lines={6} /></AppShell>;
  if (isError) return <AppShell><div className="py-16"><ErrorState reset={() => refetch()} /></div></AppShell>;

  const description = [isReviewer ? t("d_queueDescReviewer") : null, isAdmin ? t("d_queueDescAdmin") : null]
    .filter(Boolean)
    .join(" ");
  const sortClick = (key: string) =>
    patch({ sortBy: key, sortDir: search.sortBy === key && search.sortDir === "asc" ? "desc" : "asc", page: 1 });

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("modePlatform")}
        title={t("d_queueTitle")}
        description={description}
        crumbs={[{ label: t("modePlatform"), to: "/admin/submissions" }, { label: t("d_queueTitle") }]}
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

      {rows.length === 0 ? (
        <EmptyState title={t("g_noReviewQueueTitle")} description={t("g_noReviewQueueDesc")} />
      ) : sorted.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_1fr_1fr_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground md:grid">
            <SortHeader active={search.sortBy === "symbol"} dir={search.sortDir} onClick={() => sortClick("symbol")}>{t("g_colSymbol")}</SortHeader>
            <SortHeader active={search.sortBy === "company"} dir={search.sortDir} onClick={() => sortClick("company")}>{t("company")}</SortHeader>
            <SortHeader active={search.sortBy === "asset"} dir={search.sortDir} onClick={() => sortClick("asset")}>{t("g_colClass")}</SortHeader>
            <SortHeader active={search.sortBy === "submitted"} dir={search.sortDir} onClick={() => sortClick("submitted")}>{t("g_colSubmitted")}</SortHeader>
            <SortHeader active={search.sortBy === "status"} dir={search.sortDir} onClick={() => sortClick("status")}>{t("g_colStatus")}</SortHeader>
          </div>
          {paged.map((s) => {
            const note = reason[s.id] ?? "";
            const conflict = s.status === "pending" && (s.shariahStatus === "non_halal" || s.shariahStatus === "reviewing");
            const replacing = replace[s.id] === true;
            const approveBlocked = conflict && (!replacing || note.trim().length < 10);
            return (
              <div key={s.id} className="border-b border-border/40 last:border-b-0">
                <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_1fr_1fr_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{lang === "ar" ? s.name_ar : s.name_en}</div>
                    <div className="font-mono text-[10px] uppercase text-muted-foreground">{s.symbol}</div>
                  </div>
                  <div className="min-w-0 truncate text-xs text-ink-soft">{(lang === "ar" ? s.companies?.name_ar : s.companies?.name_en) ?? "—"}</div>
                  <div className="text-xs text-ink-soft">{ASSET_LABEL[s.asset_class] ? t(ASSET_LABEL[s.asset_class]) : s.asset_class}</div>
                  <div className="text-xs text-muted-foreground">{new Date(s.submitted_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SubmissionStageBadge status={s.status} />
                    <ShariahPill status={s.shariahStatus} />
                  </div>
                </div>

                <div className="space-y-2 px-4 pb-3 text-[11px]">
                  {s.instrument && (
                    <p className="text-ink-soft">
                      <span className="font-semibold text-ink">{t("d_instrument")}:</span>{" "}
                      <span className="font-mono">{s.instrument.symbol}</span> · {t("referencePrice")}:{" "}
                      {s.instrument.referencePrice > 0 ? <Num value={s.instrument.referencePrice} kind="currency" /> : "—"} ·{" "}
                      {s.instrument.published ? t("e2_published") : t("e2_unpublished")}
                    </p>
                  )}
                  {s.review_reason && (
                    <p className="text-ink-soft"><span className="font-semibold text-ink">{t("d_reviewerNote")}:</span> {s.review_reason}</p>
                  )}
                  {s.listing_reason && (
                    <p className="text-ink-soft"><span className="font-semibold text-ink">{t("d_listingNote")}:</span> {s.listing_reason}</p>
                  )}

                  {s.status === "pending" && (
                    isReviewer ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          placeholder={t("reason")}
                          aria-label={`${t("g_reviewNoteLabel")} — ${s.symbol}`}
                          value={note}
                          maxLength={600}
                          onChange={(e) => setReason((r) => ({ ...r, [s.id]: e.target.value }))}
                          className="min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={mutation.isPending || approveBlocked}
                          onClick={() => mutation.mutate({ submissionId: s.id, status: "approved", reason: note || undefined, replaceRuling: conflict && replacing })}
                          className="rounded border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bull)] disabled:opacity-40"
                        >{t("approve")}</button>
                        <button
                          type="button"
                          disabled={mutation.isPending || note.trim().length < 10}
                          title={note.trim().length < 10 ? t("rejectionReasonRequired") : undefined}
                          onClick={() => mutation.mutate({ submissionId: s.id, status: "rejected", reason: note })}
                          className="rounded border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bear)] disabled:opacity-40"
                        >{t("reject")}</button>
                        {conflict && (
                          <div className="basis-full rounded-md border border-[var(--gold-deep)]/40 bg-[var(--gold-soft)] p-2 text-ink">
                            <p>{t("d_rulingConflict")}</p>
                            <label className="mt-1 inline-flex items-center gap-2 font-semibold">
                              <input type="checkbox" checked={replacing} onChange={(e) => setReplace((r) => ({ ...r, [s.id]: e.target.checked }))} />
                              {t("d_replaceRuling")}
                            </label>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">{t("d_awaitingReviewer")}</p>
                    )
                  )}

                  {s.status === "approved" && (
                    isAdmin ? (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setListing(s)} className="rounded-md gold-gradient px-3 py-1.5 text-[11px] font-semibold text-ink">{t("d_approveListing")}</button>
                        <button type="button" onClick={() => setDeclining(s)} className="rounded border border-[var(--bear)]/40 px-3 py-1.5 text-[11px] font-semibold text-[var(--bear)]">{t("d_declineListing")}</button>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">{t("d_awaitingAdmin")}</p>
                    )
                  )}

                  <SubmissionDocuments submissionId={s.id} />
                </div>
              </div>
            );
          })}
          <Pager page={page} pageCount={pageCount} onPage={(p) => patch({ page: p })} labels={{ page: t("page"), of: t("of"), prev: t("prev"), next: t("next") }} />
        </div>
      )}

      {listing && <ListingDialog submission={listing} onClose={() => setListing(null)} />}
      {declining && <DeclineDialog submission={declining} onClose={() => setDeclining(null)} />}
    </AppShell>
  );
}

function ListingDialog({ submission, onClose }: { submission: QueueSubmission; onClose: () => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const holdersFn = useServerFn(listListingHolders);
  const listFn = useServerFn(approveListing);
  const holders = useQuery({
    queryKey: ["listing-holders", submission.id],
    queryFn: () => holdersFn({ data: { submissionId: submission.id } }),
  });
  const [price, setPrice] = useState(submission.instrument && submission.instrument.referencePrice > 0 ? String(submission.instrument.referencePrice) : "");
  const [holderId, setHolderId] = useState("");
  const [qty, setQty] = useState("");
  const [issuePrice, setIssuePrice] = useState("");
  const [note, setNote] = useState("");

  const priceNum = Number(price);
  const priceOk = price.trim() !== "" && isValidReferencePrice(priceNum);
  const qtyNum = Number(qty);
  const qtyOk = !holderId || (qty.trim() !== "" && isValidOrderQty(qtyNum));
  const issueNum = Number(issuePrice);
  const issueOk = !holderId || issuePrice.trim() === "" || isValidReferencePrice(issueNum);
  const ready = priceOk && qtyOk && issueOk;

  const mut = useMutation({
    mutationFn: () =>
      listFn({
        data: {
          submissionId: submission.id,
          referencePrice: priceNum,
          ...(holderId ? { holderId, qty: qtyNum, ...(issuePrice.trim() ? { issuePrice: issueNum } : {}) } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    onSuccess: (res) => {
      toast.success(t("d_listedToast").replace("{symbol}", res.symbol));
      qc.invalidateQueries({ queryKey: ["admin-submissions"] });
      qc.invalidateQueries({ queryKey: ["admin-instruments"] });
      qc.invalidateQueries({ queryKey: ["market-overview"] });
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, LIFECYCLE_ERRORS)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("d_listingDialogTitle").replace("{symbol}", submission.symbol.toUpperCase())}</DialogTitle>
          <DialogDescription>{t("d_listingDialogDesc")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !mut.isPending) mut.mutate();
          }}
        >
          <p className="text-ink-soft">{lang === "ar" ? submission.name_ar : submission.name_en}</p>
          <label className="grid gap-1">
            <span className="font-semibold text-ink">{t("referencePrice")}</span>
            <input dir="ltr" inputMode="decimal" required value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={price !== "" && !priceOk} className="rounded-md border border-border bg-background px-2 py-1.5 font-mono focus:border-[var(--gold-deep)] focus:outline-none" />
            {price !== "" && !priceOk && <span className="text-[var(--bear)]">{t("fx3_errReferencePriceRange")}</span>}
          </label>

          <fieldset className="grid gap-2 rounded-md border border-border/60 p-3">
            <legend className="px-1 font-semibold text-ink">{t("d_firstAllocation")}</legend>
            <p className="text-[11px] text-muted-foreground">{t("d_firstAllocationDesc")}</p>
            <label className="grid gap-1">
              <span>{t("d_holder")}</span>
              <select value={holderId} onChange={(e) => setHolderId(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5">
                <option value="">{t("d_noHolder")}</option>
                {(holders.data ?? []).map((h) => (
                  <option key={h.userId} value={h.userId}>
                    {h.email || h.userId} · {HOLDER_ROLE[h.role] ? t(HOLDER_ROLE[h.role]) : h.role}{h.isTrader ? "" : ` · ${t("d_notTrader")}`}
                  </option>
                ))}
              </select>
            </label>
            {holderId && (
              <>
                <label className="grid gap-1">
                  <span>{t("d_units")}</span>
                  <input dir="ltr" inputMode="numeric" required value={qty} onChange={(e) => setQty(e.target.value)} aria-invalid={qty !== "" && !qtyOk} className="rounded-md border border-border bg-background px-2 py-1.5 font-mono" />
                  {qty !== "" && !qtyOk && <span className="text-[var(--bear)]">{t("errInvalidQty")}</span>}
                </label>
                <label className="grid gap-1">
                  <span>{t("d_issuePrice")}</span>
                  <input dir="ltr" inputMode="decimal" value={issuePrice} onChange={(e) => setIssuePrice(e.target.value)} aria-invalid={!issueOk} className="rounded-md border border-border bg-background px-2 py-1.5 font-mono" />
                  {!issueOk && <span className="text-[var(--bear)]">{t("fx3_errReferencePriceRange")}</span>}
                </label>
                <label className="grid gap-1">
                  <span>{t("d_noteOptional")}</span>
                  <input value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5" />
                </label>
              </>
            )}
          </fieldset>

          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded border border-border px-3 py-1.5 text-ink-soft">{t("cancel")}</button>
            <button type="submit" disabled={!ready || mut.isPending} className="rounded-md gold-gradient px-3 py-1.5 font-semibold text-ink disabled:opacity-50">
              {mut.isPending ? t("loading") : t("d_approveListing")}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({ submission, onClose }: { submission: QueueSubmission; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const declineFn = useServerFn(declineListing);
  const [why, setWhy] = useState("");
  const mut = useMutation({
    mutationFn: () => declineFn({ data: { submissionId: submission.id, reason: why.trim() } }),
    onSuccess: () => {
      toast.success(t("d_declinedToast"));
      qc.invalidateQueries({ queryKey: ["admin-submissions"] });
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, LIFECYCLE_ERRORS)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("d_declineListing")} · {submission.symbol.toUpperCase()}</DialogTitle>
          <DialogDescription>{t("d_declineReason")}</DialogDescription>
        </DialogHeader>
        <textarea aria-label={t("d_declineReason")} value={why} maxLength={600} onChange={(e) => setWhy(e.target.value)} rows={3} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-border px-3 py-1.5 text-xs text-ink-soft">{t("cancel")}</button>
          <button type="button" disabled={why.trim().length < 10 || mut.isPending} onClick={() => mut.mutate()} className="rounded border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--bear)] disabled:opacity-50">
            {t("d_declineListing")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
