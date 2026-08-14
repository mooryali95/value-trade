import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { AccessDenied } from "@/components/access-denied";
import { useI18n } from "@/lib/i18n";
import { useMyRoles } from "@/hooks/use-my-roles";
import { getPlatformHealth } from "@/lib/ops/health.functions";

export const Route = createFileRoute("/_authenticated/admin/health")({
  head: () => ({
    meta: [
      { title: "الصحة التشغيلية — وحدة القيمة" },
      { name: "description", content: "حالة الجداول والخدمات وزمن الاستجابة وتحذيرات الأخطاء." },
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
  component: HealthPage,
});

const tone = (status: string) =>
  status === "ok"
    ? "text-[var(--bull)] border-[var(--bull)]/40 bg-[var(--bull)]/10"
    : status === "warn"
      ? "text-[var(--gold-deep)] border-[var(--gold-deep)]/40 bg-[var(--gold-deep)]/10"
      : "text-[var(--bear)] border-[var(--bear)]/40 bg-[var(--bear)]/10";

function HealthPage() {
  const { t, lang } = useI18n();
  const { isAdmin, isLoading: rolesLoading } = useMyRoles();
  const fn = useServerFn(getPlatformHealth);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["platform-health"],
    queryFn: () => fn(),
    enabled: isAdmin,
    refetchInterval: 60_000,
  });

  if (!rolesLoading && !isAdmin) {
    return (
      <AppShell>
        <div className="py-16">
          <AccessDenied />
        </div>
      </AppShell>
    );
  }

  const label = (s: string) => (s === "ok" ? t("healthOk") : s === "warn" ? t("healthWarn") : t("healthFail"));

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title={t("opsHealth")}
        description={t("opsHealthDesc")}
        crumbs={[{ label: "Admin", to: "/admin/companies" }, { label: t("opsHealth") }]}
        actions={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="min-h-11 rounded-md border border-border px-4 text-sm font-semibold text-ink hover:border-[var(--gold-deep)] disabled:opacity-50"
          >
            {isFetching ? t("loading") : t("refresh")}
          </button>
        }
      />

      {isLoading || !data ? (
        <LuxurySkeleton lines={8} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="status" aria-live="polite">
            <Card label={t("emailsSent24h")} value={String(data.email.sent24h)} />
            <Card
              label={t("emailsFailed24h")}
              value={String(data.email.failed24h)}
              badge={label(data.email.status)}
              badgeTone={tone(data.email.status)}
            />
            <Card label={t("activeAlerts")} value={String(data.alerts.active)} />
            <Card
              label={t("lastAlertTriggered")}
              value={
                data.alerts.lastTriggeredAt
                  ? new Date(data.alerts.lastTriggeredAt).toLocaleString(lang === "ar" ? "ar" : "en-US")
                  : t("never")
              }
            />
          </div>

          <div className="mt-3 text-caption text-ink-soft">
            {t("checkedAt")}: {new Date(data.checkedAt).toLocaleString(lang === "ar" ? "ar" : "en-US")} ·{" "}
            {t("slowestCheck")}: {data.slowest.key} ({data.slowest.latencyMs} ms)
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-border/60 bg-card">
            <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_auto] gap-3 border-b border-border/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Table</span>
              <span className="text-end">{t("rowsCount")}</span>
              <span className="text-end">{t("latency")}</span>
              <span className="text-end">Status</span>
            </div>
            {data.checks.map((c) => (
              <div
                key={c.key}
                className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_auto] items-center gap-3 border-b border-border/40 px-4 py-3 text-xs last:border-b-0"
              >
                <span className="truncate font-mono text-ink">{c.key}</span>
                <span className="text-end font-mono text-ink-soft">{c.status === "fail" ? "—" : c.detail}</span>
                <span className="text-end font-mono text-ink-soft">{c.latencyMs} ms</span>
                <span className={`justify-self-end rounded border px-2 py-0.5 text-[10px] font-semibold ${tone(c.status)}`}>
                  {label(c.status)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}

function Card({
  label,
  value,
  badge,
  badgeTone,
}: {
  label: string;
  value: string;
  badge?: string;
  badgeTone?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="text-label text-ink-soft">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-ink">{value}</div>
      {badge && (
        <span className={`mt-1 inline-block rounded border px-2 py-0.5 text-[10px] font-semibold ${badgeTone ?? ""}`}>
          {badge}
        </span>
      )}
    </div>
  );
}
