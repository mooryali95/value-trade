import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { UserPlus, ClipboardText, EnvelopeSimple } from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n";
import { listAccessRequests } from "@/lib/access/access-requests.functions";

export function PlatformDashboard() {
  const { t, dir } = useI18n();
  const listFn = useServerFn(listAccessRequests);

  const { data } = useQuery({
    queryKey: ["access-requests"],
    queryFn: () => listFn(),
  });
  const rows = data ?? [];
  const newCompanyCount = rows.filter((r) => !r.requested_company_id).length;
  const joinCount = rows.length - newCompanyCount;

  return (
    <div dir={dir}>
      <section className="relative overflow-hidden rounded-2xl border border-border/70 ivory-gradient px-6 py-10 shadow-luxury md:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px hairline-gold"
        />
        <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[var(--gold-deep)]">
          {t("modePlatform")}
        </div>
        <h1 className="text-2xl font-bold text-ink md:text-3xl">{t("platformDashboardTitle")}</h1>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">{t("platformDashboardSub")}</p>
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <DashCard
          to="/access-requests"
          icon={UserPlus}
          title={t("accessRequestsQueue")}
          value={String(rows.length)}
          hint={`${newCompanyCount} ${t("newCompanyRequest")} · ${joinCount} ${t("joinCompanyRequest")}`}
        />
        <DashCard
          to="/admin/submissions"
          icon={ClipboardText}
          title={t("nav_submissions")}
          hint={t("reviewBrandSubmissions")}
        />
        <DashCard
          to="/admin/email-log"
          icon={EnvelopeSimple}
          title={t("nav_emailLog")}
          hint={t("monitorEmailDelivery")}
        />
      </div>
    </div>
  );
}

function DashCard({
  to,
  icon: Icon,
  title,
  value,
  hint,
}: {
  to: string;
  icon: React.ComponentType<{ size?: number; weight?: "duotone" | "regular" }>;
  title: string;
  value?: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-[var(--gold)]/50 hover:shadow-luxury"
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[var(--gold)]/10 text-[var(--gold-deep)]">
        <Icon size={18} weight="duotone" />
      </div>
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {value && (
          <span className="font-mono text-lg font-bold text-[var(--gold-deep)]">{value}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </Link>
  );
}
