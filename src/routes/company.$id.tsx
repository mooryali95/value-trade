import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { NotFoundBlock } from "@/components/not-found-block";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { getCompanyBrands, type Brand } from "@/lib/mock-data";
import { formatCurrency, formatPct } from "@/lib/format";
import { Building2 } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

export const Route = createFileRoute("/company/$id")({
  loader: ({ params }) => {
    const brands = getCompanyBrands(params.id);
    if (brands.length === 0) throw notFound();
    const first = brands[0];
    return { companyId: params.id, nameAr: first.companyNameAr, nameEn: first.companyNameEn, brands };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.nameAr} — وحدة القيمة` : "Company — وحدة القيمة" },
      {
        name: "description",
        content: loaderData
          ? `ملف شركة ${loaderData.nameAr} وبرانداتها المدرجة في وحدة القيمة. · ${loaderData.nameEn} issuer profile.`
          : "ملف الشركة المدرجة في وحدة القيمة. · Issuer profile on Value Unit.",
      },
      { property: "og:title", content: loaderData ? `${loaderData.nameEn} — Value Unit` : "Company — Value Unit" },
      { property: "og:description", content: "Issuer profile and listed brand units on Value Unit." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  errorComponent: ({ error, reset }) => (
    <AppShell><div className="py-16"><ErrorState reset={reset} description={String(error?.message ?? "")} /></div></AppShell>
  ),
  notFoundComponent: () => <NotFoundBlock kind="company" />,
  component: CompanyPage,
});

function CompanyPage() {
  const { nameAr, nameEn, brands } = Route.useLoaderData() as { companyId: string; nameAr: string; nameEn: string; brands: Brand[] };
  const { t, lang } = useI18n();
  const totalCap = brands.reduce((s: number, b: Brand) => s + b.marketCap, 0);

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("companyProfile")}
        title={lang === "ar" ? nameAr : nameEn}
        crumbs={[
          { label: t("marketOverview"), to: "/market" },
          { label: lang === "ar" ? nameAr : nameEn },
        ]}
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat label={t("brandsCount")} value={String(brands.length)} />
        <Stat label={t("marketCap")} value={formatCurrency(totalCap, true, lang)} />
        <Stat label={t("established")} value="2018" />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-foreground">{t("companyBrands")}</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {brands.map((b) => (
          <Link
            key={b.id}
            to="/market/$slug"
            params={{ slug: b.slug }}
            className="rounded-xl border border-border/60 bg-card/60 p-4 transition hover:border-primary/40"
          >
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-[10px] font-bold text-ivory" style={{ background: b.color }}>{b.symbol.slice(0,3)}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{lang === "ar" ? b.nameAr : b.nameEn}</div>
                <div className="text-[10px] text-muted-foreground">{b.symbol} · {b.sector}</div>
              </div>
              <div className="text-end">
                <div className="font-mono text-sm text-foreground">{b.price.toFixed(2)}</div>
                <div className={`font-mono text-[10px] ${b.change24h >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{formatPct(b.change24h)}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}