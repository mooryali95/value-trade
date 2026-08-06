import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, User, Briefcase } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useQueryClient } from "@tanstack/react-query";

type SessionUser = { id: string; email: string | null; name: string | null; avatarUrl: string | null };

export function UserMenu() {
  const { t } = useI18n();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
    return <div className="h-8 w-20 rounded-md bg-secondary/60" aria-hidden />;
  }

  if (!user) {
    return (
      <Link
        to="/auth"
        className="inline-flex items-center rounded-md gold-gradient px-3.5 py-1.5 text-xs font-semibold text-ink shadow-sm transition hover:brightness-105"
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
    setOpen(false);
    navigate({ to: "/auth", replace: true });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-full border border-border bg-card px-1 py-1 pe-3 text-xs font-medium text-foreground/85 shadow-sm transition hover:border-primary/60"
          aria-label={t("myAccount")}
        >
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
          ) : (
            <span className="grid h-6 w-6 place-items-center rounded-full gold-gradient text-[10px] font-bold text-ink">
              {initial}
            </span>
          )}
          <span className="hidden max-w-[100px] truncate sm:inline">{user.name || user.email}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="truncate text-xs font-semibold text-ink">{user.name || t("account")}</span>
          <span className="truncate text-[10px] font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/workspace" className="flex items-center gap-2 text-xs">
            <Briefcase className="h-3.5 w-3.5 text-[var(--gold-deep)]" aria-hidden />
            {t("nav_workspace")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleSignOut()} className="text-xs text-[var(--bear)]">
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          {t("signout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}