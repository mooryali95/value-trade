import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { AccessDenied } from "@/components/access-denied";
import { useI18n } from "@/lib/i18n";
import { useMyRoles } from "@/hooks/use-my-roles";
import { getOpsRunDetail } from "@/lib/ops/ops.functions";

export const Route = createFileRoute("/_authenticated/admin/ops_/$id")({
  head: () => ({
    meta: [
      { title: "تفاصيل تشغيل — وحدة القيمة" },
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

  const fmt = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(lang === "ar" ? "ar" : "en-US") : "—";

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
        eyebrow="Admin"
        title={t("runDetail")}
        description={t("runDetailDesc")}
        crumbs={[
          { label: "Admin", to: "/admin/companies" },
          { label: t("opsSmoke"), to: "/admin/ops" },
          { label: t("runDetail") },
        ]}
      />

      {isLoading || !data ? (
        <LuxurySkeleton lines={8} />
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-border/60 bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm font-semibold text-ink">{data.run.job}</span>
              <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${tone(data.run.status)}`}>
                {data.run.status}
              </span>
              <span className="text-caption text-ink-soft">{fmt(data.run.created_at)}</span>
              <span className="font-mono text-caption text-ink-soft">{data.run.duration_ms ?? 0} ms</span>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ink-soft">
              {data.run.detail ?? "—"}
            </p>
          </div>

          <section>
            <h2 className="mb-2 text-label text-ink-soft">{t("executionPath")}</h2>
            {data.steps.length === 0 ? (
              <p className="text-caption text-ink-soft">{t("noSteps")}</p>
            ) : (
              <ol className="overflow-hidden rounded-xl border border-border/60 bg-card">
                {data.steps.map((s) => (
                  <li
                    key={`${s.index}-${s.key}`}
                    className="flex items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0"
                  >
                    <span className="w-6 shrink-0 font-mono text-ink-soft">{s.index}</span>
                    <span className="flex-1 truncate font-mono text-ink">{s.key}</span>
                    {s.detail && <span className="flex-1 truncate text-ink-soft">{s.detail}</span>}
                    {s.durationMs !== null && (
                      <span className="font-mono text-ink-soft">{s.durationMs} ms</span>
                    )}
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${tone(s.status)}`}>
                      {s.status}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-label text-ink-soft">{t("runMetrics")}</h2>
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
              {data.metricEntries.length === 0 ? (
                <p className="px-4 py-3 text-caption text-ink-soft">—</p>
              ) : (
                data.metricEntries.map((m) => (
                  <div
                    key={m.key}
                    className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-2 text-xs last:border-b-0"
                  >
                    <span className="font-mono text-ink-soft">{m.key}</span>
                    <span className="truncate font-mono text-ink">{m.value}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-label text-ink-soft">{t("nearbyRuns")}</h2>
            <div className="flex flex-wrap gap-2">
              {data.siblings.map((s) => (
                <Link
                  key={s.id}
                  to="/admin/ops_/$id"
                  params={{ id: s.id }}
                  className={`rounded border px-2 py-1 text-[11px] font-semibold ${tone(s.status)} ${
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
