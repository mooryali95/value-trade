import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useI18n, pick } from "@/lib/i18n";
import { useMarketOverview } from "@/components/market-data";
import {
  HouseLine,
  Storefront,
  ChartLine,
  Vault,
  ShieldCheck,
  Briefcase,
  EnvelopeSimple,
  Bell,
  Buildings,
  UsersThree,
} from "@phosphor-icons/react";
import { useMyRoles } from "@/hooks/use-my-roles";

export function CommandPalette() {
  const [open, setOpenState] = useState(false);
  const openRef = useRef(false);
  // The control that had focus when the palette opened (the header's
  // quick-search button, or wherever ⌘K was pressed). The palette has no
  // DialogTrigger, so focus is handed back to it explicitly on close.
  const returnFocus = useRef<HTMLElement | null>(null);
  const setOpen = useCallback((next: boolean) => {
    if (next === openRef.current) return;
    openRef.current = next;
    if (next) {
      const el = typeof document !== "undefined" ? document.activeElement : null;
      returnFocus.current = el instanceof HTMLElement && el !== document.body ? el : null;
    }
    setOpenState(next);
    if (!next) {
      const el = returnFocus.current;
      returnFocus.current = null;
      if (el) requestAnimationFrame(() => { if (el.isConnected) el.focus(); });
    }
  }, []);
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { isAdmin } = useMyRoles();
  // Instruments come from the public board, fetched only while the palette is open.
  const market = useMarketOverview(undefined, { enabled: open });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!openRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const go = (path: string) => {
    setOpen(false);
    navigate({ to: path });
  };

  const routes = useMemo(
    () => [
      { path: "/", label: t("nav_home"), icon: HouseLine },
      { path: "/market", label: t("nav_market"), icon: Storefront },
      { path: "/portfolio", label: t("portfolio"), icon: Vault },
      { path: "/shariah", label: t("nav_shariah"), icon: ShieldCheck },
      { path: "/workspace", label: t("nav_workspace"), icon: Buildings },
      { path: "/company/settings", label: t("companySettings"), icon: Briefcase },
      { path: "/invitations", label: t("invitations"), icon: EnvelopeSimple },
      { path: "/settings/notifications", label: t("cmd_notifications"), icon: Bell },
      ...(isAdmin ? [{ path: "/admin/investors", label: t("nav_investors"), icon: UsersThree }] : []),
    ],
    [t, isAdmin],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t("cmd_placeholder")} />
      <CommandList>
        <CommandEmpty>{t("emptyTitle")}</CommandEmpty>
        <CommandGroup heading={t("cmd_pages")}>
          {routes.map((r) => (
            <CommandItem key={r.path} value={`${r.label} ${r.path}`} onSelect={() => go(r.path)}>
              <r.icon size={14} weight="duotone" />
              <span>{r.label}</span>
              <span className="ms-auto text-label text-muted-foreground">{r.path}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("cmd_instruments")}>
          {market.isLoading ? (
            <div className="px-2 py-2 text-caption text-muted-foreground">{t("loading")}</div>
          ) : market.isError && !market.data ? (
            <div className="px-2 py-2 text-caption text-muted-foreground">{t("e2_marketDataUnavailable")}</div>
          ) : (market.data?.instruments.length ?? 0) === 0 ? (
            <div className="px-2 py-2 text-caption text-muted-foreground">{t("e2_noListingsTitle")}</div>
          ) : (
            market.data!.instruments.map((b) => (
              <CommandItem
                key={b.symbol}
                value={`${b.symbol} ${b.nameEn} ${b.nameAr}`}
                onSelect={() => go(`/market/${b.slug}`)}
              >
                <span className="num text-caption text-[var(--gold-deep)]">{b.symbol}</span>
                <span className="truncate">{pick(lang, b.nameAr, b.nameEn)}</span>
                {b.sector && <span className="ms-auto text-label text-muted-foreground">{b.sector}</span>}
              </CommandItem>
            ))
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}