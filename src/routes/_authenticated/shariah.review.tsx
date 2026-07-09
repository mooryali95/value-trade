import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import { BRANDS } from "@/lib/mock-data";
import { recordShariahDecision, listShariahDecisions, updateShariahDecision, listDecisionAudit } from "@/lib/trading/shariah.functions";
import { StatusBadge } from "@/components/status-badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/shariah/review")({
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
  const listFn = useServerFn(listShariahDecisions);
  const recordFn = useServerFn(recordShariahDecision);
  const updateFn = useServerFn(updateShariahDecision);
  const auditFn = useServerFn(listDecisionAudit);
  const { data: decisions, isLoading } = useQuery({ queryKey: ["shariah-decisions"], queryFn: () => listFn() });
  const [reason, setReason] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState({ status: "all" as "all" | "halal" | "non_halal" | "reviewing", search: "" });
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
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });
  const editMut = useMutation({
    mutationFn: (v: { id: string; status: "halal" | "non_halal" | "reviewing"; reason?: string; changeReason: string }) => updateFn({ data: v }),
    onSuccess: () => {
      toast.success(t("submitDecision"));
      qc.invalidateQueries({ queryKey: ["shariah-decisions"] });
      qc.invalidateQueries({ queryKey: ["shariah-audit"] });
      setEditing(null);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  const pool = BRANDS.filter((b) => b.assetClass !== "sukuk" || b.shariah === "reviewing").slice(0, 20);

  const filtered = useMemo(() => {
    const q = filter.search.trim().toUpperCase();
    return (decisions ?? []).filter((d) => {
      if (filter.status !== "all" && d.status !== filter.status) return false;
      if (q && !d.symbol.toUpperCase().includes(q)) return false;
      return true;
    });
  }, [decisions, filter]);

  return (
    <AppShell>
      <header className="mb-6">
        <div className="mb-3 h-px hairline-gold" />
        <h1 className="text-2xl font-bold text-ink md:text-3xl">{t("shariahReview")}</h1>
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
                <button onClick={() => mutation.mutate({ symbol: b.symbol, status: "halal", reason: reason[b.symbol] })} className="rounded border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bull)]">{t("approve")}</button>
                <button onClick={() => mutation.mutate({ symbol: b.symbol, status: "reviewing", reason: reason[b.symbol] })} className="rounded border border-border px-3 py-1.5 text-[11px] font-semibold text-ink-soft">{t("requestInfo")}</button>
                <button onClick={() => mutation.mutate({ symbol: b.symbol, status: "non_halal", reason: reason[b.symbol] })} className="rounded border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--bear)]">{t("reject")}</button>
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
              value={filter.search}
              onChange={(e) => setFilter({ ...filter, search: e.target.value })}
              placeholder={t("search")}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
            />
            <select
              value={filter.status}
              onChange={(e) => setFilter({ ...filter, status: e.target.value as never })}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="all">{t("filterAll")}</option>
              <option value="halal">{t("halal")}</option>
              <option value="reviewing">{t("reviewing")}</option>
              <option value="non_halal">{t("reject")}</option>
            </select>
          </div>
        </div>
        {isLoading ? (
          <LuxurySkeleton lines={4} />
        ) : filtered.length === 0 ? (
          <EmptyState title={t("emptyTitle")} description={t("emptyDesc")} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            {filtered.map((d) => (
              <div key={d.id} className="border-b border-border/40 px-4 py-3 last:border-b-0">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-3 text-xs">
                  <span className="font-mono font-semibold text-ink">{d.symbol}</span>
                  <span className="truncate text-muted-foreground">{d.reason ?? "—"}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {t("lastUpdated")}: {new Date(d.updated_at ?? d.created_at).toLocaleString(lang === "ar" ? "ar" : "en-US", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                  </span>
                  <StatusBadge status={d.status} />
                  <div className="flex gap-1">
                    <button
                      onClick={() => setOpenAudit((cur) => cur === d.id ? null : d.id)}
                      className="rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]"
                    >{t("auditTrail")}</button>
                    <button
                      onClick={() => setEditing({ id: d.id, status: d.status as never, reason: d.reason ?? "", changeReason: "", symbol: d.symbol })}
                      className="rounded border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-[var(--gold-deep)]"
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