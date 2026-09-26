import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  UserPlus,
  ClipboardText,
  EnvelopeSimple,
  Buildings,
  UsersThree,
  Pulse,
  Gear,
  Scales,
} from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n";
import { listAccessRequests } from "@/lib/access/access-requests.functions";
import { listPendingActivations } from "@/lib/admin/investors.functions";
import { DashCard } from "@/components/dash-card";
import { useMyRoles } from "@/hooks/use-my-roles";
import { fill } from "@/lib/account/fill";
import { Num } from "@/components/num";

/**
 * Platform mode home: what is waiting for the platform team, from the
 * database (pending access requests by kind, accounts waiting for trading
 * activation), plus shortcuts to every admin screen.
 */
export function PlatformDashboard() {
  const { t, dir } = useI18n();
  const listFn = useServerFn(listAccessRequests);
  const pendingFn = useServerFn(listPendingActivations);
  const { isAdmin, isReviewer } = useMyRoles();

  const requests = useQuery({
    queryKey: ["access-requests"],
    queryFn: () => listFn(),
  });
  const activations = useQuery({
    queryKey: ["admin-pending-activations"],
    queryFn: () => pendingFn(),
    enabled: isAdmin,
    staleTime: 30_000,
  });
  const rows = requests.data ?? [];
  const investorCount = rows.filter((r) => r.join_method === "investor").length;
  const newCompanyCount = rows.filter((r) => r.join_method === "new_company").length;
  const joinCount = rows.length - investorCount - newCompanyCount;

  return (
    <div dir={dir}>
      <section className="relative overflow-hidden rounded-2xl border border-border/70 ivory-gradient px-5 py-8 shadow-card sm:px-8 md:py-10">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px hairline-gold" />
        <div className="mb-1 text-xs font-semibold text-[var(--gold-ink)]">{t("modePlatform")}</div>
        <h1 className="text-title text-ink">{t("platformDashboardTitle")}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{t("platformDashboardSub")}</p>
      </section>

      <h2 className="mb-3 mt-8 text-lg font-bold text-ink">{t("u_pdWaiting")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashCard
          to="/access-requests"
          icon={UserPlus}
          title={t("accessRequestsQueue")}
          value={requests.data ? <Num value={rows.length} kind="qty" /> : undefined}
          hint={
            requests.data
              ? fill(t("u_pdRequestsBreakdown"), {
                  investors: <Num value={investorCount} kind="qty" />,
                  companies: <Num value={newCompanyCount} kind="qty" />,
                  joins: <Num value={joinCount} kind="qty" />,
                })
              : t("u_pdRequestsHint")
          }
          highlight={rows.length > 0}
        />
        {isAdmin && (
          <DashCard
            to="/admin/investors"
            icon={UsersThree}
            title={t("u_pdActivationsTitle")}
            value={activations.data ? <Num value={activations.data.length} kind="qty" /> : undefined}
            hint={t("u_pdActivationsHint")}
            highlight={(activations.data?.length ?? 0) > 0}
          />
        )}
        <DashCard
          to="/admin/submissions"
          icon={ClipboardText}
          title={t("nav_submissions")}
          hint={t("reviewBrandSubmissions")}
        />
        {isReviewer && (
          <DashCard to="/shariah/review" icon={Scales} title={t("shariahReview")} hint={t("u_reviewerCardDesc")} />
        )}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-bold text-ink">{t("u_pdTools")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashCard to="/admin/companies" icon={Buildings} title={t("companiesDirectory")} hint={t("companiesDirectoryDesc")} />
        {isAdmin && (
          <>
            <DashCard to="/admin/investors" icon={UsersThree} title={t("nav_investors")} hint={t("investorsDashHint")} />
            <DashCard to="/admin/email-log" icon={EnvelopeSimple} title={t("nav_emailLog")} hint={t("monitorEmailDelivery")} />
            <DashCard to="/admin/health" icon={Pulse} title={t("nav_health")} hint={t("u_pdHealthHint")} />
            <DashCard to="/admin/ops" icon={Gear} title={t("nav_ops")} hint={t("u_pdOpsHint")} />
          </>
        )}
      </div>
    </div>
  );
}
