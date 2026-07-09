import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { listPendingSubmissions, reviewSubmission } from "@/lib/submissions/submissions.functions";
import { StatusBadge } from "@/components/status-badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/submissions")({
  head: () => ({
    meta: [
      { title: "لوحة اعتماد الطروحات — قيمة" },
      { name: "description", content: "مراجعة طروحات الشركات واعتمادها أو رفضها." },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: AdminSubmissions,
});

type Row = { id: string; symbol: string; name_ar: string; name_en: string; asset_class: string; sector: string | null; status: string; submitted_at: string; companies: { name_ar: string; name_en: string; slug: string } | null };

function AdminSubmissions() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listPendingSubmissions);
  const reviewFn = useServerFn(reviewSubmission);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["admin-submissions"], queryFn: () => listFn() as Promise<Row[]> });
  const [reason, setReason] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (v: { submissionId: string; status: "approved" | "rejected"; reason?: string }) => reviewFn({ data: v }),
    onSuccess: () => { toast.success(t("submissionReviewed")); qc.invalidateQueries({ queryKey: ["admin-submissions"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  if (isLoading) return <AppShell><LuxurySkeleton lines={6} /></AppShell>;
  if (isError) return <AppShell><div className="py-16"><ErrorState reset={() => refetch()} /></div></AppShell>;
  const rows = data ?? [];

  return (
    <AppShell>
      <header className="mb-6">
        <div className="h-px hairline-gold mb-3" />
        <h1 className="text-2xl font-bold text-ink md:text-3xl">{t("submissionsAdmin")}</h1>
      </header>
      {rows.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          {rows.map((s) => (
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
                    <button onClick={() => mutation.mutate({ submissionId: s.id, status: "approved", reason: reason[s.id] })} className="rounded border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bull)]">{t("approve")}</button>
                    <button onClick={() => mutation.mutate({ submissionId: s.id, status: "rejected", reason: reason[s.id] })} className="rounded border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bear)]">{t("reject")}</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}