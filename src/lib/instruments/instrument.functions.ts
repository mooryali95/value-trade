import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** A listed (published) instrument as the public trade page shows it. */
export type TradeInstrument = {
  symbol: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  sector: string | null;
  assetClass: string;
  referencePrice: number;
  /** Anchor of today's ±20% band: the previous close, else the listing reference. */
  bandReference: number | null;
  lastPrice: number | null;
  /** Ruling in force: halal | non_halal | reviewing, or null when none. */
  shariah: string | null;
};

const Input = z.object({ symbol: z.string().min(1).max(64) });

/**
 * Resolves the trade page's instrument from public.brands (published rows
 * only), so a brand unit listed through a submission approval can be opened
 * and traded. Everything returned is public market data. Resolves to null
 * for an unknown, unpublished or malformed symbol.
 */
export const getTradeInstrument = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => {
    const parsed = Input.safeParse(input);
    return parsed.success ? parsed.data : { symbol: "" };
  })
  .handler(async ({ data }): Promise<TradeInstrument | null> => {
    if (!data.symbol) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getInstrument } = await import("./instrument.server");
    let inst: Awaited<ReturnType<typeof getInstrument>>;
    try {
      inst = await getInstrument(supabaseAdmin, data.symbol);
    } catch {
      throw new Error("INTERNAL_ERROR");
    }
    if (!inst || !inst.published) return null;

    const [band, last, ruling] = await Promise.all([
      supabaseAdmin.rpc("band_reference_price", { _symbol: inst.symbol }),
      supabaseAdmin.rpc("get_symbol_last_trade", { _symbol: inst.symbol }),
      supabaseAdmin.rpc("current_shariah_status", { _symbol: inst.symbol }),
    ]);
    for (const r of [band, last, ruling]) {
      if (r.error) console.error("[trade-instrument] market data lookup failed", r.error.code ?? "");
    }
    const lastRow = Array.isArray(last.data) ? last.data[0] : last.data;
    const bandReference = band.data == null ? null : Number(band.data);
    return {
      symbol: inst.symbol,
      slug: inst.slug,
      nameAr: inst.nameAr,
      nameEn: inst.nameEn,
      sector: inst.sector,
      assetClass: inst.assetClass,
      referencePrice: inst.referencePrice,
      bandReference: bandReference != null && Number.isFinite(bandReference) && bandReference > 0 ? bandReference : null,
      lastPrice: lastRow?.last_price == null ? null : Number(lastRow.last_price),
      shariah: typeof ruling.data === "string" ? ruling.data : null,
    };
  });
