import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { AccessDenied } from "@/components/access-denied";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/components/market-data";
import { useMyRoles } from "@/hooks/use-my-roles";
import { getOpsRunDetail } from "@/lib/ops/ops.functions";

export const Route = createFileRoute("/_authenticated/admin/ops_/$id")({
  head: () => ({
    meta: [
      { title: "تفاصيل تشغيل — وحدة القيمة | Run details — Value Unit" },
      { name: "description", content: "سبب الفشل الكامل ومسار التنفيذ خطوة بخطوة ومقاييس التشغيل." },
      { property: "og:title", content: "تفاصيل تشغيل — وحدة القيمة" },
      { property: "og:description", content: "مسار التنفيذ والمقاييس لكل عملية تشغيل." },
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
  component: OpsRunDetailPage,
});

const tone = (status: string) =>
  status === "ok"
    ? "text-[var(--bull)] border-[var(--bull)]/40 bg-[var(--bull)]/10"
    : status === "warn"
      ? "text-[var(--gold-deep)] border-[var(--gold-deep)]/40 bg-[var(--gold-deep)]/10"
      : "text-[var(--bear)] border-[var(--bear)]/40 bg-[var(--bear)]/10";

function OpsRunDetailPage() {
  const { t, lang } = useI18n();
  const { id } = useParams({ from: "/_authenticated/admin/ops_/$id" });
  const { isAdmin, isLoading: rolesLoading } = useMyRoles();
  const detailFn = useServerFn(getOpsRunDetail);

  const { data, isLoading } = useQuery({
    queryKey: ["ops-run-detail", id],
    queryFn: () => detailFn({ data: { id } }),
    enabled: isAdmin,
  });

  const fmt = (iso: string | null | undefined) => (iso ? formatDateTime(iso, lang) : "—");
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

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("modePlatform")}
        title={t("runDetail")}
        description={t("runDetailDesc")}
        crumbs={[
          { label: t("modePlatform"), to: "/" },
          { label: t("opsSmoke"), to: "/admin/ops" },
          { label: t("runDetail") },
        ]}
      />

      {isLoading || !data ? (
        <LuxurySkeleton lines={8} />
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-border/70 bg-card p-4 shadow-card">
            <div className="flex flex-wrap items-center gap-3">
              <code className="text-sm font-semibold text-ink" dir="ltr">{data.run.job}</code>
              <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${tone(data.run.status)}`}>
                {stLabel(data.run.status)}
              </span>
              <span className="text-caption text-ink-soft">{fmt(data.run.created_at)}</span>
              <span className="text-caption text-ink-soft" dir="ltr">{ms(data.run.duration_ms ?? 0)}</span>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ink-soft" dir="auto">
              {data.run.detail ?? "—"}
            </p>
          </div>

          <section>
            <h2 className="mb-2 text-[15px] font-bold text-ink">{t("executionPath")}</h2>
            {data.steps.length === 0 ? (
              <p className="text-caption text-ink-soft">{t("noSteps")}</p>
            ) : (
              <ol className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-card">
                {data.steps.map((s) => (
                  <li
                    key={`${s.index}-${s.key}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/50 px-4 py-3 text-xs last:border-b-0"
                  >
                    <span className="w-6 shrink-0 text-ink-soft tabular-nums" dir="ltr">{s.index}</span>
                    <code className="min-w-0 flex-1 truncate text-ink" dir="ltr" style={{ textAlign: "start" }}>{s.key}</code>
                    {s.detail && <span className="min-w-0 flex-1 truncate text-ink-soft" dir="auto">{s.detail}</span>}
                    {s.durationMs !== null && (
                      <span className="text-ink-soft" dir="ltr">{ms(s.durationMs)}</span>
                    )}
                    <span className={`whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-semibold ${tone(s.status)}`}>
                      {stLabel(s.status)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-[15px] font-bold text-ink">{t("runMetrics")}</h2>
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-card">
              {data.metricEntries.length === 0 ? (
                <p className="px-4 py-3 text-caption text-ink-soft">—</p>
              ) : (
                data.metricEntries.map((m) => (
                  <div
                    key={m.key}
                    className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-2 text-xs last:border-b-0"
                  >
                    <code className="text-ink-soft" dir="ltr">{m.key}</code>
                    <code className="truncate text-ink" dir="ltr">{m.value}</code>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-[15px] font-bold text-ink">{t("nearbyRuns")}</h2>
            <div className="flex flex-wrap gap-2">
              {data.siblings.map((s) => (
                <Link
                  key={s.id}
                  to="/admin/ops/$id"
                  params={{ id: s.id }}
                  className={`inline-flex min-h-9 items-center rounded border px-2.5 text-[11px] font-semibold ${tone(s.status)} ${
                    s.id === data.run.id ? "ring-1 ring-[var(--gold-deep)]" : ""
                  }`}
                >
                  {fmt(s.created_at)}
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
