import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { LuxurySkeleton } from "@/components/luxury-skeleton";
import { AccessDenied } from "@/components/access-denied";
import { useI18n } from "@/lib/i18n";
import { useActiveCompany } from "@/hooks/use-active-company";
import { useMyRoles } from "@/hooks/use-my-roles";
import { listMyCompanies } from "@/lib/tenants/company.functions";
import { submitProduct } from "@/lib/submissions/submissions.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/company/submit")({
  validateSearch: (s: Record<string, unknown>) =>
    z.object({ companyId: z.string().uuid().optional() }).parse(s),
  head: () => ({
    meta: [
      { title: "طرح منتج — قيمة" },
      { name: "description", content: "قدّم منتج شركتك للاعتماد الشرعي والنشر في السوق." },
    ],
  }),
  errorComponent: ({ reset }) => (<AppShell><div className="py-16"><ErrorState reset={reset} /></div></AppShell>),
  component: SubmitPage,
});

function SubmitPage() {
  const { t, lang } = useI18n();
  const { companyId } = Route.useSearch();
  const navigate = useNavigate();
  const listFn = useServerFn(listMyCompanies);
  const submitFn = useServerFn(submitProduct);
  const list = useQuery({ queryKey: ["my-companies"], queryFn: () => listFn() });
  const { activeId } = useActiveCompany();
  const { companyRole, isLoading: rolesLoading } = useMyRoles();

  const [form, setForm] = useState({
    companyId: companyId ?? activeId ?? "",
    asset_class: "stock" as "stock" | "sukuk" | "brand",
    symbol: "",
    name_ar: "",
    name_en: "",
    sector: "",
    prospectus_url: "",
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
      navigate({ to: "/company/submissions", search: { companyId: form.companyId } });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("companies")}
        title={t("submitProductForm")}
        crumbs={[{ label: t("companies"), to: "/company/settings" }, { label: t("submitProductForm") }]}
      />

      {list.isLoading ? (
        <LuxurySkeleton lines={4} />
      ) : (
        <div className="mx-auto max-w-2xl space-y-3 rounded-xl border border-border/60 bg-card p-6">
          <Field label={t("company")}>
            <select value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              <option value="">—</option>
              {(list.data ?? []).map((m) => (
                <option key={m.company.id} value={m.company.id}>{lang === "ar" ? m.company.name_ar : m.company.name_en}</option>
              ))}
            </select>
          </Field>
          <Field label={t("orderType")}>
            <select value={form.asset_class} onChange={(e) => setForm({ ...form, asset_class: e.target.value as never })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              <option value="stock">{t("stocks")}</option>
              <option value="sukuk">{t("sukukAll")}</option>
              <option value="brand">{t("brands")}</option>
            </select>
          </Field>
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
            <input value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </Field>
          <Field label={t("prospectusUrl")}>
            <input type="url" value={form.prospectus_url} onChange={(e) => setForm({ ...form, prospectus_url: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="https://..." />
          </Field>
          <button
            disabled={mutation.isPending || !form.companyId || !form.symbol || !form.name_ar || !form.name_en}
            onClick={() => mutation.mutate()}
            className="mt-2 w-full rounded-md gold-gradient px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {t("submitProduct")}
          </button>
        </div>
      )}
    </AppShell>
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