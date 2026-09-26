import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { AccessDenied } from "@/components/access-denied";
import { useI18n, type Key } from "@/lib/i18n";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useActiveCompany } from "@/hooks/use-active-company";
import { useMyRoles } from "@/hooks/use-my-roles";
import { listMyCompanies } from "@/lib/tenants/company.functions";
import { submitProduct } from "@/lib/submissions/submissions.functions";
import { LifecycleSteps } from "@/lib/submissions/lifecycle";
import { SECTORS, sectorLabel } from "@/components/market-data";
import { toast } from "sonner";

const ASSET_LABEL: Record<string, Key> = { stock: "g_assetStock", sukuk: "g_assetSukuk", brand: "g_assetBrand" };

export const Route = createFileRoute("/_authenticated/company/submit")({
  validateSearch: (s: Record<string, unknown>) =>
    z.object({ companyId: z.string().uuid().optional() }).parse(s),
  head: () => ({
    meta: [
      { title: "تقديم طلب إدراج — وحدة القيمة | Submit for listing — Value Unit" },
      { name: "description", content: "قدّم منتج شركتك للمراجعة الشرعية ثم الإدراج في السوق." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: SubmitPage,
});

function SubmitPage() {
  const { t, lang } = useI18n();
  const errorMessage = useErrorMessage();
  const { companyId } = Route.useSearch();
  const navigate = useNavigate();
  const listFn = useServerFn(listMyCompanies);
  const submitFn = useServerFn(submitProduct);
  const list = useQuery({ queryKey: ["my-companies"], queryFn: () => listFn() });
  const { activeId } = useActiveCompany();
  const { companyRole, isLoading: rolesLoading } = useMyRoles();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    companyId: companyId ?? activeId ?? "",
    // The market lists brand units only (Terms of use); the database refuses
    // any other asset class (ASSET_CLASS_NOT_SUPPORTED).
    asset_class: "brand" as const,
    symbol: "",
    name_ar: "",
    name_en: "",
    sector: "",
    prospectus_url: "",
  });

  const mutation = useMutation({
    mutationFn: () => submitFn({
      data: {
        companyId: form.companyId,
        asset_class: form.asset_class,
        symbol: form.symbol.toUpperCase(),
        name_ar: form.name_ar,
        name_en: form.name_en,
        sector: form.sector || undefined,
        prospectus_url: form.prospectus_url || undefined,
      },
    }),
    onSuccess: () => {
      toast.success(t("submissionSubmitted"));
      navigate({ to: "/company/submissions", search: { companyId: form.companyId, q: "", status: "all", asset: "all", sortBy: "submitted", sortDir: "desc", page: 1, pageSize: 25 } });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const targetCompanyId = form.companyId || companyId || activeId || "";
  const role = targetCompanyId ? companyRole(targetCompanyId) : undefined;
  const canSubmit = role === "owner" || role === "finance";

  if (!rolesLoading && targetCompanyId && !canSubmit) {
    return (
      <AppShell>
        <div className="py-16"><AccessDenied /></div>
      </AppShell>
    );
  }

  const stepTitles = [t("wizardStepCompany"), t("wizardStepDetails"), t("wizardReview")];
  const step1Ok = Boolean(form.companyId);
  const step2Ok = Boolean(form.symbol && form.name_ar && form.name_en);
  const companyName = (list.data ?? []).find((m) => m.company.id === form.companyId)?.company;

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("companies")}
        title={t("submitProductForm")}
        crumbs={[{ label: t("companies"), to: "/company/settings" }, { label: t("submitProductForm") }]}
      />

      <LifecycleSteps compact />

      {list.isLoading ? (
        <LuxurySkeleton lines={4} />
      ) : list.isError ? (
        <div className="py-8"><ErrorState reset={() => list.refetch()} /></div>
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState title={t("g_noCompaniesTitle")} description={t("g_noCompaniesDesc")} />
      ) : (
        <div className="mx-auto max-w-2xl space-y-3 rounded-xl border border-border/60 bg-card p-6">
          <ol className="mb-2 grid grid-cols-3 gap-2">
            {stepTitles.map((label, i) => {
              const n = i + 1;
              const state = n === step ? "current" : n < step ? "done" : "todo";
              return (
                <li key={label} className="min-w-0">
                  <div
                    className={`h-1 rounded-full ${
                      state === "todo" ? "bg-border" : "bg-[var(--gold-deep)]"
                    }`}
                  />
                  <div className={`mt-1.5 truncate text-label ${state === "current" ? "text-ink" : "text-ink-soft"}`}>
                    {t("wizardStep")} {n} {t("wizardOf")} {stepTitles.length}
                  </div>
                  <div className={`truncate text-caption ${state === "current" ? "font-semibold text-ink" : "text-ink-soft"}`}>
                    {label}
                  </div>
                </li>
              );
            })}
          </ol>

          {step === 1 && (
          <>
          <Field label={t("company")}>
            <select value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              <option value="">{t("g_selectCompany")}</option>
              {(list.data ?? []).map((m) => (
                <option key={m.company.id} value={m.company.id}>{lang === "ar" ? m.company.name_ar : m.company.name_en}</option>
              ))}
            </select>
          </Field>
          <Field label={t("g_colClass")}>
            <div className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm text-ink">{t("g_assetBrand")}</div>
          </Field>
          </>
          )}

          {step === 2 && (
          <>
          <Field label={t("brandSymbol")}>
            <input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("nameAr")}>
              <input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label={t("nameEn")}>
              <input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
          </div>
          <Field label={t("sector")}>
            <select value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              <option value="">—</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>{sectorLabel(s, t)}</option>
              ))}
            </select>
          </Field>
          <Field label={t("prospectusUrl")}>
            <input type="url" value={form.prospectus_url} onChange={(e) => setForm({ ...form, prospectus_url: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="https://..." />
          </Field>
          </>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <dl className="divide-y divide-border/40 rounded-lg border border-border/60 bg-secondary/20 text-caption">
                <Row label={t("company")} value={companyName ? (lang === "ar" ? companyName.name_ar : companyName.name_en) : "—"} />
                <Row label={t("g_colClass")} value={t(ASSET_LABEL[form.asset_class])} />
                <Row label={t("brandSymbol")} value={form.symbol.toUpperCase() || "—"} />
                <Row label={t("nameAr")} value={form.name_ar || "—"} />
                <Row label={t("nameEn")} value={form.name_en || "—"} />
                <Row label={t("sector")} value={sectorLabel(form.sector, t) || "—"} />
                <Row label={t("prospectusUrl")} value={form.prospectus_url || "—"} />
              </dl>
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-caption font-semibold text-ink">{t("wizardWillHappen")}</div>
                <p className="mt-1 text-caption text-ink-soft">{t("wizardSubmitEffect")}</p>
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={step === 1}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="min-h-11 rounded-md border border-border px-4 text-sm font-semibold text-ink disabled:opacity-40"
            >
              {t("wizardBack")}
            </button>
            {step < 3 ? (
              <button
                type="button"
                disabled={step === 1 ? !step1Ok : !step2Ok}
                onClick={() => setStep((s) => Math.min(3, s + 1))}
                className="min-h-11 rounded-md gold-gradient px-4 text-sm font-semibold text-ink disabled:opacity-50"
              >
                {t("wizardNext")}
              </button>
            ) : (
              <button
                type="button"
                disabled={mutation.isPending || !step1Ok || !step2Ok}
                onClick={() => mutation.mutate()}
                className="min-h-11 rounded-md gold-gradient px-4 text-sm font-semibold text-ink disabled:opacity-50"
              >
                {t("submitProduct")}
              </button>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
      <dt className="min-w-0 truncate text-ink-soft">{label}</dt>
      <dd className="max-w-[60%] truncate font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}