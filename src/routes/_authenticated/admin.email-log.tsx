import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { AccessDenied } from "@/components/access-denied";
import { useMyRoles } from "@/hooks/use-my-roles";
import { listEmailLog, listEmailTemplates, retryEmail } from "@/lib/admin/email-log.functions";
import { renderEmailPreview } from "@/lib/admin/email-preview.functions";
import { ArrowClockwise, Eye, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useConfirm } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/email-log")({
  head: () => ({
    meta: [
      { title: "سجل الإرسال · Email Log — Value Unit" },
      { name: "description", content: "سجل رسائل البريد الصادرة من المنصّة مع إعادة المحاولة. · Outbound email delivery log with retry." },
      { property: "og:title", content: "Email Log — Value Unit" },
      { property: "og:description", content: "Outbound email delivery log with retry controls." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminEmailLogPage,
});

type Status = "all" | "pending" | "sent" | "failed" | "dlq" | "suppressed" | "bounced" | "complained";

const FILTER_KEY = "email-log:filters:v1";

type Filters = { status: Status; template: string; search: string; symbol: string };

const DEFAULT_FILTERS: Filters = { status: "all", template: "", search: "", symbol: "" };

function loadFilters(): Filters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(FILTER_KEY);
    if (!raw) return DEFAULT_FILTERS;
    return { ...DEFAULT_FILTERS, ...(JSON.parse(raw) as Partial<Filters>) };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function AdminEmailLogPage() {
  const { isAdmin, isLoading } = useMyRoles();
  if (isLoading) return <AppShell><div className="p-10 text-center text-muted-foreground">…</div></AppShell>;
  if (!isAdmin) return <AppShell><AccessDenied /></AppShell>;
  return <EmailLogContent />;
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    sent: "bg-[var(--bull)]/15 text-[var(--bull)]",
    pending: "bg-[var(--gold-soft)] text-[var(--gold-deep)]",
    failed: "bg-[var(--burgundy)]/15 text-[var(--burgundy)]",
    dlq: "bg-[var(--burgundy)]/20 text-[var(--burgundy)]",
    suppressed: "bg-secondary text-muted-foreground",
    bounced: "bg-[var(--burgundy)]/15 text-[var(--burgundy)]",
    complained: "bg-[var(--burgundy)]/15 text-[var(--burgundy)]",
  };
  return map[s] ?? "bg-secondary text-muted-foreground";
}

function EmailLogContent() {
  const qc = useQueryClient();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const list = useServerFn(listEmailLog);
  const templates = useServerFn(listEmailTemplates);
  const retry = useServerFn(retryEmail);
  const preview = useServerFn(renderEmailPreview);
  const confirm = useConfirm();
  const [previewOpen, setPreviewOpen] = useState<null | { html: string; subject: string; template: string }>(null);

  const initial = loadFilters();
  const [status, setStatus] = useState<Status>(initial.status);
  const [template, setTemplate] = useState<string>(initial.template);
  const [search, setSearch] = useState<string>(initial.search);
  const [symbol, setSymbol] = useState<string>(initial.symbol);
  const [page, setPage] = useState(0);
  const limit = 50;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        FILTER_KEY,
        JSON.stringify({ status, template, search, symbol } satisfies Filters),
      );
    } catch {
      // ignore
    }
  }, [status, template, search, symbol]);

  const tplQ = useQuery({ queryKey: ["email-log-templates"], queryFn: () => templates() });
  const logQ = useQuery({
    queryKey: ["email-log", status, template, search, symbol, page],
    queryFn: () =>
      list({
        data: {
          status,
          template: template || undefined,
          search: search || undefined,
          limit,
          offset: page * limit,
        },
      }),
  });

  const retryM = useMutation({
    mutationFn: (messageId: string) => retry({ data: { messageId } }),
    onSuccess: () => {
      toast.success(ar ? "تم إعادة إرسال الرسالة" : "Message re-sent");
      qc.invalidateQueries({ queryKey: ["email-log"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  const askRetry = async (row: any) => {
    if (!row.message_id) return;
    const ok = await confirm({
      title: ar ? "إعادة إرسال الرسالة؟" : "Re-send this message?",
      description: `${row.template_name} → ${row.recipient_email}`,
      confirmLabel: ar ? "إعادة الإرسال" : "Re-send",
      cancelLabel: ar ? "إلغاء" : "Cancel",
    });
    if (ok) retryM.mutate(row.message_id);
  };

  const openPreview = async (row: any) => {
    try {
      const res = await preview({
        data: {
          template: row.template_name,
          data: (row.metadata?.template_data ?? {}) as Record<string, unknown>,
        },
      });
      setPreviewOpen({ html: res.html, subject: res.subject, template: row.template_name });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : ar ? "معاينة غير متاحة لهذا القالب" : "Preview unavailable for this template");
    }
  };

  const rawItems = logQ.data?.items ?? [];
  const sym = symbol.trim().toUpperCase();
  const items = sym
    ? rawItems.filter((r: any) => {
        const s = (r?.metadata?.template_data?.symbol ?? "").toString().toUpperCase();
        return s.includes(sym);
      })
    : rawItems;
  const total = sym ? items.length : logQ.data?.total ?? 0;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title={ar ? "سجل الإرسال" : "Email send log"}
        description={
          ar
            ? "كل رسالة بريد صادرة، حالتها، والقدرة على إعادة إرسال الفاشل."
            : "Every outbound message, its delivery status, and retry controls."
        }
        crumbs={[
          { label: "Admin", to: "/admin/submissions" },
          { label: ar ? "سجل الإرسال" : "Email log" },
        ]}
      />

      <div className="mb-4 grid gap-3 md:grid-cols-[auto_auto_1fr]">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as Status); setPage(0); }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          {(["all", "pending", "sent", "failed", "dlq", "suppressed", "bounced", "complained"] as Status[]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={template}
          onChange={(e) => { setTemplate(e.target.value); setPage(0); }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">{ar ? "كل القوالب" : "All templates"}</option>
          {(tplQ.data ?? []).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <div className="relative">
          <MagnifyingGlass className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={ar ? "بحث بالبريد…" : "Search by email…"}
            className="w-full rounded-md border border-border bg-background py-2 pe-3 ps-9 text-sm text-foreground"
          />
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <input
          value={symbol}
          onChange={(e) => { setSymbol(e.target.value); setPage(0); }}
          placeholder={ar ? "فلترة بالرمز (مثل ARAMCO)…" : "Filter by symbol (e.g. ARAMCO)…"}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono uppercase text-foreground"
        />
        <button
          type="button"
          onClick={() => { setStatus("all"); setTemplate(""); setSearch(""); setSymbol(""); setPage(0); }}
          className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-ink-soft hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)]"
        >
          {ar ? "إعادة تعيين الفلاتر" : "Reset filters"}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
        <div className="grid grid-cols-[1.4fr_1.6fr_auto_auto_auto] gap-3 border-b border-border/60 bg-secondary/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <div>{ar ? "القالب" : "Template"}</div>
          <div>{ar ? "البريد" : "Recipient"}</div>
          <div>{ar ? "الحالة" : "Status"}</div>
          <div>{ar ? "الوقت" : "Time"}</div>
          <div></div>
        </div>
        {logQ.isLoading && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">…</div>
        )}
        {!logQ.isLoading && items.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">{ar ? "لا نتائج." : "No results."}</div>
        )}
        {items.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[1.4fr_1.6fr_auto_auto_auto] items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{r.template_name}</div>
              {r.error_message ? (
                <div className="mt-0.5 truncate text-[11px] text-[var(--burgundy)]">{r.error_message}</div>
              ) : null}
            </div>
            <div className="truncate text-sm text-ink-soft">{r.recipient_email}</div>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadge(r.status)}`}>
              {r.status}
            </span>
            <div className="font-mono text-[11px] text-muted-foreground">
              {new Date(r.created_at).toLocaleString()}
            </div>
            <div className="flex justify-end gap-1">
                <button
                  onClick={() => openPreview(r)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-ink-soft hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)]"
                >
                  <Eye className="h-3.5 w-3.5" /> {ar ? "معاينة" : "Preview"}
                </button>
                <button
                  onClick={() => askRetry(r)}
                  disabled={!r.message_id || retryM.isPending || r.status === "sent" || r.status === "pending"}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-ink-soft hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)] disabled:opacity-40"
                >
                  <ArrowClockwise className="h-3.5 w-3.5" /> {ar ? "إعادة" : "Retry"}
                </button>
              </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <div>{ar ? "الإجمالي" : "Total"}: {total}</div>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
          >
            {ar ? "السابق" : "Previous"}
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * limit >= total}
            className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
          >
            {ar ? "التالي" : "Next"}
          </button>
        </div>
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setPreviewOpen(null)}>
          <div onClick={(e) => e.stopPropagation()} className="flex h-[85dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-luxury">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{previewOpen.template}</div>
                <div className="truncate text-sm font-semibold text-ink">{previewOpen.subject}</div>
              </div>
              <button onClick={() => setPreviewOpen(null)} className="rounded-md border border-border p-1.5 text-ink-soft hover:border-[var(--gold-deep)]"><X className="h-4 w-4" /></button>
            </div>
            <iframe title="email preview" srcDoc={previewOpen.html} className="flex-1 w-full bg-ivory" />
          </div>
        </div>
      )}
    </AppShell>
  );
}