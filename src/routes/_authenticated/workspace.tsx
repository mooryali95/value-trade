import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";
import { BRANDS, getCompanyBrands } from "@/lib/mock-data";
import { formatCurrency, formatPct, formatInt } from "@/lib/format";
import { Building2, Users, TrendingUp, Plus, Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/workspace")({
  head: () => ({
    meta: [
      { title: "منصة الشركة — قيمة | Workspace — Value Unit" },
      { name: "description", content: "منصة تداول داخلية للشركات المستأجرة." },
    ],
  }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const { t, lang } = useI18n();
  const company = { id: "co-mada", nameAr: "مدى للاستثمار", nameEn: "Mada Investments", plan: "Enterprise", established: 2018, members: 34 };
  const brands = getCompanyBrands(company.id);
  const totalCap = brands.reduce((s, b) => s + b.marketCap, 0);
  const totalVol = brands.reduce((s, b) => s + b.volume24h, 0);

  return (
    <AppShell>
      <header className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl gold-gradient text-lg font-bold text-[oklch(0.16_0.04_260)]">
            <Building2 className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-primary">{company.plan} · Tenant</div>
            <h1 className="truncate text-xl font-bold text-foreground md:text-2xl">{lang === "ar" ? company.nameAr : company.nameEn}</h1>
          </div>
        </div>
        <button className="hidden rounded-md gold-gradient px-4 py-2 text-xs font-semibold text-[oklch(0.16_0.04_260)] sm:inline-flex sm:items-center sm:gap-2">
          <Plus className="h-3.5 w-3.5" /> {lang === "ar" ? "إضافة براند" : "Add brand"}
        </button>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <KPI label={t("brandsCount")} value={String(brands.length)} icon={Building2} />
        <KPI label={t("marketCap")} value={formatCurrency(totalCap, true, lang)} icon={TrendingUp} />
        <KPI label={t("volume24h")} value={formatInt(totalVol, true)} icon={TrendingUp} />
        <KPI label={t("members")} value={String(company.members)} icon={Users} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">{lang === "ar" ? "براندات الشركة" : "Company brands"}</h2>
            <button className="text-xs text-primary hover:underline">{lang === "ar" ? "دعوة مسؤول براند" : "Invite brand manager"} →</button>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
            {brands.map((b) => (
              <div key={b.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[10px] font-bold text-ivory" style={{ background: b.color }}>{b.symbol.slice(0,3)}</div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{lang === "ar" ? b.nameAr : b.nameEn}</div>
                    <div className="text-[10px] text-muted-foreground">{b.symbol} · {b.sector}</div>
                  </div>
                </div>
                <div className="font-mono text-xs text-foreground">{b.price.toFixed(2)}</div>
                <div className={`hidden font-mono text-xs sm:block ${b.change24h >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{formatPct(b.change24h)}</div>
                <Link to="/market/$slug" params={{ slug: b.slug }} className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-primary">
                  {t("overview")}
                </Link>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-card/60 p-5">
            <h3 className="mb-3 text-sm font-semibold text-foreground">{lang === "ar" ? "دعوة مسؤول براند" : "Invite brand manager"}</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {lang === "ar" ? "أرسل رابط دعوة للمسؤول المالي ليكمل ملف البراند وطرح الاكتتاب." : "Send an invite link so the brand manager can complete the profile and launch an offering."}
            </p>
            <input placeholder="brand@company.com" className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-xs focus:border-primary/50 focus:outline-none" />
            <button className="inline-flex w-full items-center justify-center gap-2 rounded-md gold-gradient py-2 text-xs font-semibold text-[oklch(0.16_0.04_260)]">
              <Send className="h-3.5 w-3.5" /> {lang === "ar" ? "إرسال دعوة" : "Send invite"}
            </button>
          </div>

          <div className="rounded-xl border border-border/60 bg-card/60 p-5">
            <h3 className="mb-3 text-sm font-semibold text-foreground">{lang === "ar" ? "الطرح للسوق العام" : "Publish to public market"}</h3>
            <p className="text-xs text-muted-foreground">
              {lang === "ar" ? "بعد الموافقة الشرعية، يمكن ترقية البراند للسوق العام في قيمة." : "After Shariah approval, brands can be promoted to Value Unit public market."}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded border border-border/50 bg-secondary/30 py-2">
                <div className="text-lg font-bold text-foreground">{brands.filter((b) => b.shariah === "halal").length}</div>
                <div className="text-[10px] text-muted-foreground">{t("halal")}</div>
              </div>
              <div className="rounded border border-border/50 bg-secondary/30 py-2">
                <div className="text-lg font-bold text-foreground">{brands.filter((b) => b.shariah !== "halal").length}</div>
                <div className="text-[10px] text-muted-foreground">{t("reviewing")}</div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function KPI({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="font-mono text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}