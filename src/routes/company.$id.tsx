import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";
import { BRANDS, getCompanyBrands } from "@/lib/mock-data";
import { formatCurrency, formatPct } from "@/lib/format";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/company/$id")({
  loader: ({ params }) => {
    const brands = getCompanyBrands(params.id);
    if (brands.length === 0) throw notFound();
    const first = brands[0];
    return { companyId: params.id, nameAr: first.companyNameAr, nameEn: first.companyNameEn, brands };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.nameAr} — قيمة` : "Company — قيمة" }],
  }),
  errorComponent: ({ error, reset }) => (
    <AppShell><div className="py-16 text-center"><p>{String(error)}</p><button onClick={reset}>retry</button></div></AppShell>
  ),
  notFoundComponent: () => (
    <AppShell><div className="py-16 text-center text-muted-foreground">Company not found. <Link to="/market" className="text-primary">Market</Link></div></AppShell>
  ),
  component: CompanyPage,
});

function CompanyPage() {
  const { nameAr, nameEn, brands } = Route.useLoaderData();
  const { t, lang } = useI18n();
  const totalCap = brands.reduce((s, b) => s + b.marketCap, 0);

  return (
    <AppShell>
      <header className="mb-8 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl gold-gradient text-[oklch(0.16_0.04_260)]">
            <Building2 className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("companyProfile")}</div>
            <h1 className="truncate text-2xl font-bold text-foreground md:text-3xl">{lang === "ar" ? nameAr : nameEn}</h1>
          </div>
        </div>
      </header>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat label={t("brandsCount")} value={String(brands.length)} />
        <Stat label={t("marketCap")} value={formatCurrency(totalCap, true, lang)} />
        <Stat label={t("established")} value="2018" />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-foreground">{lang === "ar" ? "براندات الشركة" : "Brands"}</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {brands.map((b) => (
          <Link
            key={b.id}
            to="/market/$slug"
            params={{ slug: b.slug }}
            className="rounded-xl border border-border/60 bg-card/60 p-4 transition hover:border-primary/40"
          >
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: b.color }}>{b.symbol.slice(0,3)}</div>
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