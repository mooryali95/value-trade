import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/audit/audit.server";

/**
 * Investor activation for the private brand-units market. A platform admin
 * finds an invited user by email, turns trading on or off (app_role
 * 'trader') and funds the account through `adjustCash`. Every lookup and
 * write here runs with the service role, so each handler verifies the
 * caller is a platform admin before touching another user's data.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "platform_admin",
  });
  if (error) {
    console.error("[investors] has_role failed:", error.code ?? "unknown");
    throw new Error("INTERNAL_ERROR");
  }
  if (!isAdmin) throw new Error("FORBIDDEN_ADMIN_REQUIRED");
}

export type InvestorSummary = {
  userId: string;
  email: string;
  fullName: string | null;
  locale: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  roles: string[];
  tradingActive: boolean;
  cashBalance: number;
  currency: string;
  /** Unresolved launch review holds (legacy balances that could not be explained). */
  reviewHolds: string[];
};

export type InvestorLedgerRow = {
  id: string;
  kind: string;
  amount: number;
  balance_after: number;
  note: string | null;
  created_at: string;
};

/** Upper bound on the auth user scan (pages x per page). */
const USERS_PER_PAGE = 1000;
const MAX_USER_PAGES = 50;

async function loadSummary(userId: string, email: string, createdAt: string, lastSignInAt: string | null, emailConfirmed: boolean): Promise<InvestorSummary> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [profileRes, rolesRes, portfolioRes, holdsRes] = await Promise.all([
    supabaseAdmin.from("profiles").select("full_name, locale").eq("id", userId).maybeSingle(),
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
    supabaseAdmin.from("portfolios").select("cash_balance, currency").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("launch_review_holds").select("reason").eq("user_id", userId).is("resolved_at", null),
  ]);
  for (const r of [profileRes, rolesRes, portfolioRes, holdsRes]) {
    if (r.error) {
      console.error("[investors] summary lookup failed:", r.error.code ?? "unknown");
      throw new Error("INTERNAL_ERROR");
    }
  }
  const roles = (rolesRes.data ?? []).map((r) => String(r.role)).sort();
  return {
    userId,
    email,
    fullName: profileRes.data?.full_name ?? null,
    locale: profileRes.data?.locale ?? null,
    createdAt,
    lastSignInAt,
    emailConfirmed,
    roles,
    tradingActive: roles.includes("trader"),
    cashBalance: Number(portfolioRes.data?.cash_balance ?? 0),
    currency: portfolioRes.data?.currency ?? "SAR",
    reviewHolds: (holdsRes.data ?? []).map((h) => String(h.reason)).sort(),
  };
}

const FindInput = z.object({ email: z.string().trim().toLowerCase().email().max(320) });

/** Exact (case-insensitive) email match. Resolves to null when no user has it. */
export const findInvestorByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FindInput.parse(input))
  .handler(async ({ data, context }): Promise<InvestorSummary | null> => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (let page = 1; page <= MAX_USER_PAGES; page++) {
      const { data: res, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
      if (error) {
        console.error("[investors] listUsers failed:", error.status ?? "unknown");
        throw new Error("INTERNAL_ERROR");
      }
      const users = res?.users ?? [];
      const match = users.find((u) => (u.email ?? "").toLowerCase() === data.email);
      if (match) {
        return loadSummary(
          match.id,
          match.email ?? data.email,
          match.created_at,
          match.last_sign_in_at ?? null,
          !!match.email_confirmed_at,
        );
      }
      if (users.length < USERS_PER_PAGE) break;
    }
    return null;
  });

const UserInput = z.object({ userId: z.string().uuid() });

/** Current cash balance and the newest 20 ledger rows of one investor. */
export const getInvestorLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UserInput.parse(input))
  .handler(async ({ data, context }): Promise<{ cashBalance: number; rows: InvestorLedgerRow[] }> => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [ledgerRes, portfolioRes] = await Promise.all([
      supabaseAdmin
        .from("cash_ledger")
        .select("id, kind, amount, balance_after, note, created_at")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin.from("portfolios").select("cash_balance").eq("user_id", data.userId).maybeSingle(),
    ]);
    if (ledgerRes.error || portfolioRes.error) {
      console.error("[investors] ledger lookup failed:", (ledgerRes.error ?? portfolioRes.error)?.code ?? "unknown");
      throw new Error("INTERNAL_ERROR");
    }
    return {
      cashBalance: Number(portfolioRes.data?.cash_balance ?? 0),
      rows: (ledgerRes.data ?? []).map((r) => ({
        id: r.id,
        kind: r.kind,
        amount: Number(r.amount),
        balance_after: Number(r.balance_after),
        note: r.note,
        created_at: r.created_at,
      })),
    };
  });

const SetTraderInput = z.object({ userId: z.string().uuid(), active: z.boolean() });

/**
 * Activate (grant app_role 'trader') or deactivate trading for an investor.
 * Deactivation also cancels every open/partial order of the investor in the
 * same database transaction (deactivate_trader), so nothing of theirs can
 * fill afterwards. Activating an investor whose legacy balance was put on a
 * launch review hold records the admin's review as the resolution.
 */
export const setTraderRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetTraderInput.parse(input))
  .handler(async ({ data, context }): Promise<{ userId: string; tradingActive: boolean; cancelledOrders: number }> => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target, error: targetErr } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (targetErr || !target?.user) throw new Error("USER_NOT_FOUND");

    let cancelledOrders = 0;
    let resolvedHolds = 0;
    if (data.active) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: "trader" }, { onConflict: "user_id,role", ignoreDuplicates: true });
      if (error) {
        console.error("[investors] grant trader failed:", error.code ?? "unknown");
        throw new Error("INTERNAL_ERROR");
      }
      const { data: resolved, error: holdErr } = await supabaseAdmin
        .from("launch_review_holds")
        .update({ resolved_at: new Date().toISOString(), resolved_by: context.userId })
        .eq("user_id", data.userId)
        .is("resolved_at", null)
        .select("id");
      if (holdErr) console.error("[investors] resolve review hold failed:", holdErr.code ?? "unknown");
      resolvedHolds = resolved?.length ?? 0;
    } else {
      const { data: n, error } = await supabaseAdmin.rpc("deactivate_trader", {
        _user_id: data.userId,
        _actor_id: context.userId,
      });
      if (error) {
        console.error("[investors] deactivate trader failed:", error.code ?? "unknown");
        throw new Error(error.message === "FORBIDDEN_ADMIN_REQUIRED" ? "FORBIDDEN_ADMIN_REQUIRED" : "INTERNAL_ERROR");
      }
      cancelledOrders = Number(n ?? 0);
    }

    await writeAudit(context.supabase, {
      actorId: context.userId,
      action: data.active ? "investor.trading_activate" : "investor.trading_deactivate",
      entity: "user_roles",
      entityId: data.userId,
      metadata: data.active
        ? { role: "trader", active: true, resolvedReviewHolds: resolvedHolds }
        : { role: "trader", active: false, cancelledOrders },
    });

    return { userId: data.userId, tradingActive: data.active, cancelledOrders };
  });
