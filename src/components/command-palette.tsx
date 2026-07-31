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
import { useI18n, pick } from "@/lib/i18n";
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
      { path: "/settings/notifications", label: t("cmd_notifications"), icon: Bell },
    ],
    [t, lang],
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
          {BRANDS.slice(0, 40).map((b) => (
            <CommandItem
              key={b.id}
              value={`${b.symbol} ${b.nameEn} ${b.nameAr}`}
              onSelect={() => go(`/trade/${b.slug}`)}
            >
              <span className="num text-caption text-[var(--gold-deep)]">{b.symbol}</span>
              <span className="truncate">{pick(lang, b.nameAr, b.nameEn)}</span>
              <span className="ms-auto text-label text-muted-foreground">{b.sector}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}