import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { writeAudit } from "@/lib/audit/audit.server";
import { isValidLimitPrice, isValidOrderQty, isValidReferencePrice } from "@/lib/trading/calc";

/**
 * Listing operations of the private brand-units market, platform admins only:
 *   - setReferencePrice: the listing reference price of an instrument. It
 *     anchors the ±20% price band until the first trading day closes (after
 *     that the previous close does);
 *   - issueUnits: primary allocation of a listed brand's units to an
 *     investor at the issue price (the holder's cost basis). Payment for a
 *     primary allocation is settled outside the order book;
 *   - setInstrumentPublished: lists or delists an instrument (the only
 *     way: the database refuses any other change of `published`).
 *     Delisting closes its resting orders in the same transaction (holders
 *     keep their units, trades and cash are untouched); listing needs a
 *     reference price set by an admin (> 0) and a Shariah ruling in force;
 *   - listAdminInstruments: every instrument with its listing state.
 * All run with the service role after the platform_admin check.
 */

/** Stable codes the SQL functions raise that are safe to show to the admin. */
const LISTING_ERROR_CODES = new Set([
  "FORBIDDEN_ADMIN_REQUIRED",
  "INVALID_QTY",
  "INVALID_PRICE",
  "INVALID_INPUT",
  "INSTRUMENT_NOT_FOUND",
  "USER_NOT_FOUND",
  "SHARIAH_RULING_REQUIRED",
  "ASSET_CLASS_NOT_SUPPORTED",
]);

/** How an instrument got into public.brands, for the admin listing screen. */
export type InstrumentOrigin = "submission" | "company" | "demo_seed";

export type AdminInstrument = {
  symbol: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  assetClass: string;
  referencePrice: number;
  published: boolean;
  companyId: string | null;
  origin: InstrumentOrigin;
};

const SYMBOL_RE = /^[A-Za-z0-9._-]{1,32}$/;

async function ensureAdmin(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "platform_admin",
  });
  if (error) {
    console.error("[listing] has_role failed:", error.code ?? "unknown");
    throw new Error("INTERNAL_ERROR");
  }
  if (!isAdmin) throw new Error("FORBIDDEN_ADMIN_REQUIRED");
}

function parseSymbol(v: unknown): string {
  if (typeof v !== "string" || !SYMBOL_RE.test(v.trim())) throw new Error("INSTRUMENT_NOT_FOUND");
  return v.trim().toUpperCase();
}

/**
 * A reference price is on the 0.01 tick, from 0.05 (the smallest price whose
 * ±20% band holds more than one tick) to 1,000,000,000; the database
 * enforces the same rule (trg_brands_reference_price).
 */
export function parseReferencePriceInput(input: unknown): { symbol: string; price: number } {
  const { symbol, price } = (input ?? {}) as { symbol?: unknown; price?: unknown };
  const sym = parseSymbol(symbol);
  if (!isValidReferencePrice(price)) throw new Error("INVALID_PRICE");
  return { symbol: sym, price };
}

export function parseIssueUnitsInput(input: unknown): {
  userId: string;
  symbol: string;
  qty: number;
  price: number;
  note?: string;
} {
  const { userId, symbol, qty, price, note } = (input ?? {}) as Record<string, unknown>;
  if (!z.string().uuid().safeParse(userId).success) throw new Error("USER_NOT_FOUND");
  const sym = parseSymbol(symbol);
  if (!isValidOrderQty(qty)) throw new Error("INVALID_QTY");
  if (!isValidLimitPrice(price) || price > 1_000_000_000) throw new Error("INVALID_PRICE");
  if (note !== undefined && (typeof note !== "string" || note.length > 280)) throw new Error("INVALID_INPUT");
  const trimmed = typeof note === "string" ? note.trim() : "";
  return { userId: userId as string, symbol: sym, qty, price, ...(trimmed ? { note: trimmed } : {}) };
}

export function parsePublishInput(input: unknown): { symbol: string; published: boolean } {
  const { symbol, published } = (input ?? {}) as { symbol?: unknown; published?: unknown };
  const sym = parseSymbol(symbol);
  if (typeof published !== "boolean") throw new Error("INVALID_INPUT");
  return { symbol: sym, published };
}

/**
 * Sets brands.reference_price through set_reference_price, which re-checks
 * platform_admin, takes the engine's symbol lock, applies the price rules
 * (INVALID_PRICE) and writes the audit_log row (brand.reference_price) in the
 * same transaction. API users cannot write the column directly.
 */
export const setReferencePrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseReferencePriceInput(input))
  .handler(async ({ data, context }): Promise<{ symbol: string; referencePrice: number }> => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("set_reference_price" as never, {
      _symbol: data.symbol,
      _price: data.price,
      _actor_id: context.userId,
    } as never);
    if (error) {
      const err = error as { message?: string; code?: string };
      const code = (err.message ?? "").trim();
      if (LISTING_ERROR_CODES.has(code)) throw new Error(code);
      // The database's own price rules (CHECK 23514).
      if (err.code === "23514") throw new Error("INVALID_PRICE");
      console.error("[listing] set_reference_price failed:", err.code ?? "unknown");
      throw new Error("INTERNAL_ERROR");
    }
    const row = (Array.isArray(rows) ? rows[0] : rows) as { symbol?: string; reference_price?: number | string } | null;
    if (!row) {
      console.error("[listing] set_reference_price returned no row");
      throw new Error("INTERNAL_ERROR");
    }
    return { symbol: row.symbol ?? data.symbol, referencePrice: Number(row.reference_price ?? data.price) };
  });

/** Primary issuance: credits whole units of a listed brand to an investor. */
export const issueUnits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseIssueUnitsInput(input))
  .handler(async ({ data, context }): Promise<{ issuanceId: string; symbol: string; qty: number }> => {
    await ensureAdmin(context);
    const { checkRateLimit } = await import("@/lib/security/rate-limit.server");
    if (!(await checkRateLimit(`issue-units:actor:${context.userId}`, 60, 3600))) {
      throw new Error("RATE_LIMITED");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: issuanceId, error } = await supabaseAdmin.rpc("issue_units", {
      _actor_id: context.userId,
      _user_id: data.userId,
      _symbol: data.symbol,
      _qty: data.qty,
      _price: data.price,
      _note: data.note,
    });
    if (error) {
      const code = (error.message ?? "").trim();
      if (LISTING_ERROR_CODES.has(code)) throw new Error(code);
      console.error("[listing] issue_units failed:", error.code ?? "unknown");
      throw new Error("INTERNAL_ERROR");
    }
    await writeAudit(context.supabase, {
      actorId: context.userId,
      action: "units.issue",
      entity: "unit_issuances",
      entityId: String(issuanceId),
      metadata: { targetUserId: data.userId, symbol: data.symbol, qty: data.qty, price: data.price },
    });
    return { issuanceId: String(issuanceId), symbol: data.symbol, qty: data.qty };
  });

/**
 * Lists (published = true) or delists (false) an instrument through
 * set_instrument_published, which re-checks platform_admin, takes the
 * engine's symbol lock and, when delisting, closes every resting order of
 * the instrument (orders_audit 'delisted') in the same transaction, together
 * with the audit_log row (brand.publish / brand.unpublish).
 * Listing requires a reference price > 0 (INVALID_PRICE otherwise) and a
 * Shariah ruling in force (SHARIAH_RULING_REQUIRED otherwise).
 */
export const setInstrumentPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { symbol: string; published: boolean }) => parsePublishInput(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ symbol: string; published: boolean; changed: boolean; cancelledOrders: number }> => {
      await ensureAdmin(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: rows, error } = await supabaseAdmin.rpc("set_instrument_published", {
        _symbol: data.symbol,
        _published: data.published,
        _actor_id: context.userId,
      });
      if (error) {
        const code = (error.message ?? "").trim();
        if (LISTING_ERROR_CODES.has(code)) throw new Error(code);
        console.error("[listing] set_instrument_published failed:", error.code ?? "unknown");
        throw new Error("INTERNAL_ERROR");
      }
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) {
        console.error("[listing] set_instrument_published returned no row");
        throw new Error("INTERNAL_ERROR");
      }
      // The audit_log row was written by set_instrument_published in the
      // same transaction.
      return {
        symbol: row.symbol,
        published: row.published,
        changed: row.changed,
        cancelledOrders: Number(row.cancelled_orders) || 0,
      };
    },
  );

/** Every instrument (at most 1000, by symbol) with its listing state. */
export const listAdminInstruments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminInstrument[]> => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("brands")
      .select("symbol, slug, name_ar, name_en, asset_class, reference_price, published, company_id, source_submission_id")
      .order("symbol", { ascending: true })
      .limit(1000);
    if (error) {
      console.error("[listing] instruments lookup failed:", error.code ?? "unknown");
      throw new Error("INTERNAL_ERROR");
    }
    return (rows ?? []).map((r) => ({
      symbol: r.symbol,
      slug: r.slug,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      assetClass: r.asset_class,
      referencePrice: Number(r.reference_price),
      published: r.published,
      companyId: r.company_id,
      origin: r.source_submission_id ? "submission" : r.company_id ? "company" : "demo_seed",
    }));
  });
