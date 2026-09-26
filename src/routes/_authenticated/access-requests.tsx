import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { Badge } from "@/components/badge";
import { LiveRegion } from "@/components/live-region";
import { Num } from "@/components/num";
import { useConfirm } from "@/components/confirm-dialog";
import { useI18n, type Key } from "@/lib/i18n";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useMyRoles } from "@/hooks/use-my-roles";
import { INVITABLE_ROLES, companyRoleHintKey, companyRoleKey } from "@/lib/tenants/role-labels";
import { formatDay } from "@/lib/account/dates";
import { SECTORS, sectorLabel } from "@/components/market-data";
import {
  listAccessRequests,
  approveAccessRequest,
  rejectAccessRequest,
  listRecentAccessDecisions,
  resendInvestorInvitation,
  type AccessRequestRow,
  type ApprovalResult,
  type RecentDecision,
} from "@/lib/access/access-requests.functions";
import { resendInvitationEmail } from "@/lib/tenants/invitations.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/access-requests")({
  head: () => ({
    meta: [{ title: "طلبات الانضمام — وحدة القيمة | Access requests — Value Unit" }, { name: "robots", content: "noindex" }],
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
type InvitableRole = (typeof INVITABLE_ROLES)[number];

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

const METHOD_KEY: Record<Row["join_method"], Key> = {
  search: "methodSearch",
  link: "methodLink",
  new_company: "methodNewCompany",
  investor: "r_methodInvestor",
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function AccessRequestsPage() {
  const { t, lang } = useI18n();
  const errorMessage = useErrorMessage();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { isAdmin } = useMyRoles();
  const listFn = useServerFn(listAccessRequests);
  const approveFn = useServerFn(approveAccessRequest);
  const rejectFn = useServerFn(rejectAccessRequest);
  const [announcement, setAnnouncement] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["access-requests"],
    queryFn: () => listFn(),
  });

  const [roleById, setRoleById] = useState<Record<string, InvitableRole>>({});
  const [sectorById, setSectorById] = useState<Record<string, string>>({});
  const [slugById, setSlugById] = useState<Record<string, string>>({});
  const [rejectOpen, setRejectOpen] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const announce = (msg: string, ok = true) => {
    setAnnouncement(msg);
    if (ok) toast.success(msg);
    else toast.error(msg);
  };

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["access-requests"] });
    qc.invalidateQueries({ queryKey: ["access-decisions"] });
    qc.invalidateQueries({ queryKey: ["admin-pending-activations"] });
  };

  const approve = useMutation({
    mutationFn: (row: Row) => {
      if (row.join_method === "investor") return approveFn({ data: { requestId: row.id } });
      if (row.requested_company_id) {
        return approveFn({ data: { requestId: row.id, role: roleById[row.id] ?? "viewer" } });
      }
      return approveFn({
        data: {
          requestId: row.id,
          sector: (sectorById[row.id] ?? "").trim(),
          slug: (slugById[row.id] ?? slugify(row.new_company_name_en ?? "")).trim(),
        },
      });
    },
    onSuccess: (res: ApprovalResult) => {
      const msg =
        res.kind === "investor"
          ? res.notification.sent
            ? res.accountExists
              ? t("r_arApprovedInvestorExisting")
              : t("r_arApprovedInvestorSent")
            : t("r_arApprovedEmailFailed")
          : res.notification.sent
            ? t("r_arApprovedInviteSent")
            : t("r_arApprovedEmailFailed");
      setAnnouncement(msg);
      if (res.inviteUrl) {
        const url = res.inviteUrl;
        const show = res.notification.sent ? toast.success : toast.warning;
        show(msg, {
          action: {
            label: t("inviteCopyLink"),
            onClick: async () => {
              if (await copyText(url)) toast.success(t("inviteLinkCopied"));
            },
          },
        });
      } else if (res.notification.sent) {
        toast.success(msg);
      } else {
        toast.warning(msg);
      }
      refreshAll();
    },
    onError: (e: unknown) => announce(errorMessage(e), false),
  });

  const reject = useMutation({
    mutationFn: (v: { requestId: string; reason?: string }) => rejectFn({ data: v }),
    onSuccess: (res) => {
      announce(res.notification.sent ? t("r_arRejectedNotified") : t("r_arRejectedNotNotified"));
      setRejectOpen(null);
      setRejectNote("");
      refreshAll();
    },
    onError: (e: unknown) => announce(errorMessage(e), false),
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
          <ErrorState description={errorMessage(error)} reset={() => refetch()} />
        </div>
      </AppShell>
    );

  const rows = data ?? [];
  const investorRows = rows.filter((r) => r.join_method === "investor");
  const newCompanyRows = rows.filter((r) => r.join_method === "new_company");
  const joinRows = rows.filter((r) => r.join_method === "search" || r.join_method === "link");

  const initials = (name: string) =>
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";

  const approveInvestor = async (r: Row) => {
    const ok = await confirm({
      title: t("r_arApproveInvestorTitle"),
      description: `${r.full_name} · ${r.email} — ${t("r_arApproveInvestorDesc")}`,
      confirmLabel: t("approve"),
      cancelLabel: t("cancel"),
    });
    if (ok) approve.mutate(r);
  };

  const rejectBlock = (r: Row) =>
    rejectOpen === r.id ? (
      <div className="mt-1 space-y-2 rounded-md border border-[var(--bear)]/30 bg-[var(--bear)]/5 p-2">
        <label className="block text-[11px] text-muted-foreground">
          {t("r_arRejectNoteLabel")}
          <textarea
            value={rejectNote}
            maxLength={600}
            rows={2}
            onChange={(e) => setRejectNote(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
          />
        </label>
        <div className="flex gap-2">
          <ActionButton
            variant="reject"
            disabled={reject.isPending}
            onClick={() => reject.mutate({ requestId: r.id, reason: rejectNote.trim() || undefined })}
          >
            {t("r_arConfirmReject")}
          </ActionButton>
          <button
            type="button"
            onClick={() => {
              setRejectOpen(null);
              setRejectNote("");
            }}
            className="flex-1 rounded-md border border-border px-3 py-1.5 text-[11px] text-ink-soft"
          >
            {t("cancel")}
          </button>
        </div>
      </div>
    ) : (
      <ActionButton
        variant="reject"
        disabled={reject.isPending}
        onClick={() => {
          setRejectOpen(r.id);
          setRejectNote("");
        }}
      >
        {t("reject")}
      </ActionButton>
    );

  const cardProps = (r: Row, subtitle: string) => ({
    row: r,
    lang,
    t,
    initials: initials(r.full_name),
    subtitle,
    methodLabel: t(METHOD_KEY[r.join_method] ?? "methodSearch"),
  });

  return (
    <AppShell>
      <LiveRegion message={announcement} />
      <PageHeader
        eyebrow={isAdmin ? t("modePlatform") : t("companies")}
        title={t("accessRequestsQueue")}
        description={isAdmin ? t("r_arDescAdmin") : t("accessRequestsQueueDesc")}
        crumbs={[{ label: t("accessRequestsQueue") }]}
      />

      {/* Stat strip */}
      <div className={`mb-8 grid ${isAdmin ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"} divide-border/60 rounded-xl border border-border/60 bg-card [&>*]:px-5 [&>*]:py-4`}>
        <Stat label={t("total")} value={rows.length} />
        {isAdmin && <Stat label={t("r_arInvestorRequests")} value={investorRows.length} />}
        {isAdmin && <Stat label={t("newCompanyRequest")} value={newCompanyRows.length} />}
        <Stat label={t("joinCompanyRequest")} value={joinRows.length} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t("noAccessRequests")} description={t("r_arEmptyDesc")} />
      ) : (
        <div className="space-y-10">
          {investorRows.length > 0 && (
            <Section title={t("r_arInvestorRequests")} hint={t("r_arInvestorHint")}>
              {investorRows.map((r) => (
                <RequestCard key={r.id} {...cardProps(r, t("r_arInvestorSubtitle"))}>
                  <div className="mt-1 flex gap-2">
                    <ActionButton variant="approve" disabled={approve.isPending} onClick={() => void approveInvestor(r)}>
                      {t("approve")}
                    </ActionButton>
                    {rejectOpen !== r.id && rejectBlock(r)}
                  </div>
                  {rejectOpen === r.id && rejectBlock(r)}
                </RequestCard>
              ))}
            </Section>
          )}

          {newCompanyRows.length > 0 && (
            <Section title={t("newCompanyRequest")} hint={t("r_arNewCompanyHint")}>
              {newCompanyRows.map((r) => (
                <RequestCard
                  key={r.id}
                  {...cardProps(r, lang === "ar" ? (r.new_company_name_ar ?? "") : (r.new_company_name_en ?? ""))}
                >
                  <label className="block text-[11px] text-muted-foreground">
                    {t("classifySector")}
                    <select
                      value={sectorById[r.id] ?? ""}
                      onChange={(e) => setSectorById((s) => ({ ...s, [r.id]: e.target.value }))}
                      className="mt-1 min-h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:border-[var(--gold-deep)] focus:outline-none"
                    >
                      <option value="">—</option>
                      {SECTORS.map((sec) => (
                        <option key={sec} value={sec}>{sectorLabel(sec, t)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[11px] text-muted-foreground">
                    {t("companySlug")}
                    <input
                      value={slugById[r.id] ?? slugify(r.new_company_name_en ?? "")}
                      maxLength={48}
                      onChange={(e) => setSlugById((s) => ({ ...s, [r.id]: e.target.value.toLowerCase() }))}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs focus:border-[var(--gold-deep)] focus:outline-none"
                      dir="ltr"
                    />
                  </label>
                  <div className="mt-1 flex gap-2">
                    <ActionButton
                      variant="approve"
                      disabled={approve.isPending || !(sectorById[r.id] ?? "").trim()}
                      onClick={() => approve.mutate(r)}
                    >
                      {t("approve")}
                    </ActionButton>
                    {rejectOpen !== r.id && rejectBlock(r)}
                  </div>
                  {rejectOpen === r.id && rejectBlock(r)}
                </RequestCard>
              ))}
            </Section>
          )}

          {joinRows.length > 0 && (
            <Section title={t("joinCompanyRequest")} hint={t("r_roleTradingNote")}>
              {joinRows.map((r) => {
                const role = roleById[r.id] ?? "viewer";
                const hintKey = companyRoleHintKey(role);
                return (
                  <RequestCard
                    key={r.id}
                    {...cardProps(r, lang === "ar" ? (r.companies?.name_ar ?? "") : (r.companies?.name_en ?? ""))}
                  >
                    <label className="block text-[11px] text-muted-foreground">
                      {t("r_arRoleLabel")}
                      <select
                        value={role}
                        onChange={(e) => setRoleById((s) => ({ ...s, [r.id]: e.target.value as InvitableRole }))}
                        className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                      >
                        {INVITABLE_ROLES.map((opt) => (
                          <option key={opt} value={opt}>
                            {t(companyRoleKey(opt)!)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {hintKey && <p className="text-[11px] leading-relaxed text-muted-foreground">{t(hintKey)}</p>}
                    <div className="mt-1 flex gap-2">
                      <ActionButton variant="approve" disabled={approve.isPending} onClick={() => approve.mutate(r)}>
                        {t("approve")}
                      </ActionButton>
                      {rejectOpen !== r.id && rejectBlock(r)}
                    </div>
                    {rejectOpen === r.id && rejectBlock(r)}
                  </RequestCard>
                );
              })}
            </Section>
          )}
        </div>
      )}

      <RecentDecisions onAnnounce={announce} />
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink">
        <Num value={value} kind="qty" />
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--gold-deep)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" aria-hidden />
        {title}
      </h2>
      {hint && <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

/**
 * Approved requests of the last 60 days and what became of them: the
 * company invitation (copy link, resend, re-issue once expired) or, for
 * investors, whether the account exists and is active yet.
 */
function RecentDecisions({ onAnnounce }: { onAnnounce: (msg: string, ok?: boolean) => void }) {
  const { t, lang } = useI18n();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const listFn = useServerFn(listRecentAccessDecisions);
  const resendFn = useServerFn(resendInvitationEmail);
  const resendInvestorFn = useServerFn(resendInvestorInvitation);
  const q = useQuery({ queryKey: ["access-decisions"], queryFn: () => listFn() });

  const resend = useMutation({
    mutationFn: (v: { invitationId: string; reissue: boolean }) => resendFn({ data: v }),
    onSuccess: (res) => {
      onAnnounce(
        res.notification.sent ? (res.reissued ? t("r_inviteReissued") : t("r_inviteResent")) : t("r_inviteEmailFailed"),
        res.notification.sent,
      );
      qc.invalidateQueries({ queryKey: ["access-decisions"] });
    },
    onError: (e: unknown) => onAnnounce(errorMessage(e), false),
  });

  const resendInvestor = useMutation({
    mutationFn: (requestId: string) => resendInvestorFn({ data: { requestId } }),
    onSuccess: (res) =>
      onAnnounce(
        res.notification.sent ? (res.accountExists ? t("r_arApprovedInvestorExisting") : t("r_arApprovedInvestorSent")) : t("r_arApprovedEmailFailed"),
        res.notification.sent,
      ),
    onError: (e: unknown) => onAnnounce(errorMessage(e), false),
  });

  const rows = q.data ?? [];
  if (q.isLoading) return null;
  if (q.isError)
    return (
      <div className="mt-10">
        <ErrorState description={errorMessage(q.error)} reset={() => q.refetch()} />
      </div>
    );
  if (rows.length === 0) return null;

  const fmt = (iso: string | null) =>
    formatDay(iso, lang) || "—";

  const invBadge = (d: RecentDecision) => {
    const s = d.invitation?.status;
    if (!s) return null;
    const variant = s === "accepted" ? "bull" : s === "pending" ? "gold" : s === "expired" ? "bear" : "neutral";
    const key: Key = s === "accepted" ? "r_statusAccepted" : s === "pending" ? "r_statusAwaitingAcceptance" : s === "expired" ? "r_statusExpired" : "r_statusRevoked";
    return <Badge variant={variant}>{t(key)}</Badge>;
  };
  const investorBadge = (d: RecentDecision) => {
    if (!d.investorState) return null;
    const key: Key = d.investorState === "active" ? "r_investorStateActive" : d.investorState === "awaiting_activation" ? "r_investorStateAwaiting" : "r_investorStateNoAccount";
    return <Badge variant={d.investorState === "active" ? "bull" : "gold"}>{t(key)}</Badge>;
  };

  return (
    <section className="mt-12">
      <h2 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--gold-deep)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" aria-hidden />
        {t("r_arRecentTitle")}
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t("r_arRecentDesc")}</p>
      {/* Below md each decision is a card: applicant, outcome, status, then the actions. */}
      <div className="rounded-xl border border-border/60 bg-card">
        <table className="w-full text-sm max-md:block">
          <thead className="max-md:hidden">
            <tr className="border-b border-border/60 bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-start font-semibold">{t("r_arColApplicant")}</th>
              <th className="px-3 py-2 text-start font-semibold">{t("r_arColOutcome")}</th>
              <th className="px-3 py-2 text-start font-semibold">{t("filterStatus")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="max-md:block">
            {rows.map((d) => {
              const company = lang === "ar" ? d.companyNameAr || d.companyNameEn : d.companyNameEn || d.companyNameAr;
              const roleKey = companyRoleKey(d.invitation?.role);
              return (
                <tr key={d.id} className="border-b border-border/40 align-top last:border-0 max-md:block max-md:py-2">
                  <td className="px-3 py-2 max-md:block max-md:pb-1">
                    <div className="break-words text-xs font-semibold text-ink">{d.fullName}</div>
                    <div className="break-all text-[11px] text-muted-foreground" dir="ltr">{d.email}</div>
                    {d.referenceCode && <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{d.referenceCode}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-soft max-md:block max-md:py-1">
                    {d.joinMethod === "investor" ? t("r_methodInvestor") : company ?? "—"}
                    {roleKey && <span className="block text-[11px] text-muted-foreground">{t(roleKey)}</span>}
                    <span className="block text-[10px] text-muted-foreground">{t("r_arApprovedOn").replace("{date}", fmt(d.reviewedAt))}</span>
                  </td>
                  <td className="px-3 py-2 max-md:block max-md:py-1 [&_span]:whitespace-nowrap">
                    {invBadge(d)}
                    {investorBadge(d)}
                    {d.invitation?.status === "pending" && (
                      <div className="mt-1 text-[10px] text-muted-foreground">{t("r_inviteValidUntil").replace("{date}", fmt(d.invitation.expiresAt))}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 max-md:block max-md:pt-1">
                    <div className="flex flex-wrap justify-end gap-1.5 max-md:justify-start">
                      {d.invitation?.inviteUrl && (
                        <SmallButton
                          onClick={async () => {
                            if (await copyText(d.invitation!.inviteUrl!)) onAnnounce(t("inviteLinkCopied"));
                          }}
                        >
                          {t("inviteCopyLink")}
                        </SmallButton>
                      )}
                      {d.invitation?.status === "pending" && (
                        <SmallButton disabled={resend.isPending} onClick={() => resend.mutate({ invitationId: d.invitation!.id, reissue: false })}>
                          {t("inviteResendEmail")}
                        </SmallButton>
                      )}
                      {(d.invitation?.status === "expired" || d.invitation?.status === "pending") && (
                        <SmallButton disabled={resend.isPending} onClick={() => resend.mutate({ invitationId: d.invitation!.id, reissue: true })}>
                          {t("r_inviteReissue")}
                        </SmallButton>
                      )}
                      {d.investorState === "no_account" && (
                        <SmallButton disabled={resendInvestor.isPending} onClick={() => resendInvestor.mutate(d.id)}>
                          {t("r_arResendPlatformInvite")}
                        </SmallButton>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SmallButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-9 whitespace-nowrap rounded border border-border px-2 py-1 text-[11px] text-ink-soft hover:border-[var(--gold-deep)] disabled:opacity-50"
    >
      {children}
    </button>
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
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full gold-gradient text-xs font-bold text-ink" aria-hidden>
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">{row.full_name}</div>
            <div className="truncate text-xs text-muted-foreground" dir="ltr">
              {row.email}
            </div>
          </div>
        </div>
        <Badge variant="gold" className="shrink-0">
          {methodLabel}
        </Badge>
      </div>

      {subtitle && (
        <div className="mb-3 flex items-center gap-1.5 truncate text-xs text-ink-soft">
          <span className="h-1 w-1 rounded-full bg-muted-foreground" aria-hidden />
          {subtitle}
        </div>
      )}

      <div className="mb-1 flex flex-col gap-2">{children}</div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>
          {formatDay(row.created_at, lang === "ar" ? "ar" : "en")}
        </span>
        {row.reference_code && (
          <span className="font-mono" dir="ltr" title={t("r_raReference")}>
            {row.reference_code}
          </span>
        )}
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
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex-1 rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}
