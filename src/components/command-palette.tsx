import { useEffect, useMemo, useState } from "react";
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
import { useI18n } from "@/lib/i18n";
import { BRANDS } from "@/lib/mock-data";
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
} from "@phosphor-icons/react";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t, lang } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      { path: "/settings/notifications", label: lang === "ar" ? "الإشعارات" : "Notifications", icon: Bell },
    ],
    [t, lang],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={lang === "ar" ? "ابحث عن صفحة أو رمز…" : "Search page or symbol…"} />
      <CommandList>
        <CommandEmpty>{t("emptyTitle")}</CommandEmpty>
        <CommandGroup heading={lang === "ar" ? "الصفحات" : "Pages"}>
          {routes.map((r) => (
            <CommandItem key={r.path} value={`${r.label} ${r.path}`} onSelect={() => go(r.path)}>
              <r.icon size={14} weight="duotone" />
              <span>{r.label}</span>
              <span className="ms-auto text-[10px] uppercase text-muted-foreground">{r.path}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={lang === "ar" ? "الأدوات" : "Instruments"}>
          {BRANDS.slice(0, 40).map((b) => (
            <CommandItem
              key={b.id}
              value={`${b.symbol} ${b.nameEn} ${b.nameAr}`}
              onSelect={() => go(`/trade/${b.slug}`)}
            >
              <span className="font-mono text-[11px] text-[var(--gold-deep)]">{b.symbol}</span>
              <span className="truncate">{lang === "ar" ? b.nameAr : b.nameEn}</span>
              <span className="ms-auto text-[10px] uppercase text-muted-foreground">{b.sector}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}