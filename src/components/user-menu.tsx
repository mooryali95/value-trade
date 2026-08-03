import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Briefcase, Waves } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SessionUser = { id: string; email: string | null; name: string | null; avatarUrl: string | null };

export function UserMenu() {
  const { t } = useI18n();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { reduced, toggle } = useReducedMotion();

  useEffect(() => {
    let mounted = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return;
      const u = session?.user;
      setUser(
        u
          ? {
              id: u.id,
              email: u.email ?? null,
              name: (u.user_metadata?.full_name as string | undefined) ?? (u.user_metadata?.name as string | undefined) ?? null,
              avatarUrl: (u.user_metadata?.avatar_url as string | undefined) ?? null,
            }
          : null,
      );
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const u = data.session?.user;
      setUser(
        u
          ? {
              id: u.id,
              email: u.email ?? null,
              name: (u.user_metadata?.full_name as string | undefined) ?? (u.user_metadata?.name as string | undefined) ?? null,
              avatarUrl: (u.user_metadata?.avatar_url as string | undefined) ?? null,
            }
          : null,
      );
      setReady(true);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!ready) {
    return <div className="h-11 w-20 rounded-md bg-secondary/60" aria-hidden />;
  }

  if (!user) {
    return (
      <Link
        to="/auth"
        className="inline-flex min-h-11 items-center rounded-md gold-gradient px-3.5 text-xs font-semibold text-ink shadow-sm transition hover:brightness-105"
      >
        {t("signin")}
      </Link>
    );
  }

  const initial = (user.name || user.email || "U").trim().charAt(0).toUpperCase();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-1 pe-3 text-xs font-medium text-foreground/85 shadow-sm outline-none transition hover:border-primary/60"
        aria-label={t("myAccount")}
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
        ) : (
          <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full gold-gradient text-[10px] font-bold text-ink">
            {initial}
          </span>
        )}
        <span className="hidden max-w-[100px] truncate sm:inline">{user.name || user.email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="pb-1">
          <span className="block truncate text-xs font-semibold text-ink">{user.name || t("account")}</span>
          <span className="mt-0.5 block truncate text-caption font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/workspace" className="flex min-h-9 items-center gap-2 text-xs">
            <Briefcase aria-hidden className="h-3.5 w-3.5 text-[var(--gold-deep)]" />
            {t("nav_workspace")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            toggle();
          }}
          className="flex min-h-9 items-center gap-2 text-xs"
          aria-pressed={reduced}
        >
          <Waves aria-hidden className="h-3.5 w-3.5 text-[var(--gold-deep)]" />
          <span className="flex-1">{t("reduceMotion")}</span>
          <span className="text-caption text-muted-foreground">
            {reduced ? t("motionReduced") : t("motionEnabled")}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void handleSignOut()}
          className="flex min-h-9 items-center gap-2 text-xs text-[var(--bear)] focus:text-[var(--bear)]"
        >
          <LogOut aria-hidden className="h-3.5 w-3.5" />
          {t("signout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}