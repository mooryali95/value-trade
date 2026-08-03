import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { useI18n } from "@/lib/i18n";
import {
  listAccessRequests,
  approveAccessRequest,
  rejectAccessRequest,
  type AccessRequestRow,
} from "@/lib/access/access-requests.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/access-requests")({
  head: () => ({
    meta: [{ title: "طلبات الانضمام — وحدة القيمة" }, { name: "robots", content: "noindex" }],
  }),
  errorComponent: ({ reset }) => (
    <AppShell>
      <div className="py-16">
        <ErrorState reset={reset} />
      </div>
    </AppShell>
  ),
  component: AccessRequestsPage,
});

type Row = AccessRequestRow;

const ROLE_OPTIONS = ["finance", "shariah", "trader", "viewer"] as const;

function slugify(nameEn: string): string {
  return (
    nameEn
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "company"
  );
}

function AccessRequestsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listAccessRequests);
  const approveFn = useServerFn(approveAccessRequest);
  const rejectFn = useServerFn(rejectAccessRequest);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["access-requests"],
    queryFn: () => listFn(),
  });

  const [roleById, setRoleById] = useState<Record<string, string>>({});
  const [sectorById, setSectorById] = useState<Record<string, string>>({});
  const [slugById, setSlugById] = useState<Record<string, string>>({});

  const approve = useMutation({
    mutationFn: (row: Row) => {
      if (row.requested_company_id) {
        return approveFn({
          data: {
            requestId: row.id,
            role: (roleById[row.id] ?? "viewer") as (typeof ROLE_OPTIONS)[number],
            origin: typeof window !== "undefined" ? window.location.origin : undefined,
          },
        });
      }
      const defaultSlug = slugify(row.new_company_name_en ?? "");
      return approveFn({
        data: {
          requestId: row.id,
          sector: sectorById[row.id] ?? "",
          slug: slugById[row.id] || defaultSlug,
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("accessRequestApproved"));
      qc.invalidateQueries({ queryKey: ["access-requests"] });
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof Error && e.message === "INVITATION_ALREADY_PENDING"
          ? t("inviteAlreadyPending")
          : e instanceof Error
            ? e.message
            : "Error",
      ),
  });

  const reject = useMutation({
    mutationFn: (requestId: string) => rejectFn({ data: { requestId } }),
    onSuccess: () => {
      toast.success(t("accessRequestRejected"));
      qc.invalidateQueries({ queryKey: ["access-requests"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  if (isLoading)
    return (
      <AppShell>
        <LuxurySkeleton lines={6} />
      </AppShell>
    );
  if (isError)
    return (
      <AppShell>
        <div className="py-16">
          <ErrorState reset={() => refetch()} />
        </div>
      </AppShell>
    );

  const rows = data ?? [];
  const newCompanyRows = rows.filter((r) => !r.requested_company_id);
  const joinRows = rows.filter((r) => r.requested_company_id);

  const initials = (name: string) =>
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";

  const methodLabel = (m: Row["join_method"]) =>
    m === "search" ? t("methodSearch") : m === "link" ? t("methodLink") : t("methodNewCompany");

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title={t("accessRequestsQueue")}
        description={t("accessRequestsQueueDesc")}
        crumbs={[{ label: t("accessRequestsQueue") }]}
      />

      {/* Stat strip */}
      <div className="mb-8 grid grid-cols-3 divide-x divide-border/60 rounded-xl border border-border/60 bg-card [&>*]:px-5 [&>*]:py-4 rtl:divide-x-reverse">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t("total")}
          </div>
          <div className="mt-1 text-2xl font-bold text-ink">{rows.length}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t("newCompanyRequest")}
          </div>
          <div className="mt-1 text-2xl font-bold text-ink">{newCompanyRows.length}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t("joinCompanyRequest")}
          </div>
          <div className="mt-1 text-2xl font-bold text-ink">{joinRows.length}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t("noAccessRequests")} description="" />
      ) : (
        <div className="space-y-10">
          {newCompanyRows.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--gold-deep)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
                {t("newCompanyRequest")}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {newCompanyRows.map((r) => (
                  <RequestCard
                    key={r.id}
                    row={r}
                    lang={lang}
                    t={t}
                    initials={initials(r.full_name)}
                    subtitle={
                      lang === "ar" ? (r.new_company_name_ar ?? "") : (r.new_company_name_en ?? "")
                    }
                    methodLabel={methodLabel(r.join_method)}
                  >
                    <input
                      placeholder={t("classifySector")}
                      value={sectorById[r.id] ?? ""}
                      onChange={(e) => setSectorById((s) => ({ ...s, [r.id]: e.target.value }))}
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
                    />
                    <input
                      placeholder={t("companySlug")}
                      value={slugById[r.id] ?? slugify(r.new_company_name_en ?? "")}
                      onChange={(e) => setSlugById((s) => ({ ...s, [r.id]: e.target.value }))}
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono focus:border-[var(--gold-deep)] focus:outline-none"
                      dir="ltr"
                    />
                    <div className="mt-1 flex gap-2">
                      <ActionButton
                        variant="approve"
                        disabled={approve.isPending || !sectorById[r.id]}
                        onClick={() => approve.mutate(r)}
                      >
                        {t("approve")}
                      </ActionButton>
                      <ActionButton
                        variant="reject"
                        disabled={reject.isPending}
                        onClick={() => reject.mutate(r.id)}
                      >
                        {t("reject")}
                      </ActionButton>
                    </div>
                  </RequestCard>
                ))}
              </div>
            </section>
          )}

          {joinRows.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--gold-deep)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
                {t("joinCompanyRequest")}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {joinRows.map((r) => (
                  <RequestCard
                    key={r.id}
                    row={r}
                    lang={lang}
                    t={t}
                    initials={initials(r.full_name)}
                    subtitle={
                      lang === "ar" ? (r.companies?.name_ar ?? "") : (r.companies?.name_en ?? "")
                    }
                    methodLabel={methodLabel(r.join_method)}
                  >
                    <select
                      value={roleById[r.id] ?? "viewer"}
                      onChange={(e) => setRoleById((s) => ({ ...s, [r.id]: e.target.value }))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 flex gap-2">
                      <ActionButton
                        variant="approve"
                        disabled={approve.isPending}
                        onClick={() => approve.mutate(r)}
                      >
                        {t("approve")}
                      </ActionButton>
                      <ActionButton
                        variant="reject"
                        disabled={reject.isPending}
                        onClick={() => reject.mutate(r.id)}
                      >
                        {t("reject")}
                      </ActionButton>
                    </div>
                  </RequestCard>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}

function RequestCard({
  row,
  lang,
  t,
  initials,
  subtitle,
  methodLabel,
  children,
}: {
  row: Row;
  lang: string;
  t: ReturnType<typeof useI18n>["t"];
  initials: string;
  subtitle: string;
  methodLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/60 bg-card p-4 shadow-sm transition hover:border-[var(--gold)]/50 hover:shadow-md">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px hairline-gold opacity-0 transition group-hover:opacity-100"
      />
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full gold-gradient text-xs font-bold text-ink">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">{row.full_name}</div>
            <div className="truncate text-xs text-muted-foreground" dir="ltr">
              {row.email}
            </div>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--gold-deep)]">
          {methodLabel}
        </span>
      </div>

      {subtitle && (
        <div className="mb-3 flex items-center gap-1.5 truncate text-xs text-ink-soft">
          <span className="h-1 w-1 rounded-full bg-muted-foreground" />
          {subtitle}
        </div>
      )}

      <div className="mb-1 flex flex-col gap-2">{children}</div>

      <div className="mt-2 text-[10px] text-muted-foreground">
        {new Date(row.created_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}
      </div>
    </div>
  );
}

function ActionButton({
  variant,
  disabled,
  onClick,
  children,
}: {
  variant: "approve" | "reject";
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls =
    variant === "approve"
      ? "border-[var(--bull)]/40 bg-[var(--bull)]/10 text-[var(--bull)] hover:bg-[var(--bull)]/15"
      : "border-[var(--bear)]/40 bg-[var(--bear)]/10 text-[var(--bear)] hover:bg-[var(--bear)]/15";
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`flex-1 rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}
