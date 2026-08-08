import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, EnvelopeSimple, UserPlus, Buildings, ArrowRight } from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n";
import { useActiveCompany } from "@/hooks/use-active-company";
import { listAccessRequests } from "@/lib/access/access-requests.functions";
import { EmptyState } from "@/components/empty-state";
import { DashCard } from "@/components/dash-card";

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
      <div className="py-16">
        <EmptyState title={t("noCompanyYet")} description={t("noCompanyYetDesc")} />
        <div className="mt-4 text-center">
          <Link
            to="/company/settings"
            className="inline-flex items-center gap-2 rounded-md gold-gradient px-5 py-2.5 text-sm font-semibold text-ink"
          >
            {t("createCompany")}
          </Link>
        </div>
      </div>
    );
  }

  const companyName = lang === "ar" ? active.name_ar : active.name_en;

  return (
    <div dir={dir}>
      <section className="relative overflow-hidden rounded-2xl border border-border/70 ivory-gradient px-6 py-10 shadow-luxury md:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px hairline-gold"
        />
        <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[var(--gold-deep)]">
          {t("modeBrand")}
        </div>
        <h1 className="text-2xl font-bold text-ink md:text-3xl">{companyName}</h1>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">{t("brandDashboardSub")}</p>
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <DashCard
          to="/access-requests"
          icon={UserPlus}
          title={t("accessRequestsQueue")}
          value={String(pendingForActive.length)}
          hint={t("pendingReview")}
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
          className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--gold-deep)] hover:underline"
        >
          <Briefcase size={16} />
          {t("company")}
          <ArrowRight className={dir === "rtl" ? "rotate-180" : ""} size={14} />
        </Link>
      </div>
    </div>
  );
}
