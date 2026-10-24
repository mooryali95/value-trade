import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  List,
  X,
  HouseLine,
  Storefront,
  Buildings,
  ShieldCheck,
  Vault,
  Briefcase,
  EnvelopeSimple,
  CaretDown,
  Bell,
  UserPlus,
  UsersThree,
  MagnifyingGlass,
  ClipboardText,
  Scales,
  Pulse,
  Gear,
  DotsThreeCircle,
} from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { UserMenu } from "@/components/user-menu";
import { BrandMark, ValueDots } from "@/components/brand-mark";
import { CompanySwitcher } from "@/components/company-switcher";
import { ModeSwitcher } from "@/components/mode-switcher";
import { AccountStatusBanner } from "@/components/account-status-banner";
import { useMyRoles } from "@/hooks/use-my-roles";
import { useAppMode } from "@/lib/nav/app-mode";
import { CommandPalette } from "@/components/command-palette";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type IconType = React.ComponentType<{ size?: number; weight?: "regular" | "duotone" | "bold" }>;
type NavItem = { to: string; label: string; icon: IconType };

/**
 * The signed-in user's id: undefined while unknown (server render, first
 * paint), null for a visitor.
 */
export function useSessionUserId(): string | null | undefined {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setUserId(data.session?.user.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (mounted) setUserId(session?.user.id ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return userId;
}

/** Whether a Supabase session exists (null until known). */
function useSignedIn(): boolean | null {
  const userId = useSessionUserId();
  return userId === undefined ? null : userId !== null;
}

function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "ar" ? "en" : "ar")}
      aria-label={t("u_switchLanguage")}
      lang={lang === "ar" ? "en" : "ar"}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-card px-2.5 text-[12px] font-semibold text-ink-soft transition hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)] lg:min-h-9 lg:min-w-9"
    >
      {lang === "ar" ? "EN" : "عربي"}
    </button>
  );
}

function CommandTrigger() {
  const { t } = useI18n();
  const dispatch = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  };
  return (
    <>
    {/* Compact trigger below 2xl so keyboard and touch users always have a visible entry point. */}
    <button
      type="button"
      onClick={dispatch}
      title={t("shell_quickSearch")}
      aria-label={t("shell_quickSearch")}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-card text-ink-soft transition hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)] lg:min-h-9 lg:min-w-9 2xl:hidden"
    >
      <MagnifyingGlass size={15} weight="bold" aria-hidden="true" />
    </button>
    <button
      type="button"
      onClick={dispatch}
      title={t("shell_quickSearch")}
      aria-label={t("shell_quickSearch")}
      className="hidden min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-[12px] font-medium text-ink-soft transition hover:border-[var(--gold-deep)] hover:text-[var(--gold-deep)] 2xl:inline-flex"
    >
      <MagnifyingGlass size={13} weight="bold" />
      {t("shell_search")}
      <kbd className="rounded border border-border bg-background px-1 text-[10px]" dir="ltr">⌘K</kbd>
    </button>
    </>
  );
}

function NavLinkItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition ${
        active
          ? "bg-[var(--gold-soft)] text-[var(--gold-ink)]"
          : "text-ink-soft hover:bg-secondary/70 hover:text-ink"
      }`}
    >
      <item.icon size={16} weight={active ? "duotone" : "regular"} />
      {item.label}
    </Link>
  );
}

function MoreMenu({ items, isActive }: { items: NavItem[]; isActive: (p: string) => boolean }) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  const active = items.some((i) => isActive(i.to));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium outline-none transition ${
          active
            ? "bg-[var(--gold-soft)] text-[var(--gold-ink)]"
            : "text-ink-soft hover:bg-secondary/70 hover:text-ink"
        }`}
      >
        <DotsThreeCircle size={16} weight={active ? "duotone" : "regular"} />
        {t("u_navMore")}
        <CaretDown size={11} weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-[220px]">
        {items.map((it) => (
          <DropdownMenuItem key={it.to} asChild>
            <Link
              to={it.to}
              className={`flex min-h-9 items-center gap-2 ${isActive(it.to) ? "text-[var(--gold-deep)]" : "text-ink"}`}
            >
              <it.icon size={15} weight={isActive(it.to) ? "duotone" : "regular"} />
              {it.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Max links shown inline in the desktop header; the rest go under "More". */
const INLINE_MAX = 5;
const INLINE_MAX_LG = 3;

export function AppShell({
  children,
  accountBanner = true,
}: {
  children: ReactNode;
  /** false on pages that already explain the account's status in full (the signed-in home). */
  accountBanner?: boolean;
}) {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const signedIn = useSignedIn();

  const { isAdmin, isReviewer } = useMyRoles();
  const { mode } = useAppMode();

  const homeItem: NavItem = { to: "/", label: t("nav_home"), icon: HouseLine };

  const investorNav: NavItem[] = [
    homeItem,
    { to: "/market", label: t("nav_market"), icon: Storefront },
    { to: "/shariah", label: t("nav_shariah"), icon: ShieldCheck },
    ...(signedIn ? [{ to: "/portfolio", label: t("portfolio"), icon: Vault }] : []),
    ...(signedIn && isReviewer ? [{ to: "/shariah/review", label: t("shariahReview"), icon: Scales }] : []),
  ];

  const brandNav: NavItem[] = [
    homeItem,
    { to: "/workspace", label: t("nav_workspace"), icon: Buildings },
    { to: "/company/settings", label: t("company"), icon: Briefcase },
    { to: "/invitations", label: t("invitations"), icon: EnvelopeSimple },
    { to: "/access-requests", label: t("accessRequestsQueue"), icon: UserPlus },
  ];

  const platformNav: NavItem[] = [
    homeItem,
    ...(isAdmin ? [{ to: "/admin/investors", label: t("nav_investors"), icon: UsersThree }] : []),
    { to: "/access-requests", label: t("accessRequestsQueue"), icon: UserPlus },
    { to: "/admin/submissions", label: t("nav_submissions"), icon: ClipboardText },
    { to: "/admin/companies", label: t("companiesDirectory"), icon: Buildings },
    ...(isAdmin
      ? [
          { to: "/admin/email-log", label: t("nav_emailLog"), icon: EnvelopeSimple },
          { to: "/admin/health", label: t("nav_health"), icon: Pulse },
          { to: "/admin/ops", label: t("nav_ops"), icon: Gear },
        ]
      : []),
  ];

  const primary = !signedIn ? investorNav : mode === "brand" ? brandNav : mode === "platform" ? platformNav : investorNav;

  // Universal, mode-independent account items (signed-in only).
  const accountGroup: NavItem[] = signedIn
    ? [{ to: "/settings/notifications", label: t("nav_notifications"), icon: Bell }]
    : [];

  // Desktop nav: fewer inline links on narrower desktops (lg), more on wide
  // screens (xl); the rest go under "More", so the header never overflows.
  const inlineLg = primary.slice(0, INLINE_MAX_LG);
  const overflowLg = [...primary.slice(INLINE_MAX_LG), ...accountGroup];
  const inline = primary.slice(0, INLINE_MAX);
  const overflow = [...primary.slice(INLINE_MAX), ...accountGroup];

  const mobileSections = [
    {
      heading: t(
        !signedIn ? "navGroupPublic" : mode === "brand" ? "navGroupBrand" : mode === "platform" ? "navGroupPlatform" : "navGroupPublic",
      ),
      items: primary,
    },
    ...(accountGroup.length > 0 ? [{ heading: t("nav_settings"), items: accountGroup }] : []),
  ];

  const matches = (p: string) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`));
  // The most specific item wins: on /shariah/review only "Shariah review" is
  // active, not "Shariah governance" (/shariah) as well.
  const navPaths = [...primary, ...accountGroup].map((n) => n.to);
  const isActive = (p: string) =>
    matches(p) && !navPaths.some((q) => q !== p && q.startsWith(`${p}/`) && matches(q));

  return (
    <div dir={dir} className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-[70] focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-caption focus:font-semibold focus:text-ink focus:shadow-luxury"
      >
        {t("skipToContent")}
      </a>
      {/* Top header */}
      <header className="institutional-header sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-xl">
        <div
          aria-hidden
          className="h-[3px] w-full transition-colors"
          style={{
            background: mode === "platform" && signedIn ? "var(--navy)" : mode === "brand" && signedIn ? "var(--bull)" : "var(--gold)",
          }}
        />
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2.5 md:px-6">
          <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              className="grid min-h-11 min-w-11 place-items-center rounded-md border border-border text-ink-soft lg:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label={t("nav_menu")}
              aria-expanded={open}
              aria-controls="mobile-nav"
            >
              {open ? <X size={18} weight="bold" /> : <List size={18} weight="bold" />}
            </button>
            <Link to="/" className="flex min-h-11 items-center" aria-label={t("brand")}>
              <BrandMark size={34} />
            </Link>
            {/* On phones the switchers move into the menu panel, so the header fits 360px. */}
            {signedIn && (
              <div className="hidden sm:block">
                <ModeSwitcher />
              </div>
            )}
          </div>

          <nav aria-label={t("nav_primary")} className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 lg:flex xl:hidden">
            {inlineLg.map((n) => (
              <NavLinkItem key={n.to} item={n} active={isActive(n.to)} />
            ))}
            <MoreMenu items={overflowLg} isActive={isActive} />
          </nav>
          <nav aria-label={t("nav_primary")} className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 xl:flex">
            {inline.map((n) => (
              <NavLinkItem key={n.to} item={n} active={isActive(n.to)} />
            ))}
            <MoreMenu items={overflow} isActive={isActive} />
          </nav>

          <div className="ms-auto flex shrink-0 items-center gap-2 lg:ms-0">
            <CommandTrigger />
            {signedIn && mode === "brand" && (
              <div className="hidden sm:block">
                <CompanySwitcher />
              </div>
            )}
            {signedIn === false && (
              <Link
                to="/request-access"
                className="hidden min-h-9 items-center whitespace-nowrap rounded-md border border-[var(--gold)]/50 px-3 text-[12px] font-semibold text-[var(--gold-ink)] transition hover:bg-[var(--gold-soft)] md:inline-flex"
              >
                {t("requestAccess")}
              </Link>
            )}
            <LangToggle />
            <UserMenu />
          </div>
        </div>

        {/* Mobile nav */}
        {open && (
          <div id="mobile-nav" className="institutional-menu max-h-[calc(100dvh-64px)] overflow-y-auto border-t border-border/60 bg-card lg:hidden">
            <div className="flex flex-col gap-1 p-2">
              {signedIn && (
                <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-1 pb-3 pt-1 sm:hidden">
                  <ModeSwitcher />
                  {mode === "brand" && <CompanySwitcher />}
                </div>
              )}
              {mobileSections.map((section) => (
                <div key={section.heading} className="flex flex-col">
                  <div className="px-3 pb-1 pt-2 text-label text-ink-soft/70">{section.heading}</div>
                  {section.items.map((n) => (
                    <Link
                      key={n.to}
                      to={n.to}
                      onClick={() => setOpen(false)}
                      className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-body ${
                        isActive(n.to) ? "bg-[var(--gold-soft)] text-[var(--gold-ink)]" : "text-ink-soft"
                      }`}
                    >
                      <n.icon size={18} weight={isActive(n.to) ? "duotone" : "regular"} />
                      {n.label}
                    </Link>
                  ))}
                </div>
              ))}
              {signedIn === false && (
                <div className="mt-2 grid gap-2 border-t border-border/60 px-1 pt-3">
                  <Link
                    to="/request-access"
                    search={{ kind: "invest" }}
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center justify-center rounded-md gold-gradient px-3 text-body font-semibold text-ink"
                  >
                    {t("u_ctaInvestor")}
                  </Link>
                  <Link
                    to="/request-access"
                    search={{ kind: "new" }}
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-body font-semibold text-ink"
                  >
                    {t("u_ctaCompany")}
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      <main id="main-content" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-6 md:py-8">
        {accountBanner && <AccountStatusBanner />}
        {children}
      </main>

      <SiteFooter />
      <CommandPalette />
    </div>
  );
}

function FooterLink({ to, search, children }: { to: string; search?: Record<string, string>; children: ReactNode }) {
  return (
    <li>
      <Link
        to={to as never}
        search={search as never}
        className="inline-flex min-h-11 items-center text-[13px] text-ink-soft transition hover:text-[var(--gold-ink)] sm:min-h-8"
      >
        {children}
      </Link>
    </li>
  );
}

function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="mt-16 border-t border-border/60 bg-stone">
      <div className="mx-auto grid max-w-[1600px] grid-cols-2 gap-x-6 gap-y-8 px-4 py-10 md:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="col-span-2 max-w-sm lg:col-span-1">
          <BrandMark size={34} />
          <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">{t("u_footerAbout")}</p>
        </div>
        <nav aria-label={t("u_footerMarket")}>
          <h2 className="mb-2 text-[13px] font-bold text-ink">{t("u_footerMarket")}</h2>
          <ul className="sm:space-y-0.5">
            <FooterLink to="/market">{t("nav_market")}</FooterLink>
            <FooterLink to="/shariah">{t("nav_shariah")}</FooterLink>
          </ul>
        </nav>
        <nav aria-label={t("u_footerGetStarted")}>
          <h2 className="mb-2 text-[13px] font-bold text-ink">{t("u_footerGetStarted")}</h2>
          <ul className="sm:space-y-0.5">
            <FooterLink to="/request-access" search={{ kind: "invest" }}>{t("u_ctaInvestor")}</FooterLink>
            <FooterLink to="/request-access" search={{ kind: "new" }}>{t("u_ctaCompany")}</FooterLink>
            <FooterLink to="/auth">{t("u_footerMemberSignIn")}</FooterLink>
          </ul>
        </nav>
        <nav aria-label={t("u_footerLegal")} className="col-span-2 sm:col-span-1">
          <h2 className="mb-2 text-[13px] font-bold text-ink">{t("u_footerLegal")}</h2>
          <ul className="sm:space-y-0.5">
            <FooterLink to="/legal/terms">{t("legalTerms")}</FooterLink>
            <FooterLink to="/legal/risk">{t("legalRisk")}</FooterLink>
            <FooterLink to="/legal/privacy">{t("legalPrivacy")}</FooterLink>
            <FooterLink to="/legal/shariah-disclosures">{t("legalShariahDisclosures")}</FooterLink>
            <FooterLink to="/legal/cookies">{t("legalCookies")}</FooterLink>
          </ul>
        </nav>
      </div>
      <div className="border-t border-border/60">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div className="flex items-center gap-2">
            <ValueDots size={16} />
            <span>
              © <span dir="ltr">{new Date().getFullYear()}</span> {t("brand")} — {t("footerRights")}
            </span>
          </div>
          <p>{t("disclaimer")}.</p>
        </div>
      </div>
    </footer>
  );
}
