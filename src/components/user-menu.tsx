import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Briefcase, Mail, KeyRound } from "lucide-react";
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
import { clearPostAuthRedirect, consumePostAuthRedirect } from "@/lib/security/redirect";

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
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      // A recovery link that landed on another page (e.g. the site root when
      // the redirect URL was not allow-listed) still has to set a password.
      if (event === "PASSWORD_RECOVERY" && window.location.pathname !== "/auth/update-password") {
        navigate({ to: "/auth/update-password", search: { flow: "recovery" }, replace: true });
      } else if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        // Back from Google sign-in: continue where the user started
        // (e.g. an invitation page). The client may have read the tokens
        // from the URL before this menu subscribed, in which case only
        // INITIAL_SESSION arrives. Consumed once; stale entries expire.
        const next = consumePostAuthRedirect();
        if (next && next !== `${window.location.pathname}${window.location.search}`) {
          navigate({ href: next, replace: true });
        }
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return <div className="h-8 w-20 rounded-md bg-secondary/60" aria-hidden />;
  }

  if (!user) {
    return (
      <Link
        to="/auth"
        className="inline-flex min-h-10 items-center rounded-md gold-gradient px-3.5 py-1.5 text-xs font-semibold text-ink shadow-sm transition hover:brightness-105"
      >
        {t("signin")}
      </Link>
    );
  }

  const initial = (user.name || user.email || "U").trim().charAt(0).toUpperCase();

  async function handleSignOut() {
    clearPostAuthRedirect();
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
          <span dir="ltr" className="truncate text-start text-[10px] font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/workspace" className="flex items-center gap-2 text-xs">
            <Briefcase className="h-3.5 w-3.5 text-[var(--gold-deep)]" aria-hidden />
            {t("nav_workspace")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/invitations" className="flex items-center gap-2 text-xs">
            <Mail className="h-3.5 w-3.5 text-[var(--gold-deep)]" aria-hidden />
            {t("incomingInvitations")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/auth/update-password" className="flex items-center gap-2 text-xs">
            <KeyRound className="h-3.5 w-3.5 text-[var(--gold-deep)]" aria-hidden />
            {t("r_menuChangePassword")}
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