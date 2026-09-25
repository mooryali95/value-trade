import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { AccessDenied } from "@/components/access-denied";
import { useI18n, type Key } from "@/lib/i18n";
import { Num } from "@/components/num";
import { formatDateTime } from "@/components/market-data";
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
  const when = (iso: string) => formatDateTime(iso, lang);
  const tableChecks = (data?.checks ?? []).filter((c) => !c.key.startsWith("integrity"));
  const integrityChecks = (data?.checks ?? []).filter((c) => c.key.startsWith("integrity"));

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("modePlatform")}
        title={t("opsHealth")}
        description={t("opsHealthDesc")}
        crumbs={[{ label: t("modePlatform"), to: "/" }, { label: t("opsHealth") }]}
        actions={
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="min-h-11 rounded-md border border-border bg-card px-4 text-sm font-semibold text-ink hover:border-[var(--gold-deep)] disabled:opacity-50"
          >
            {isFetching ? t("loading") : t("refresh")}
          </button>
        }
      />

      {isLoading || !data ? (
        <LuxurySkeleton lines={8} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" role="status" aria-live="polite" aria-atomic="false">
            <Card label={t("emailsSent24h")} value={<Num value={data.email.sent24h} kind="qty" />} />
            <Card
              label={t("emailsFailed24h")}
              value={<Num value={data.email.failed24h} kind="qty" />}
              badge={label(data.email.status)}
              badgeTone={tone(data.email.status)}
            />
            <Card label={t("activeAlerts")} value={<Num value={data.alerts.active} kind="qty" />} />
            <Card
              label={t("lastAlertTriggered")}
              value={data.alerts.lastTriggeredAt ? when(data.alerts.lastTriggeredAt) : t("never")}
              small
            />
          </dl>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {t("checkedAt")}: {when(data.checkedAt)} · {t("slowestCheck")}:{" "}
            <code className="text-[11px]" dir="ltr">{data.slowest.key}</code>{" "}
            (<Num value={data.slowest.latencyMs} kind="qty" /> {t("u_ms")})
          </p>

          <CheckTable
            title={t("u_healthTables")}
            valueHeader={t("rowsCount")}
            rows={tableChecks}
            labelOf={(k) => checkLabel(k, t)}
            statusLabel={label}
          />
          <CheckTable
            title={t("u_healthIntegrity")}
            description={t("u_healthIntegrityDesc")}
            valueHeader={t("u_healthViolations")}
            rows={integrityChecks}
            labelOf={(k) => checkLabel(k, t)}
            statusLabel={label}
          />
        </>
      )}
    </AppShell>
  );
}

const CHECK_KEYS: Record<string, Key> = {
  companies: "u_hcCompanies",
  company_members: "u_hcCompanyMembers",
  product_submissions: "u_hcSubmissions",
  orders: "u_hcOrders",
  positions: "u_hcPositions",
  cash_ledger: "u_hcCashLedger",
  shariah_decisions: "u_hcShariahDecisions",
  price_alerts: "u_hcPriceAlerts",
  email_send_log: "u_hcEmailLog",
  integrity: "u_hcIntegrityUnavailable",
  "integrity.cash_matches_ledger": "u_hcCashMatchesLedger",
  "integrity.trade_cash_balanced": "u_hcTradeCashBalanced",
  "integrity.no_negative_cash": "u_hcNoNegativeCash",
  "integrity.units_match_history": "u_hcUnitsMatchHistory",
  "integrity.units_conserved_per_symbol": "u_hcUnitsConserved",
  "integrity.no_negative_positions": "u_hcNoNegativePositions",
  "integrity.orders_fill_within_qty": "u_hcOrdersFillWithinQty",
  "integrity.no_resting_on_unpublished": "u_hcNoRestingOnUnpublished",
  "integrity.trades_reference_orders": "u_hcTradesReferenceOrders",
  "integrity.published_ready": "u_hcPublishedReady",
  "integrity.cost_basis_not_negative": "u_hcCostBasisNotNegative",
};

/** Human label of a check; unknown (newer) checks show their key. */
function checkLabel(key: string, t: (k: Key) => string): string | null {
  const k = CHECK_KEYS[key];
  return k ? t(k) : null;
}

type Check = { key: string; status: string; latencyMs: number; detail: string };

function CheckTable({
  title,
  description,
  valueHeader,
  rows,
  labelOf,
  statusLabel,
}: {
  title: string;
  description?: string;
  valueHeader: string;
  rows: Check[];
  labelOf: (key: string) => string | null;
  statusLabel: (s: string) => string;
}) {
  const { t } = useI18n();
  if (rows.length === 0) return null;
  const cols = "grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]";
  return (
    <section className="mt-6">
      <h2 className="text-[15px] font-bold text-ink">{title}</h2>
      {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card shadow-card">
        <div className={`grid ${cols} gap-3 border-b border-border/70 bg-secondary/40 px-4 py-2.5 text-xs font-medium text-muted-foreground`}>
          <span>{t("u_healthCheck")}</span>
          <span className="text-end">{valueHeader}</span>
          <span className="hidden text-end sm:block">{t("latency")}</span>
          <span className="text-end">{t("u_status")}</span>
        </div>
        {rows.map((c) => {
          const name = labelOf(c.key);
          const numeric = /^\d+$/.test(c.detail);
          return (
            <div key={c.key} className={`grid ${cols} items-center gap-3 border-b border-border/50 px-4 py-3 text-sm last:border-b-0`}>
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{name ?? c.key}</div>
                {name && (
                  <code className="block truncate text-[11px] text-muted-foreground" dir="ltr" style={{ textAlign: "start" }}>
                    {c.key}
                  </code>
                )}
              </div>
              <span className="text-end text-ink-soft">
                {numeric ? <Num value={Number(c.detail)} kind="qty" /> : <Num value={null} />}
              </span>
              <span className="hidden text-end text-ink-soft sm:block">
                <Num value={c.latencyMs} kind="qty" /> {t("u_ms")}
              </span>
              <span className={`justify-self-end whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-semibold ${tone(c.status)}`}>
                {statusLabel(c.status)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Card({
  label,
  value,
  badge,
  badgeTone,
  small,
}: {
  label: string;
  value: React.ReactNode;
  badge?: string;
  badgeTone?: string;
  small?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card p-4 shadow-card">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-1.5 font-semibold text-ink ${small ? "text-sm" : "text-xl"}`}>{value}</dd>
      {badge && (
        <dd className={`mt-1.5 inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${badgeTone ?? ""}`}>{badge}</dd>
      )}
    </div>
  );
}
