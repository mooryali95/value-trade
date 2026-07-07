import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Menu, X, TrendingUp, LayoutGrid, Briefcase, ScrollText, Home } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { MARKET_STATS } from "@/lib/mock-data";
import { UserMenu } from "@/components/user-menu";
import valueLogo from "@/assets/value-logo.png.asset.json";

function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <div
      className="relative flex items-center justify-center overflow-hidden rounded-md"
      style={{
        width: size,
        height: size,
        boxShadow: "0 0 0 1px oklch(0.38 0.11 20 / 0.35), 0 2px 8px oklch(0.22 0.05 258 / 0.08)",
      }}
    >
      <img src={valueLogo.url} alt="Value" width={size} height={size} className="h-full w-full object-cover" />
    </div>
  );
}

function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <button
      onClick={() => setLang(lang === "ar" ? "en" : "ar")}
      className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 shadow-sm transition hover:border-primary/60 hover:text-[var(--gold-deep)]"
    >
      {lang === "ar" ? "EN" : "عربي"}
    </button>
  );
}

function MarketPill() {
  const { t } = useI18n();
  return (
    <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1 shadow-sm md:flex">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--bull)] opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--bull)]" />
      </span>
      <span className="text-xs font-medium text-foreground/70">
        {MARKET_STATS.isOpen ? t("liveMarket") : t("closed")}
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const nav = [
    { to: "/", label: t("nav_home"), icon: Home },
    { to: "/market", label: t("nav_market"), icon: LayoutGrid },
    { to: "/trade/noor001", label: t("nav_trade"), icon: TrendingUp },
    { to: "/workspace", label: t("nav_workspace"), icon: Briefcase },
    { to: "/shariah", label: t("nav_shariah"), icon: ScrollText },
  ];

  const isActive = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p.split("/").slice(0, 2).join("/")));

  return (
    <div dir={dir} className="min-h-screen bg-background text-foreground">
      {/* Top header */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto grid max-w-[1600px] grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-md border border-border p-2 lg:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="menu"
            >
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <Link to="/" className="flex items-center gap-3">
              <BrandMark size={36} />
              <div className="hidden flex-col leading-tight sm:flex">
                <span className="text-sm font-bold tracking-wide text-foreground">{t("brand")}</span>
                <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--gold-deep)]">Value Unit</span>
              </div>
            </Link>
          </div>

          <nav className="hidden items-center justify-center gap-1 lg:flex">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActive(n.to)
                    ? "bg-secondary text-[var(--gold-deep)]"
                    : "text-foreground/70 hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <MarketPill />
            <LangToggle />
            <UserMenu />
          </div>
        </div>

        {/* Mobile nav */}
        {open && (
          <div className="border-t border-border/60 bg-card lg:hidden">
            <div className="flex flex-col p-2">
              {nav.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm ${
                    isActive(n.to) ? "bg-secondary text-[var(--gold-deep)]" : "text-foreground/80"
                  }`}
                >
                  <n.icon className="h-4 w-4" />
                  {n.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-6">{children}</main>

      <footer className="mt-16 border-t border-border/70 bg-stone">
        <div className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-6 text-xs text-muted-foreground md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark size={24} />
            <span className="truncate">© {new Date().getFullYear()} {t("brand")} — {t("footerRights")}. {t("disclaimer")}.</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/shariah" className="hover:text-[var(--gold-deep)]">{t("nav_shariah")}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export { BrandMark };