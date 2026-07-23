import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AccessDenied } from "@/components/access-denied";
import { useMyRoles } from "@/hooks/use-my-roles";
import { listEmailLog, listEmailTemplates, retryEmail } from "@/lib/admin/email-log.functions";
import { EnvelopeSimple, ArrowClockwise, MagnifyingGlass } from "@phosphor-icons/react";

export const Route = createFileRoute("/_authenticated/admin/email-log")({
  head: () => ({
    meta: [
      { title: "سجل الإرسال · Email log — Value Unit" },
      { name: "description", content: "سجل رسائل البريد الصادرة من المنصّة مع إعادة المحاولة." },
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
  const list = useServerFn(listEmailLog);
  const templates = useServerFn(listEmailTemplates);
  const retry = useServerFn(retryEmail);

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-log"] }),
  });

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
      <header className="mb-6 grid gap-2">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--gold-deep)]/30 bg-[var(--gold-soft)]/40 px-3 py-1 text-xs font-medium text-[var(--gold-deep)]">
          <EnvelopeSimple className="h-3.5 w-3.5" /> Admin
        </div>
        <h1 className="text-3xl font-bold text-foreground md:text-4xl">سجل الإرسال · Email send log</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          كل رسالة بريد صادرة، حالتها، والقدرة على إعادة إرسال الفاشل.
        </p>
      </header>

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
          <option value="">كل القوالب</option>
          {(tplQ.data ?? []).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <div className="relative">
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="بحث بالبريد…"
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground"
          />
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <input
          value={symbol}
          onChange={(e) => { setSymbol(e.target.value); setPage(0); }}
          placeholder="فلترة بالرمز (مثل ARAMCO)…"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono uppercase text-foreground"
        />
        <button
          type="button"
          onClick={() => { setStatus("all"); setTemplate(""); setSearch(""); setSymbol(""); setPage(0); }}
          className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-ink-soft hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)]"
        >
          إعادة تعيين الفلاتر
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
        <div className="grid grid-cols-[1.4fr_1.6fr_auto_auto_auto] gap-3 border-b border-border/60 bg-secondary/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <div>القالب</div>
          <div>البريد</div>
          <div>الحالة</div>
          <div>الوقت</div>
          <div></div>
        </div>
        {logQ.isLoading && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">…</div>
        )}
        {!logQ.isLoading && items.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">لا نتائج.</div>
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
            <button
              onClick={() => r.message_id && retryM.mutate(r.message_id)}
              disabled={!r.message_id || retryM.isPending || r.status === "sent" || r.status === "pending"}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-ink-soft hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)] disabled:opacity-40"
            >
              <ArrowClockwise className="h-3.5 w-3.5" /> إعادة
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <div>الإجمالي: {total}</div>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
          >
            السابق
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * limit >= total}
            className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
          >
            التالي
          </button>
        </div>
      </div>
    </AppShell>
  );
}