import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { UserPlus, ClipboardText, EnvelopeSimple, Buildings, UsersThree } from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n";
import { listAccessRequests } from "@/lib/access/access-requests.functions";
import { DashCard } from "@/components/dash-card";
import { useMyRoles } from "@/hooks/use-my-roles";

export function PlatformDashboard() {
  const { t, dir } = useI18n();
  const listFn = useServerFn(listAccessRequests);
  const { isAdmin } = useMyRoles();

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

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <DashCard
          to="/admin/companies"
          icon={Buildings}
          title={t("companiesDirectory")}
          hint={t("companiesDirectoryDesc")}
        />
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
        {isAdmin && (
          <DashCard
            to="/admin/investors"
            icon={UsersThree}
            title={t("nav_investors")}
            hint={t("investorsDashHint")}
          />
        )}
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
