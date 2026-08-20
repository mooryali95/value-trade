/**
 * Instrument lookup — server-side source of truth.
 *
 * `mock-data.ts` still feeds charts and the marketing surfaces, but anything
 * that moves money (order placement, risk guards, Shariah gate) resolves the
 * instrument from `public.brands` instead. One row per tradable symbol.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Instrument = {
  id: string;
  symbol: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  sector: string | null;
  assetClass: string;
  referencePrice: number;
  published: boolean;
  companyId: string | null;
};

type Client = SupabaseClient<Database>;

/** Resolves a tradable instrument by slug or symbol (case-insensitive). */
export async function getInstrument(
  supabase: Client,
  slugOrSymbol: string,
): Promise<Instrument | null> {
  const slug = slugOrSymbol.trim().toLowerCase();
  const symbol = slugOrSymbol.trim().toUpperCase();
  const { data, error } = await supabase
    .from("brands")
    .select(
      "id, symbol, slug, name_ar, name_en, sector, asset_class, reference_price, published, company_id",
    )
    .or(`slug.eq.${slug},symbol.eq.${symbol}`)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    symbol: data.symbol,
    slug: data.slug,
    nameAr: data.name_ar,
    nameEn: data.name_en,
    sector: data.sector,
    assetClass: data.asset_class,
    referencePrice: Number(data.reference_price),
    published: data.published,
    companyId: data.company_id,
  };
}
