import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { AccessDenied } from "@/components/access-denied";
import { useI18n } from "@/lib/i18n";
import { useErrorMessage } from "@/hooks/use-error-message";
import { formatDateTime } from "@/components/market-data";
import { useMyRoles } from "@/hooks/use-my-roles";
import {
  getOpsRuns,
  getOpsThresholds,
  listOpsRuns,
  runSmokeSuite,
  updateOpsThresholds,
} from "@/lib/ops/ops.functions";

export const Route = createFileRoute("/_authenticated/admin/ops")({
  head: () => ({
    meta: [
      { title: "فحوص ما بعد النشر — وحدة القيمة | Post-deploy checks — Value Unit" },
      {
        name: "description",
        content: "تشغيل الفحص السريع للمسارات الحرجة والتحقق من جدولة فحص التنبيهات السعرية. · Run the quick checks of the critical paths and verify the price-alert schedule.",
      },
      { property: "og:title", content: "فحوص ما بعد النشر — وحدة القيمة | Post-deploy checks — Value Unit" },
      { property: "og:description", content: "اختبار المسارات الحرجة وحالة الجدولة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ reset }) => (
    <AppShell>
      <div className="py-16">
        <ErrorState reset={reset} />
      </div>
    </AppShell>
  ),
  component: OpsPage,
});

const tone = (status: string) =>
  status === "ok"
    ? "text-[var(--bull)] border-[var(--bull)]/40 bg-[var(--bull)]/10"
    : status === "warn"
      ? "text-[var(--gold-deep)] border-[var(--gold-deep)]/40 bg-[var(--gold-deep)]/10"
      : "text-[var(--bear)] border-[var(--bear)]/40 bg-[var(--bear)]/10";

function OpsPage() {
  const { t, lang } = useI18n();
  const { isAdmin, isLoading: rolesLoading } = useMyRoles();
  const [sendEmail, setSendEmail] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [job, setJob] = useState("");
  const [status, setStatus] = useState<"all" | "ok" | "warn" | "fail">("all");
  const [form, setForm] = useState<Record<string, number> | null>(null);
  const runsFn = useServerFn(getOpsRuns);
  const thresholdsFn = useServerFn(getOpsThresholds);
  const saveThresholdsFn = useServerFn(updateOpsThresholds);
  const smokeFn = useServerFn(runSmokeSuite);
  const listFn = useServerFn(listOpsRuns);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["ops-runs"],
    queryFn: () => runsFn(),
    enabled: isAdmin,
    refetchInterval: 60_000,
  });

  const smoke = useMutation({
    mutationFn: () =>
      smokeFn({ data: { origin: window.location.origin, sendEmail } }),
    onSettled: () => {
      void refetch();
      void log.refetch();
    },
  });

  const log = useQuery({
    queryKey: ["ops-log", from, to, job, status],
    queryFn: () =>
      listFn({
        data: {
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(job ? { job } : {}),
          status,
          limit: 500,
        },
      }),
    enabled: isAdmin,
  });

  const thresholds = useQuery({
    queryKey: ["ops-thresholds"],
    queryFn: () => thresholdsFn(),
    enabled: isAdmin,
  });

  const current =
    form ??
    (thresholds.data
      ? {
          smokeFailThreshold: thresholds.data.smokeFailThreshold,
          cronLatencyBudgetMs: thresholds.data.cronLatencyBudgetMs,
          alertMaxPerWindow: thresholds.data.alertMaxPerWindow,
          alertWindowMinutes: thresholds.data.alertWindowMinutes,
          emailRetryAttempts: thresholds.data.emailRetryAttempts,
        }
      : null);

  const saveThresholds = useMutation({
    mutationFn: (values: Record<string, number>) =>
      saveThresholdsFn({ data: values as never }),
    onSuccess: () => {
      setForm(null);
      void thresholds.refetch();
    },
  });

  const download = (name: string, mime: string, body: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: `${mime};charset=utf-8` }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    if (!log.data) return;
    download(`ops-run-log-${Date.now()}.json`, "application/json", JSON.stringify(log.data.items, null, 2));
  };

  const exportCsv = () => {
    if (!log.data) return;
    const head = ["id", "job", "status", "detail", "duration_ms", "created_at", "metrics"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      head.join(","),
      ...log.data.items.map((r) =>
        [r.id, r.job, r.status, r.detail, r.duration_ms, r.created_at, JSON.stringify(r.metrics ?? {})]
          .map(esc)
          .join(","),
      ),
    ].join("\r\n");
    download(`ops-run-log-${Date.now()}.csv`, "text/csv", `\uFEFF${csv}`);
  };

  const errorMessage = useErrorMessage();
  const fmt = (iso: string | null | undefined) => (iso ? formatDateTime(iso, lang) : t("never"));
  const stLabel = (s: string | null | undefined) =>
    s === "ok" ? t("healthOk") : s === "warn" ? t("healthWarn") : s === "fail" ? t("healthFail") : (s ?? "");
  const ms = (n: number) => `${new Intl.NumberFormat("en-US").format(n)} ${t("u_ms")}`;

  if (!rolesLoading && !isAdmin) {
    return (
      <AppShell>
        <div className="py-16">
          <AccessDenied />
        </div>
      </AppShell>
    );
  }

  const report = smoke.data;

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("modePlatform")}
        title={t("opsSmoke")}
        description={t("opsSmokeDesc")}
        crumbs={[{ label: t("modePlatform"), to: "/" }, { label: t("opsSmoke") }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => smoke.mutate()}
              disabled={smoke.isPending}
              className="min-h-11 rounded-md gold-gradient px-4 text-sm font-semibold text-ink disabled:opacity-50"
            >
              {smoke.isPending ? t("running") : t("runSmoke")}
            </button>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="min-h-11 rounded-md border border-border bg-card px-4 text-sm font-semibold text-ink hover:border-[var(--gold-deep)] disabled:opacity-50"
            >
              {isFetching ? t("loading") : t("refresh")}
            </button>
          </div>
        }
      />

      <label className="mb-4 flex min-h-11 items-center gap-2 text-sm text-ink-soft">
        <input
          type="checkbox"
          checked={sendEmail}
          onChange={(e) => setSendEmail(e.target.checked)}
          className="size-4 accent-[var(--gold-deep)]"
        />
        {t("sendRealEmail")}
      </label>

      {isLoading || !data ? (
        <LuxurySkeleton lines={6} />
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <Card
            label={t("lastCronRun")}
            value={fmt(data.lastCron?.created_at ?? null)}
            badge={data.lastCron?.status}
            badgeLabel={stLabel(data.lastCron?.status)}
            detail={data.lastCron?.detail ?? "—"}
          />
          <Card
            label={t("lastSmokeRun")}
            value={fmt(data.lastSmoke?.created_at ?? null)}
            badge={data.lastSmoke?.status}
            badgeLabel={stLabel(data.lastSmoke?.status)}
            detail={data.lastSmoke?.detail ?? "—"}
          />
          <Card label={t("activeAlerts")} value={String(data.activeAlerts)} detail={fmt(data.checkedAt)} />
        </div>
      )}

      <div className="mt-6" role="status" aria-live="polite" aria-atomic="true">
        {smoke.isError && (
          <p className="text-sm text-[var(--bear)]">
            {errorMessage(smoke.error)}
          </p>
        )}
        {report && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${tone(report.status)}`}>
                {stLabel(report.status)}
              </span>
              <span className="text-ink-soft">
                {t("smokePassed")}: {report.passed} · {t("smokeWarned")}: {report.warned} ·{" "}
                {t("smokeFailed")}: {report.failed} · <span dir="ltr">{ms(report.durationMs)}</span>
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-card">
              {report.checks.map((c) => (
                <div
                  key={c.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-border/50 px-4 py-3 text-xs last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto]"
                >
                  <code className="truncate text-ink" dir="ltr" style={{ textAlign: "start" }}>{c.key}</code>
                  <span className={`justify-self-end whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-semibold sm:order-4 ${tone(c.status)}`}>
                    {stLabel(c.status)}
                  </span>
                  <span className="truncate text-ink-soft sm:order-2" dir="auto">{c.detail}</span>
                  <span className="whitespace-nowrap text-end text-ink-soft sm:order-3" dir="ltr">{ms(c.durationMs)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {data && data.runs.length > 0 && (
        <>
          <section className="mt-8">
            <h2 className="mb-2 text-[15px] font-bold text-ink">{t("opsKpis")}</h2>
            {log.data ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <Card
                    label={t("avgLatency")}
                    value={ms(log.data.kpis.avgMs)}
                    detail={`p95 ${ms(log.data.kpis.p95Ms)} · ${t("u_opsMax")} ${ms(log.data.kpis.maxMs)}`}
                  />
                  <Card
                    label={t("successRate")}
                    value={`${log.data.kpis.successRate}%`}
                    detail={`${t("healthOk")}: ${log.data.kpis.ok} · ${t("healthWarn")}: ${log.data.kpis.warn} · ${t("healthFail")}: ${log.data.kpis.fail}`}
                  />
                  <Card label={t("alertsAffected")} value={String(log.data.kpis.alertsAffected)} />
                  <Card label={t("runsCount")} value={String(log.data.kpis.total)} />
                </div>

                <div className="mt-4 rounded-xl border border-border/60 bg-card p-4">
                  <div className="mb-3 text-label text-ink-soft">{t("last7Days")}</div>
                  <div className="flex items-end gap-2" role="img" aria-label={t("last7Days")}>
                    {log.data.days.map((d) => {
                      const max = Math.max(1, ...log.data!.days.map((x) => x.total));
                      const h = Math.round((d.total / max) * 90) + 4;
                      return (
                        <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                          <span className="text-[10px] text-ink-soft">{d.total}</span>
                          <div
                            style={{ height: `${h}px` }}
                            className={`w-full rounded-t ${
                              d.fail > 0 ? "bg-[var(--bear)]/70" : "bg-[var(--gold-deep)]/70"
                            }`}
                            title={`${d.day}: ${t("runsCount")} ${d.total} · ${t("healthFail")} ${d.fail} · ${t("avgLatency")} ${ms(d.avgMs)}`}
                          />
                          <span className="text-[10px] text-muted-foreground">{d.day.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <LuxurySkeleton lines={4} />
            )}
          </section>

          <section className="mt-8">
            <div className="mb-2 flex flex-wrap items-end gap-2">
              <label className="text-caption text-ink-soft">
                {t("fromDate")}
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="ms-2 min-h-9 rounded border border-border bg-background px-2 text-sm text-ink"
                />
              </label>
              <label className="text-caption text-ink-soft">
                {t("toDate")}
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="ms-2 min-h-9 rounded border border-border bg-background px-2 text-sm text-ink"
                />
              </label>
              <label className="text-caption text-ink-soft">
                {t("job")}
                <select
                  value={job}
                  onChange={(e) => setJob(e.target.value)}
                  className="ms-2 min-h-9 rounded border border-border bg-background px-2 text-sm text-ink"
                >
                  <option value="">{t("all")}</option>
                  {(log.data?.jobs ?? []).map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-caption text-ink-soft">
                {t("result")}
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  className="ms-2 min-h-9 rounded border border-border bg-background px-2 text-sm text-ink"
                >
                  <option value="all">{t("all")}</option>
                  <option value="ok">{t("healthOk")}</option>
                  <option value="warn">{t("healthWarn")}</option>
                  <option value="fail">{t("healthFail")}</option>
                </select>
              </label>
              <div className="ms-auto flex gap-2">
                <button
                  onClick={exportCsv}
                  disabled={!log.data?.items.length}
                  className="min-h-9 rounded-md border border-border px-3 text-sm text-ink hover:border-[var(--gold-deep)] disabled:opacity-40"
                >
                  {t("exportCsv")}
                </button>
                <button
                  onClick={exportJson}
                  disabled={!log.data?.items.length}
                  className="min-h-9 rounded-md border border-border px-3 text-sm text-ink hover:border-[var(--gold-deep)] disabled:opacity-40"
                >
                  {t("exportJson")}
                </button>
              </div>
            </div>
          </section>
        </>
      )}

      {data && data.runs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-[15px] font-bold text-ink">{t("recentRuns")}</h2>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-card">
            <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] gap-3 border-b border-border/70 bg-secondary/40 px-4 py-2.5 text-xs font-medium text-muted-foreground sm:grid">
              <span>{t("job")}</span>
              <span>{t("result")}</span>
              <span>{t("when")}</span>
              <span className="text-end">{t("u_status")}</span>
            </div>
            {(log.data?.items ?? data.runs).map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-border/50 px-4 py-3 text-xs last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto]"
              >
                <code className="truncate text-ink" dir="ltr" style={{ textAlign: "start" }}>{r.job}</code>
                <span className="truncate text-ink-soft sm:order-2" dir="auto">{r.detail ?? "—"}</span>
                <span className="whitespace-nowrap text-ink-soft sm:order-3">{fmt(r.created_at)}</span>
                <Link
                  to="/admin/ops/$id"
                  params={{ id: r.id }}
                  aria-label={`${t("viewDetails")} ${r.job}`}
                  className={`inline-flex min-h-8 items-center justify-self-end whitespace-nowrap rounded border px-2 text-[11px] font-semibold hover:opacity-80 sm:order-4 ${tone(r.status)}`}
                >
                  {stLabel(r.status)}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="mt-8">
        <h2 className="mb-1 text-[15px] font-bold text-ink">{t("opsThresholds")}</h2>
        <p className="mb-3 text-caption text-ink-soft">{t("opsThresholdsDesc")}</p>
        {!current ? (
          <LuxurySkeleton lines={3} />
        ) : (
          <div className="rounded-xl border border-border/60 bg-card p-4">
            <div className="grid gap-4 md:grid-cols-3">
              {(
                [
                  ["smokeFailThreshold", t("smokeFailThreshold"), 1, 20],
                  ["cronLatencyBudgetMs", t("cronLatencyBudget"), 500, 600000],
                  ["alertMaxPerWindow", t("alertMaxPerWindow"), 1, 50],
                  ["alertWindowMinutes", t("alertWindowMinutes"), 1, 1440],
                  ["emailRetryAttempts", t("emailRetryAttempts"), 1, 6],
                ] as const
              ).map(([key, label, min, max]) => (
                <label key={key} className="block text-caption text-ink-soft">
                  {label}
                  <input
                    type="number"
                    min={min}
                    max={max}
                    value={current[key]}
                    onChange={(e) =>
                      setForm({ ...current, [key]: Number(e.target.value) })
                    }
                    className="mt-1 block min-h-11 w-full rounded-md border border-border bg-background px-3 font-mono text-sm text-ink"
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => saveThresholds.mutate(current)}
                disabled={saveThresholds.isPending}
                className="min-h-11 rounded-md gold-gradient px-4 text-sm font-semibold text-ink disabled:opacity-50"
              >
                {saveThresholds.isPending ? t("loading") : t("saveThresholds")}
              </button>
              <span className="text-caption text-ink-soft" role="status" aria-live="polite" aria-atomic="true">
                {saveThresholds.isError
                  ? errorMessage(saveThresholds.error)
                  : saveThresholds.isSuccess
                    ? t("thresholdsSaved")
                    : ""}
              </span>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}


function Card({
  label,
  value,
  detail,
  badge,
  badgeLabel,
}: {
  label: string;
  value: string;
  detail?: string;
  badge?: string | null;
  badgeLabel?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card p-4 shadow-card">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-sm font-semibold text-ink">{value}</div>
      {detail && <div className="mt-1 truncate text-caption text-ink-soft" dir="auto">{detail}</div>}
      {badge && (
        <span className={`mt-2 inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${tone(badge)}`}>
          {badgeLabel ?? badge}
        </span>
      )}
    </div>
  );
}