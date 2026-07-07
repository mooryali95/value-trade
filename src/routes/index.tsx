import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { AppShell, BrandMark } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";
import { BRANDS, MARKET_STATS } from "@/lib/mock-data";
import { formatCurrency, formatPct } from "@/lib/format";
import { ArrowRight, TrendingUp, ShieldCheck, Building2, LineChart } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { t, lang, dir } = useI18n();
  const gainers = [...BRANDS].sort((a, b) => b.change24h - a.change24h).slice(0, 6);
  const losers = [...BRANDS].sort((a, b) => a.change24h - b.change24h).slice(0, 6);

  return (
    <AppShell>
      {/* HERO */}
      <section className="relative overflow-hidden rounded-2xl border border-border/60 navy-gradient px-6 py-16 md:px-12 md:py-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(600px circle at 80% 20%, oklch(0.78 0.12 82 / 0.18), transparent), radial-gradient(500px circle at 10% 90%, oklch(0.4 0.1 260 / 0.4), transparent)",
          }}
        />
        <div className="relative grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {t("brands256")}
            </div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground md:text-6xl">
              <span className="gold-text-gradient">{t("heroHeadline")}</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              {t("heroSub")}
            </p>
            <div className={`mt-8 flex flex-wrap gap-3 ${dir === "rtl" ? "" : ""}`}>
              <Link
                to="/market"
                className="group inline-flex items-center gap-2 rounded-md gold-gradient px-5 py-3 text-sm font-semibold text-[oklch(0.16_0.04_260)] shadow-lg shadow-primary/20 transition hover:brightness-110"
              >
                {t("ctaPrimary")}
                <ArrowRight className={`h-4 w-4 transition group-hover:translate-x-1 ${dir === "rtl" ? "rotate-180 group-hover:-translate-x-1 group-hover:translate-x-0" : ""}`} />
              </Link>
              <Link
                to="/workspace"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-5 py-3 text-sm font-semibold text-foreground/90 transition hover:border-primary/50 hover:text-primary"
              >
                {t("ctaSecondary")}
              </Link>
            </div>

            <div className="mt-10 grid grid-cols-3 gap-4 border-t border-border/50 pt-6 text-start">
              <Stat label={t("activeInstruments")} value={String(MARKET_STATS.activeInstruments)} />
              <Stat label={t("totalCap")} value={formatCurrency(MARKET_STATS.totalMarketCap, true, lang)} />
              <Stat label={t("dayVolume")} value={formatCurrency(MARKET_STATS.dayVolume, true, lang)} />
            </div>
          </div>

          <HeroTicker />
        </div>
      </section>

      {/* FEATURES */}
      <section className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Feature icon={LineChart} title={t("featTitle1")} desc={t("featDesc1")} />
        <Feature icon={ShieldCheck} title={t("featTitle2")} desc={t("featDesc2")} />
        <Feature icon={Building2} title={t("featTitle3")} desc={t("featDesc3")} />
        <Feature icon={TrendingUp} title={t("featTitle4")} desc={t("featDesc4")} />
      </section>

      {/* MARKET MOVERS */}
      <section className="mt-14 grid gap-4 lg:grid-cols-2">
        <MoverCard title={t("topGainers")} rows={gainers} tone="bull" />
        <MoverCard title={t("topLosers")} rows={losers} tone="bear" />
      </section>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-foreground md:text-xl">{value}</div>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="group rounded-xl border border-border/60 bg-card/60 p-5 transition hover:border-primary/40">
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

function HeroTicker() {
  const items = BRANDS.slice(0, 8);
  const { lang } = useI18n();
  return (
    <div className="relative rounded-xl border border-border/60 bg-card/70 p-4 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="mb-3 flex items-center justify-between px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>Qeema · Live board</span>
        <span className="text-[var(--bull)]">● LIVE</span>
      </div>
      <div className="divide-y divide-border/50">
        {items.map((b) => (
          <Link
            to="/market/$slug"
            params={{ slug: b.slug }}
            key={b.id}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-2 py-2.5 text-sm transition hover:bg-secondary/40"
          >
            <div
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white"
              style={{ background: b.color }}
            >
              {b.symbol.slice(0, 3)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-foreground">{lang === "ar" ? b.nameAr : b.nameEn}</div>
              <div className="text-[10px] uppercase text-muted-foreground">{b.symbol}</div>
            </div>
            <div className="font-mono text-xs text-foreground">{b.price.toFixed(2)}</div>
            <div className={`font-mono text-xs ${b.change24h >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
              {formatPct(b.change24h)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function MoverCard({ title, rows, tone }: { title: string; rows: typeof BRANDS; tone: "bull" | "bear" }) {
  const { lang, t } = useI18n();
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Link to="/market" className="text-xs text-primary hover:underline">
          {t("exploreMarket")} →
        </Link>
      </div>
      <div className="divide-y divide-border/40">
        {rows.map((b) => (
          <Link
            key={b.id}
            to="/market/$slug"
            params={{ slug: b.slug }}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 text-sm transition hover:opacity-80"
          >
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: b.color }}>
              {b.symbol.slice(0, 3)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-foreground">{lang === "ar" ? b.nameAr : b.nameEn}</div>
              <div className="text-[10px] text-muted-foreground">{b.symbol}</div>
            </div>
            <div className="font-mono text-xs text-foreground">{b.price.toFixed(2)}</div>
            <div className={`font-mono text-xs ${tone === "bull" ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
              {formatPct(b.change24h)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
