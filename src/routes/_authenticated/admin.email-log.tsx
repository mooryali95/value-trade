import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { AccessDenied } from "@/components/access-denied";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useErrorMessage } from "@/hooks/use-error-message";
import { listEmailLog, listEmailTemplates, logTemplateData, retryEmail } from "@/lib/admin/email-log.functions";
import { renderEmailPreview } from "@/lib/admin/email-preview.functions";
import { ArrowClockwise, EnvelopeSimple, Eye, MagnifyingGlass, X } from "@phosphor-icons/react";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { Num } from "@/components/num";
import { formatDateTime } from "@/components/market-data";
import { useConfirm } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n, type Key } from "@/lib/i18n";
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

type EmailLogRow = Awaited<ReturnType<typeof listEmailLog>>["items"][number];

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
  if (isLoading) return <AppShell><LuxurySkeleton lines={6} /></AppShell>;
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
  const { t, lang } = useI18n();
  const errorMessage = useErrorMessage();
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
      toast.success(t("u_elResent"));
      qc.invalidateQueries({ queryKey: ["email-log"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const askRetry = async (row: EmailLogRow) => {
    if (!row.message_id) return;
    const ok = await confirm({
      title: t("u_elResendTitle"),
      description: `${templateLabel(row.template_name, t)} · ${row.recipient_email}`,
      confirmLabel: t("u_elResend"),
      cancelLabel: t("cancel"),
    });
    if (ok) retryM.mutate(row.message_id);
  };

  const openPreview = async (row: EmailLogRow) => {
    try {
      const res = await preview({
        data: {
          template: row.template_name,
          data: logTemplateData(row.metadata),
        },
      });
      setPreviewOpen({ html: res.html, subject: res.subject, template: row.template_name });
    } catch (e) {
      toast.error(errorMessage(e, {}, "u_elPreviewUnavailable"));
    }
  };

  const rawItems = logQ.data?.items ?? [];
  const sym = symbol.trim().toUpperCase();
  const items = sym
    ? rawItems.filter((r) => {
        const s = String(logTemplateData(r.metadata).symbol ?? "").toUpperCase();
        return s.includes(sym);
      })
    : rawItems;
  const total = sym ? items.length : logQ.data?.total ?? 0;

  const control =
    "min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground focus:border-[var(--gold-deep)] focus:outline-none sm:min-h-10";
  const smallBtn =
    "inline-flex min-h-9 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold text-ink-soft hover:border-[var(--gold-deep)] hover:text-ink disabled:opacity-40";

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("modePlatform")}
        title={t("nav_emailLog")}
        description={t("u_elDesc")}
        crumbs={[
          { label: t("modePlatform"), to: "/" },
          { label: t("nav_emailLog") },
        ]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
        <label className="min-w-0">
          <span className="sr-only">{t("u_status")}</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value as Status); setPage(0); }} className={control}>
            {(["all", "pending", "sent", "failed", "dlq", "suppressed", "bounced", "complained"] as Status[]).map((st) => (
              <option key={st} value={st}>{st === "all" ? t("u_elAllStatuses") : statusLabel(st, t)}</option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="sr-only">{t("u_elTemplate")}</span>
          <select value={template} onChange={(e) => { setTemplate(e.target.value); setPage(0); }} className={control}>
            <option value="">{t("u_elAllTemplates")}</option>
            {(tplQ.data ?? []).map((tpl) => (
              <option key={tpl} value={tpl}>{templateLabel(tpl, t)}</option>
            ))}
          </select>
        </label>
        <div className="relative min-w-0 sm:col-span-2 lg:col-span-1">
          <MagnifyingGlass aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={t("u_elSearchEmail")}
            aria-label={t("u_elSearchEmail")}
            className={`${control} ps-9`}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input
          value={symbol}
          onChange={(e) => { setSymbol(e.target.value); setPage(0); }}
          placeholder={t("u_elFilterSymbol")}
          aria-label={t("u_elFilterSymbol")}
          className={`${control} uppercase sm:max-w-xs`}
        />
        <button
          type="button"
          onClick={() => { setStatus("all"); setTemplate(""); setSearch(""); setSymbol(""); setPage(0); }}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-semibold text-ink-soft hover:border-[var(--gold-deep)] hover:text-ink sm:min-h-10"
        >
          <X aria-hidden className="me-1.5 h-4 w-4" />
          {t("u_elResetFilters")}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-card">
        <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_auto_minmax(0,1fr)_auto] gap-3 border-b border-border/70 bg-secondary/40 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
          <div>{t("u_elTemplate")}</div>
          <div>{t("u_elRecipient")}</div>
          <div>{t("u_status")}</div>
          <div>{t("u_elTime")}</div>
          <div />
        </div>
        {logQ.isLoading && <div className="px-4 py-8"><LuxurySkeleton lines={5} /></div>}
        {logQ.isError && (
          <div className="p-4"><ErrorState reset={() => logQ.refetch()} description={errorMessage(logQ.error)} /></div>
        )}
        {!logQ.isLoading && !logQ.isError && items.length === 0 && (
          <div className="p-4">
            <EmptyState icon={<EnvelopeSimple size={22} weight="duotone" />} title={t("u_elEmptyTitle")} description={t("u_elEmptyDesc")} />
          </div>
        )}
        {items.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-border/50 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_auto_minmax(0,1fr)_auto]"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{templateLabel(r.template_name, t)}</div>
              <code className="block truncate text-[11px] text-muted-foreground" dir="ltr" style={{ textAlign: "start" }}>{r.template_name}</code>
              {r.error_message ? (
                <div className="mt-0.5 truncate text-[11px] text-[var(--burgundy)]" dir="ltr" style={{ textAlign: "start" }} title={r.error_message}>
                  {r.error_message}
                </div>
              ) : null}
            </div>
            <span className={`justify-self-end whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium md:order-3 md:justify-self-start ${statusBadge(r.status)}`}>
              {statusLabel(r.status, t)}
            </span>
            <div className="min-w-0 truncate text-sm text-ink-soft md:order-2" dir="ltr" style={{ textAlign: "start" }}>{r.recipient_email}</div>
            <div className="text-end text-xs text-muted-foreground md:order-4 md:text-start">
              {formatDateTime(r.created_at, lang)}
            </div>
            <div className="col-span-2 flex justify-end gap-1.5 md:order-5 md:col-span-1">
              <button type="button" onClick={() => openPreview(r)} className={smallBtn}>
                <Eye aria-hidden className="h-3.5 w-3.5" /> {t("u_elPreview")}
              </button>
              <button
                type="button"
                onClick={() => askRetry(r)}
                disabled={!r.message_id || retryM.isPending || r.status === "sent" || r.status === "pending"}
                className={smallBtn}
              >
                <ArrowClockwise aria-hidden className="h-3.5 w-3.5" /> {t("u_elResend")}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <div>{t("u_elTotal")}: <Num value={total} kind="qty" /></div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="inline-flex min-h-11 items-center rounded-md border border-border bg-card px-4 text-sm disabled:opacity-40 sm:min-h-9"
          >
            {t("u_prev")}
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * limit >= total}
            className="inline-flex min-h-11 items-center rounded-md border border-border bg-card px-4 text-sm disabled:opacity-40 sm:min-h-9"
          >
            {t("u_next")}
          </button>
        </div>
      </div>

      <Dialog open={!!previewOpen} onOpenChange={(o) => !o && setPreviewOpen(null)}>
        {previewOpen && (
          <DialogContent className="flex h-[85dvh] w-full max-w-4xl flex-col overflow-hidden p-0">
            <DialogHeader className="border-b border-border/60 px-4 py-3 text-start">
              <DialogDescription className="text-xs">{templateLabel(previewOpen.template, t)}</DialogDescription>
              <DialogTitle className="truncate text-sm">{previewOpen.subject}</DialogTitle>
            </DialogHeader>
            {/* Sandboxed: the preview is an opaque origin with no script, whatever a template renders. */}
            <iframe title={t("u_elPreviewTitle")} srcDoc={previewOpen.html} sandbox="allow-popups" referrerPolicy="no-referrer" className="w-full flex-1 bg-ivory" />
          </DialogContent>
        )}
      </Dialog>
    </AppShell>
  );
}

const STATUS_KEYS: Record<string, Key> = {
  pending: "u_elStPending",
  sent: "u_elStSent",
  failed: "u_elStFailed",
  dlq: "u_elStDlq",
  suppressed: "u_elStSuppressed",
  bounced: "u_elStBounced",
  complained: "u_elStComplained",
};
function statusLabel(s: string, t: (k: Key) => string): string {
  return STATUS_KEYS[s] ? t(STATUS_KEYS[s]) : s;
}

const TEMPLATE_KEYS: Record<string, Key> = {
  invitation: "u_elTplInvitation",
  "price-alert": "u_elTplPriceAlert",
  "shariah-decision": "u_elTplShariahDecision",
  "position-update": "u_elTplPositionUpdate",
  "ops-alert": "u_elTplOpsAlert",
  "access-request-received": "u_elTplAccessReceived",
  "access-request-decision": "u_elTplAccessDecision",
  signup: "u_elTplSignup",
  recovery: "u_elTplRecovery",
  invite: "u_elTplInvite",
  magiclink: "u_elTplMagicLink",
  email_change: "u_elTplEmailChange",
  "email-change": "u_elTplEmailChange",
  reauthentication: "u_elTplReauth",
};
function templateLabel(name: string, t: (k: Key) => string): string {
  return TEMPLATE_KEYS[name] ? t(TEMPLATE_KEYS[name]) : name;
}
