import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { AccessDenied } from "@/components/access-denied";
import { useI18n } from "@/lib/i18n";
import { useMyRoles } from "@/hooks/use-my-roles";
import { getOpsRuns, listOpsRuns, runSmokeSuite } from "@/lib/ops/ops.functions";

export const Route = createFileRoute("/_authenticated/admin/ops")({
  head: () => ({
    meta: [
      { title: "دخان ما بعد النشر — وحدة القيمة" },
      {
        name: "description",
        content: "تشغيل اختبار الدخان للمسارات الحرجة والتحقق من جدولة فحص التنبيهات السعرية.",
      },
      { property: "og:title", content: "دخان ما بعد النشر — وحدة القيمة" },
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
  const runsFn = useServerFn(getOpsRuns);
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

  const fmt = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(lang === "ar" ? "ar" : "en-US") : t("never");

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
        eyebrow="Admin"
        title={t("opsSmoke")}
        description={t("opsSmokeDesc")}
        crumbs={[{ label: "Admin", to: "/admin/companies" }, { label: t("opsSmoke") }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => smoke.mutate()}
              disabled={smoke.isPending}
              className="min-h-11 rounded-md bg-[var(--gold-deep)] px-4 text-sm font-semibold text-ink-invert disabled:opacity-50"
            >
              {smoke.isPending ? t("running") : t("runSmoke")}
            </button>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="min-h-11 rounded-md border border-border px-4 text-sm font-semibold text-ink hover:border-[var(--gold-deep)] disabled:opacity-50"
            >
              {isFetching ? t("loading") : t("refresh")}
            </button>
          </div>
        }
      />

      <label className="mb-4 flex items-center gap-2 text-sm text-ink-soft">
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
            detail={data.lastCron?.detail ?? "—"}
          />
          <Card
            label={t("lastSmokeRun")}
            value={fmt(data.lastSmoke?.created_at ?? null)}
            badge={data.lastSmoke?.status}
            detail={data.lastSmoke?.detail ?? "—"}
          />
          <Card label={t("activeAlerts")} value={String(data.activeAlerts)} detail={fmt(data.checkedAt)} />
        </div>
      )}

      <div className="mt-6" role="status" aria-live="polite">
        {smoke.isError && (
          <p className="text-sm text-[var(--bear)]">
            {(smoke.error as Error).message}
          </p>
        )}
        {report && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${tone(report.status)}`}>
                {report.status.toUpperCase()}
              </span>
              <span className="text-ink-soft">
                {t("smokePassed")}: {report.passed} · {t("smokeWarned")}: {report.warned} ·{" "}
                {t("smokeFailed")}: {report.failed} · {report.durationMs} ms
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
              {report.checks.map((c) => (
                <div
                  key={c.key}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0"
                >
                  <span className="truncate font-mono text-ink">{c.key}</span>
                  <span className="truncate text-ink-soft">{c.detail}</span>
                  <span className="font-mono text-ink-soft">{c.durationMs} ms</span>
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${tone(c.status)}`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {data && data.runs.length > 0 && (
        <>
          <section className="mt-8">
            <h2 className="mb-2 text-label text-ink-soft">{t("opsKpis")}</h2>
            {log.data ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <Card
                    label={t("avgLatency")}
                    value={`${log.data.kpis.avgMs} ms`}
                    detail={`p95 ${log.data.kpis.p95Ms} ms · max ${log.data.kpis.maxMs} ms`}
                  />
                  <Card
                    label={t("successRate")}
                    value={`${log.data.kpis.successRate}%`}
                    detail={`${log.data.kpis.ok} ok · ${log.data.kpis.warn} warn · ${log.data.kpis.fail} fail`}
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
                            title={`${d.day}: ${d.total} runs · ${d.fail} fail · avg ${d.avgMs} ms`}
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
                  <option value="ok">ok</option>
                  <option value="warn">warn</option>
                  <option value="fail">fail</option>
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
          <h2 className="mb-2 text-label text-ink-soft">{t("recentRuns")}</h2>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>{t("job")}</span>
              <span>{t("result")}</span>
              <span>{t("when")}</span>
              <span className="text-end">Status</span>
            </div>
            {(log.data?.items ?? data.runs).map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0"
              >
                <span className="truncate font-mono text-ink">{r.job}</span>
                <span className="truncate text-ink-soft">{r.detail ?? "—"}</span>
                <span className="whitespace-nowrap text-ink-soft">{fmt(r.created_at)}</span>
                <span className={`justify-self-end rounded border px-2 py-0.5 text-[10px] font-semibold ${tone(r.status)}`}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}

function Card({
  label,
  value,
  detail,
  badge,
}: {
  label: string;
  value: string;
  detail?: string;
  badge?: string | null;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="text-label text-ink-soft">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-ink">{value}</div>
      {detail && <div className="mt-1 truncate text-caption text-ink-soft">{detail}</div>}
      {badge && (
        <span className={`mt-2 inline-block rounded border px-2 py-0.5 text-[10px] font-semibold ${tone(badge)}`}>
          {badge}
        </span>
      )}
    </div>
  );
}