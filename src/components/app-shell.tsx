import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { List, X } from "@phosphor-icons/react";
import {
  HouseLine,
  ChartLine,
  Storefront,
  Buildings,
  ShieldCheck,
  Vault,
  Briefcase,
  EnvelopeSimple,
  CaretDown,
  Bell,
  Gear,
} from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n";
import { MARKET_STATS, BRANDS } from "@/lib/mock-data";
import { UserMenu } from "@/components/user-menu";
import { BrandMark, ValueDots } from "@/components/brand-mark";
import { CompanySwitcher } from "@/components/company-switcher";
import { useMyRoles } from "@/hooks/use-my-roles";
import { CommandPalette } from "@/components/command-palette";
import { MagnifyingGlass } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <button
      onClick={() => setLang(lang === "ar" ? "en" : "ar")}
      className="rounded-md border border-border bg-card px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft transition hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)]"
    >
      {lang === "ar" ? "EN" : "عربي"}
    </button>
  );
}

function CommandTrigger() {
  const { t } = useI18n();
  const dispatch = () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
    );
  };
  return (
    <button
      onClick={dispatch}
      title={t("shell_quickSearch")}
      aria-label={t("shell_quickSearch")}
      className="hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft transition hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)] md:inline-flex"
    >
      <MagnifyingGlass size={12} weight="bold" />
      {t("shell_search")}
      <kbd className="rounded border border-border bg-background px-1 text-[9px] font-mono">⌘K</kbd>
    </button>
  );
}

function MarketPill() {
  const { t } = useI18n();
  return (
    <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1 md:flex">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--bull)] opacity-40" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--bull)]" />
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
        {MARKET_STATS.isOpen ? t("liveMarket") : t("closed")}
      </span>
    </div>
  );
}

function NavGroup({
  label,
  icon: Icon,
  items,
  active,
  isActive,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number; weight?: "regular" | "duotone" | "bold" }>;
  items: { to: string; label: string; icon: React.ComponentType<{ size?: number; weight?: "regular" | "duotone" }> }[];
  active: boolean;
  isActive: (p: string) => boolean;
}) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition outline-none ${
          active
            ? "bg-[var(--gold-soft)] text-[var(--gold-deep)]"
            : "text-ink-soft hover:bg-secondary/70 hover:text-ink"
        }`}
      >
        <Icon size={16} weight={active ? "duotone" : "regular"} />
        {label}
        <CaretDown size={12} weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-[200px]">
        {items.map((it) => (
          <DropdownMenuItem key={it.to} asChild>
            <Link
              to={it.to}
              className={`flex items-center gap-2 ${
                isActive(it.to) ? "text-[var(--gold-deep)]" : "text-ink"
              }`}
            >
              <it.icon size={14} weight={isActive(it.to) ? "duotone" : "regular"} />
              {it.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const { isAdmin } = useMyRoles();
  const primary = [
    { to: "/", label: t("nav_home"), icon: HouseLine },
    { to: "/market", label: t("nav_market"), icon: Storefront },
    { to: `/trade/${BRANDS[0].slug}`, label: t("nav_trade"), icon: ChartLine },
    { to: "/portfolio", label: t("portfolio"), icon: Vault },
    { to: "/shariah", label: t("nav_shariah"), icon: ShieldCheck },
  ];

  const companyGroup = [
    { to: "/company/settings", label: t("company"), icon: Briefcase },
    { to: "/invitations", label: t("invitations"), icon: EnvelopeSimple },
    { to: "/workspace", label: t("nav_workspace"), icon: Buildings },
  ];

  const accountGroup = [
    { to: "/settings/notifications", label: "الإشعارات", icon: Bell },
    ...(isAdmin
      ? [{ to: "/admin/email-log", label: "سجل الإرسال", icon: EnvelopeSimple }]
      : []),
  ];

  const allNav = [...primary, ...companyGroup, ...accountGroup];

  const isActive = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p.split("/").slice(0, 2).join("/")));
  const groupActive = (items: { to: string }[]) => items.some((i) => isActive(i.to));

  return (
    <div dir={dir} className="min-h-dvh bg-background text-foreground">
      {/* Top header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto grid max-w-[1600px] grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-md border border-border p-2 text-ink-soft lg:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="menu"
            >
              {open ? <X size={16} weight="bold" /> : <List size={16} weight="bold" />}
            </button>
            <Link to="/" className="flex items-center">
              <BrandMark size={36} />
            </Link>
          </div>

          <nav className="hidden items-center justify-center gap-0.5 lg:flex">
            {primary.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition ${
                  isActive(n.to)
                    ? "bg-[var(--gold-soft)] text-[var(--gold-deep)]"
                    : "text-ink-soft hover:bg-secondary/70 hover:text-ink"
                }`}
              >
                <n.icon size={16} weight={isActive(n.to) ? "duotone" : "regular"} />
                {n.label}
              </Link>
            ))}

            <NavGroup
              label={t("company")}
              icon={Briefcase}
              items={companyGroup}
              active={groupActive(companyGroup)}
              isActive={isActive}
            />
            <NavGroup
              label={"الإعدادات"}
              icon={Gear}
              items={accountGroup}
              active={groupActive(accountGroup)}
              isActive={isActive}
            />
          </nav>

          <div className="flex items-center gap-2">
            <MarketPill />
            <CommandTrigger />
            <CompanySwitcher />
            <LangToggle />
            <UserMenu />
          </div>
        </div>

        {/* Mobile nav */}
        {open && (
          <div className="border-t border-border/60 bg-card lg:hidden">
            <div className="flex flex-col p-2">
              {allNav.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm ${
                    isActive(n.to) ? "bg-[var(--gold-soft)] text-[var(--gold-deep)]" : "text-ink-soft"
                  }`}
                >
                  <n.icon size={16} weight={isActive(n.to) ? "duotone" : "regular"} />
                  {n.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-6">{children}</main>

      <footer className="mt-16 border-t border-border/60 bg-stone">
        <div className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-6 text-xs text-muted-foreground md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <ValueDots size={20} />
            <span className="truncate">© {new Date().getFullYear()} {t("brand")} — {t("footerRights")}. {t("disclaimer")}.</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link to="/shariah" className="hover:text-[var(--gold-deep)]">{t("nav_shariah")}</Link>
            <Link to="/legal/terms" className="hover:text-[var(--gold-deep)]">{t("legalTerms")}</Link>
            <Link to="/legal/privacy" className="hover:text-[var(--gold-deep)]">{t("legalPrivacy")}</Link>
            <Link to="/legal/shariah-disclosures" className="hover:text-[var(--gold-deep)]">{t("legalShariahDisclosures")}</Link>
            <Link to="/legal/cookies" className="hover:text-[var(--gold-deep)]">{t("legalCookies")}</Link>
          </div>
        </div>
      </footer>
      <CommandPalette />
    </div>
  );
}