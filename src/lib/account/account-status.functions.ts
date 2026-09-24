import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Where the signed-in account stands on the platform, for contextual
 * guidance (AccountStatusBanner) and onboarding screens. Read with the
 * service role for the verified user id only; nothing here is writable.
 */
export type AccountStatus = {
  userId: string;
  email: string | null;
  emailConfirmed: boolean;
  isPlatformAdmin: boolean;
  isShariahReviewer: boolean;
  /** Trading activated by a platform admin (app role "trader"). */
  isTrader: boolean;
  /** Unresolved launch review hold on the account's legacy balance. */
  onHold: boolean;
  cashBalance: number;
  /** Cash minus what the account's open buy orders reserve (as the engine computes it). */
  buyingPower: number;
  companies: Array<{ id: string; nameAr: string; nameEn: string; role: string }>;
  /** Pending, unexpired company invitations addressed to the confirmed e-mail. */
  pendingInvitations: number;
  /** The latest access request filed with this e-mail that is still pending. */
  pendingAccessRequest: { id: string; status: string; joinMethod: string } | null;
};

function money(n: unknown): number {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

export const getMyAccountStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountStatus> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadAccount } = await import("./platform-invite.server");

    const [account, rolesRes, portfolioRes, holdsRes, membersRes] = await Promise.all([
      loadAccount(userId),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
      supabaseAdmin.from("portfolios").select("cash_balance").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("launch_review_holds").select("id").eq("user_id", userId).is("resolved_at", null).limit(1),
      supabaseAdmin
        .from("company_members")
        .select("role, company_id, companies:companies!inner(id, name_ar, name_en)")
        .eq("user_id", userId),
    ]);
    for (const r of [rolesRes, portfolioRes, holdsRes, membersRes]) {
      if (r.error) {
        console.error("[account-status] lookup failed", r.error.code ?? "");
        throw new Error("INTERNAL_ERROR");
      }
    }
    if (!account) throw new Error("NOT_AUTHENTICATED");

    const roles = new Set((rolesRes.data ?? []).map((r) => String(r.role)));
    const cashBalance = money(portfolioRes.data?.cash_balance);

    // Buying power: the engine's own definition (public.buying_power) when
    // the database has it; otherwise the same formula as match_order: cash
    // minus (qty - filled_qty) * price of every open/partial priced buy.
    let buyingPower: number | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bp = await (supabaseAdmin.rpc as any)("buying_power", { _user_id: userId });
    if (!bp.error && bp.data !== null && bp.data !== undefined && Number.isFinite(Number(bp.data))) {
      buyingPower = money(bp.data);
    } else {
      const { data: open, error: openErr } = await supabaseAdmin
        .from("orders")
        .select("qty, filled_qty, price")
        .eq("user_id", userId)
        .eq("side", "buy")
        .in("status", ["open", "partial"])
        .not("price", "is", null);
      if (openErr) {
        console.error("[account-status] open orders lookup failed", openErr.code ?? "");
        throw new Error("INTERNAL_ERROR");
      }
      // Integer cents so the sum does not drift.
      let reservedCents = 0;
      for (const o of open ?? []) {
        const remaining = Number(o.qty) - Number(o.filled_qty ?? 0);
        if (remaining > 0) reservedCents += Math.round(remaining * Number(o.price) * 100);
      }
      buyingPower = money((Math.round(cashBalance * 100) - reservedCents) / 100);
    }

    const companies = (membersRes.data ?? []).map((m) => {
      const co = m.companies as unknown as { id: string; name_ar: string; name_en: string } | null;
      return { id: co?.id ?? m.company_id, nameAr: co?.name_ar ?? "", nameEn: co?.name_en ?? "", role: String(m.role) };
    });

    let pendingInvitations = 0;
    let pendingAccessRequest: AccountStatus["pendingAccessRequest"] = null;
    if (account.email) {
      const [invRes, reqRes] = await Promise.all([
        account.emailConfirmed
          ? supabaseAdmin
              .from("company_invitations")
              .select("id", { count: "exact", head: true })
              .eq("email", account.email)
              .eq("status", "pending")
              .gt("expires_at", new Date().toISOString())
          : Promise.resolve({ count: 0, error: null }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabaseAdmin.from("access_requests" as any) as any)
          .select("id, status, join_method")
          .ilike("email", account.email.replace(/[\\%_]/g, (c: string) => `\\${c}`))
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      if (invRes.error || reqRes.error) {
        console.error("[account-status] invitation/request lookup failed", (invRes.error ?? reqRes.error)?.code ?? "");
        throw new Error("INTERNAL_ERROR");
      }
      pendingInvitations = invRes.count ?? 0;
      const req = (reqRes.data ?? [])[0] as { id: string; status: string; join_method: string } | undefined;
      pendingAccessRequest = req ? { id: req.id, status: req.status, joinMethod: req.join_method } : null;
    }

    return {
      userId,
      email: account.email,
      emailConfirmed: account.emailConfirmed,
      isPlatformAdmin: roles.has("platform_admin"),
      isShariahReviewer: roles.has("shariah_board"),
      isTrader: roles.has("trader"),
      onHold: (holdsRes.data ?? []).length > 0,
      cashBalance,
      buyingPower: buyingPower ?? cashBalance,
      companies,
      pendingInvitations,
      pendingAccessRequest,
    };
  });
