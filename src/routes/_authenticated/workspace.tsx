import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { PageHeader, HeaderAction } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { BRANDS, getCompanyBrands } from "@/lib/mock-data";
import { formatCurrency, formatPct, formatInt } from "@/lib/format";
import { Building2, Users, TrendingUp, Plus, Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/workspace")({
  head: () => ({
    meta: [
      { title: "منصة الشركة — وحدة القيمة | Workspace — Value Unit" },
      { name: "description", content: "منصة تداول داخلية للشركات المستأجرة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
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
      <PageHeader
        eyebrow={`${company.plan} · Tenant`}
        title={lang === "ar" ? company.nameAr : company.nameEn}
        crumbs={[{ label: t("companies"), to: "/company/settings" }, { label: t("ws_workspace") }]}
        actions={
          <HeaderAction variant="primary">
            <Plus className="h-3.5 w-3.5" /> {t("ws_addBrand")}
          </HeaderAction>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <KPI label={t("brandsCount")} value={String(brands.length)} icon={Building2} />
        <KPI label={t("marketCap")} value={formatCurrency(totalCap, true, lang)} icon={TrendingUp} />
        <KPI label={t("volume24h")} value={formatInt(totalVol, true)} icon={TrendingUp} />
        <KPI label={t("members")} value={String(company.members)} icon={Users} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">{t("companyBrands")}</h2>
            <button className="text-xs text-primary hover:underline">{t("ws_inviteBrandManager")} →</button>
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
            <h3 className="mb-3 text-sm font-semibold text-foreground">{t("ws_inviteBrandManager")}</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("ws_inviteDesc")}
            </p>
            <input placeholder="brand@company.com" className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-xs focus:border-primary/50 focus:outline-none" />
            <button className="inline-flex w-full items-center justify-center gap-2 rounded-md gold-gradient py-2 text-xs font-semibold text-[oklch(0.16_0.04_260)]">
              <Send className="h-3.5 w-3.5" /> {t("ws_sendInvite")}
            </button>
          </div>

          <div className="rounded-xl border border-border/60 bg-card/60 p-5">
            <h3 className="mb-3 text-sm font-semibold text-foreground">{t("ws_publishPublic")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("ws_publishDesc")}
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