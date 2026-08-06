import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { MagnifyingGlass, Buildings } from "@phosphor-icons/react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { AccessDenied } from "@/components/access-denied";
import { useI18n } from "@/lib/i18n";
import { useMyRoles } from "@/hooks/use-my-roles";
import { listAllCompaniesAdmin } from "@/lib/admin/companies-directory.functions";

const SearchSchema = z.object({ q: z.string().catch("").default("") });

export const Route = createFileRoute("/_authenticated/admin/companies")({
  validateSearch: (s: Record<string, unknown>) => SearchSchema.parse(s),
  head: () => ({
    meta: [{ title: "دليل الشركات — وحدة القيمة" }, { name: "robots", content: "noindex" }],
  }),
  errorComponent: ({ reset }) => (
    <AppShell>
      <div className="py-16">
        <ErrorState reset={reset} />
      </div>
    </AppShell>
  ),
  component: AdminCompaniesDirectory,
});

function AdminCompaniesDirectory() {
  const { t, lang, dir } = useI18n();
  const { isAdmin, isLoading: rolesLoading } = useMyRoles();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [q, setQ] = useState(search.q);

  const listFn = useServerFn(listAllCompaniesAdmin);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-companies", search.q],
    queryFn: () => listFn({ data: { search: search.q || undefined } }),
    enabled: !rolesLoading && isAdmin,
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

  const rows = data ?? [];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title={t("companiesDirectory")}
        description={t("companiesDirectoryDesc")}
        crumbs={[{ label: t("companiesDirectory") }]}
      />

      <div className="mb-5">
        <div className="relative max-w-sm">
          <MagnifyingGlass
            size={15}
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground rtl:right-3 ltr:left-3"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && navigate({ search: { q } })}
            onBlur={() => navigate({ search: { q } })}
            placeholder={t("searchCompanyPlaceholder")}
            className="w-full rounded-md border border-input bg-card py-2 text-sm outline-none focus:border-[var(--gold-deep)] rtl:pr-9 rtl:pl-3 ltr:pl-9 ltr:pr-3"
          />
        </div>
      </div>

      {isLoading || rolesLoading ? (
        <LuxurySkeleton lines={6} />
      ) : isError ? (
        <div className="py-16">
          <ErrorState reset={() => refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={t("noCompaniesFound")} description="" />
      ) : (
        <div dir={dir} className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 text-start font-semibold">{t("company")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("classifySector")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("plan")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("companyMembersCount")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("accessRequestsQueue")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("createdAt")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-border/40 last:border-0 hover:bg-secondary/30"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--gold)]/10 text-[var(--gold-deep)]">
                        <Buildings size={15} weight="duotone" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">
                          {lang === "ar" ? c.name_ar : c.name_en}
                        </div>
                        <div className="truncate text-xs text-muted-foreground" dir="ltr">
                          {c.slug}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{c.sector ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                      {c.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-ink">{c.memberCount}</td>
                  <td className="px-4 py-3">
                    {c.pendingAccessRequests > 0 ? (
                      <Link
                        to="/access-requests"
                        className="rounded-full border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--gold-deep)] hover:border-[var(--gold-deep)]"
                      >
                        {c.pendingAccessRequests} {t("pendingReview")}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
