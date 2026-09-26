import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EnvelopeSimple, Hourglass, ShieldWarning, Wallet } from "@phosphor-icons/react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, type Key } from "@/lib/i18n";
import { getMyAccountStatus } from "@/lib/account/account-status.functions";
import { accountNotices } from "@/lib/account/account-notices";
import { fill } from "@/lib/account/fill";
import { Num } from "@/components/num";

type Notice = {
  id: string;
  tone: "warn" | "info";
  icon: React.ReactNode;
  text: React.ReactNode;
  link?: { to: "/invitations" | "/request-access" | "/portfolio"; label: Key };
};

/**
 * Contextual guidance for the signed-in account: unconfirmed e-mail, pending
 * company invitations, a review hold, trading not activated yet, or an
 * activated account with no funds yet. Renders nothing for visitors or when
 * nothing applies.
 */
export function AccountStatusBanner() {
  const { t } = useI18n();
  const fn = useServerFn(getMyAccountStatus);
  const [userId, setUserId] = useState<string | null>(null);

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

  const q = useQuery({
    queryKey: ["account-status", userId],
    queryFn: () => fn(),
    enabled: !!userId,
    staleTime: 60_000,
    retry: false,
  });

  if (!userId || !q.data) return null;
  const notices: Notice[] = accountNotices(q.data).map((n) => ({
    id: n.id,
    tone: n.tone,
    icon:
      n.id === "email" ? (
        <EnvelopeSimple size={16} weight="duotone" />
      ) : n.id === "hold" ? (
        <ShieldWarning size={16} weight="duotone" />
      ) : n.id === "funding" ? (
        <Wallet size={16} weight="duotone" />
      ) : n.id === "invitations" ? (
        <EnvelopeSimple size={16} weight="duotone" />
      ) : (
        <Hourglass size={16} weight="duotone" />
      ),
    text: fill(t(n.key), {
      n: <Num value={n.count ?? null} kind="qty" />,
      email: (
        <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
          {q.data.email ?? ""}
        </span>
      ),
    }),
    link:
      n.id === "invitations"
        ? { to: "/invitations", label: "r_bannerViewInvitations" }
        : n.id === "activation" && !q.data.pendingAccessRequest
          ? { to: "/request-access", label: "r_bannerRequestAccess" }
          : undefined,
  }));
  if (notices.length === 0) return null;

  return (
    <div className="mb-4 space-y-2" role="region" aria-label={t("r_bannerRegion")}>
      {notices.map((n) => (
        <div
          key={n.id}
          className={`flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
            n.tone === "warn"
              ? "border-[var(--bear)]/30 bg-[var(--bear)]/5 text-ink"
              : "border-[var(--gold)]/35 bg-[var(--gold-soft)]/50 text-ink"
          }`}
        >
          <span className={`mt-0.5 shrink-0 ${n.tone === "warn" ? "text-[var(--bear)]" : "text-[var(--gold-deep)]"}`} aria-hidden>
            {n.icon}
          </span>
          <span className="min-w-0 flex-1" dir="auto">{n.text}</span>
          {n.link && (
            <Link to={n.link.to} className="shrink-0 font-semibold text-[var(--gold-deep)] underline underline-offset-2">
              {t(n.link.label)}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
