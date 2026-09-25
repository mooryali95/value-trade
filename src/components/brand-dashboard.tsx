import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, EnvelopeSimple, UserPlus, Buildings, ArrowRight } from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n";
import { useActiveCompany } from "@/hooks/use-active-company";
import { listAccessRequests } from "@/lib/access/access-requests.functions";
import { EmptyState } from "@/components/empty-state";
import { DashCard } from "@/components/dash-card";
import { Num } from "@/components/num";

export function BrandDashboard() {
  const { t, lang, dir } = useI18n();
  const { active, activeId, isLoading } = useActiveCompany();
  const listFn = useServerFn(listAccessRequests);

  const { data } = useQuery({
    queryKey: ["access-requests"],
    queryFn: () => listFn(),
  });
  const pendingForActive = (data ?? []).filter((r) => r.requested_company_id === activeId);

  if (isLoading) return null;

  if (!activeId || !active) {
    return (
      <div className="py-10">
        <EmptyState
          icon={<Buildings size={22} weight="duotone" />}
          title={t("u_wsNoCompanyTitle")}
          description={t("u_wsNoCompanyDesc")}
          action={
            <div className="flex flex-col justify-center gap-2 sm:flex-row">
              <Link to="/invitations" className="inline-flex min-h-11 items-center justify-center rounded-md gold-gradient px-5 text-sm font-semibold text-ink">
                {t("incomingInvitations")}
              </Link>
              <Link
                to="/request-access"
                search={{ kind: "new" }}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-card px-5 text-sm font-semibold text-ink hover:border-[var(--gold-deep)]"
              >
                {t("u_ctaCompany")}
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const companyName = lang === "ar" ? active.name_ar : active.name_en;

  return (
    <div dir={dir}>
      <section className="relative overflow-hidden rounded-2xl border border-border/70 ivory-gradient px-5 py-8 shadow-card sm:px-8 md:py-10">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px hairline-gold" />
        <div className="mb-1 text-xs font-semibold text-[var(--gold-ink)]">{t("modeBrand")}</div>
        <h1 className="text-title text-ink">{companyName}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{t("brandDashboardSub")}</p>
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <DashCard
          to="/access-requests"
          icon={UserPlus}
          title={t("accessRequestsQueue")}
          value={data ? <Num value={pendingForActive.length} kind="qty" /> : undefined}
          hint={t("pendingReview")}
          highlight={pendingForActive.length > 0}
        />
        <DashCard
          to="/invitations"
          icon={EnvelopeSimple}
          title={t("invitations")}
          hint={t("manageInvites")}
        />
        <DashCard
          to="/workspace"
          icon={Buildings}
          title={t("nav_workspace")}
          hint={t("goToWorkspace")}
        />
      </div>

      <div className="mt-4">
        <Link
          to="/company/settings"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--gold-ink)] underline-offset-4 hover:underline"
        >
          <Briefcase size={16} />
          {t("company")}
          <ArrowRight className={dir === "rtl" ? "rotate-180" : ""} size={14} />
        </Link>
      </div>
    </div>
  );
}
