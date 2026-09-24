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

const COLUMNS =
  "id, symbol, slug, name_ar, name_en, sector, asset_class, reference_price, published, company_id";

/** Slugs and symbols are plain identifiers; anything else cannot match a row. */
const IDENT_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Resolves a tradable instrument by slug or symbol (case-insensitive). */
export async function getInstrument(
  supabase: Client,
  slugOrSymbol: string,
): Promise<Instrument | null> {
  const raw = slugOrSymbol.trim();
  if (!IDENT_RE.test(raw)) return null;
  const slug = raw.toLowerCase();
  const symbol = raw.toUpperCase();
  // Two parameterized lookups instead of an interpolated .or() filter string,
  // so user input can never inject PostgREST filter syntax.
  let { data, error } = await supabase
    .from("brands")
    .select(COLUMNS)
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();
  if (!error && !data) {
    ({ data, error } = await supabase
      .from("brands")
      .select(COLUMNS)
      .eq("symbol", symbol)
      .limit(1)
      .maybeSingle());
  }
  if (error) {
    console.error("[instrument] lookup failed", error.code);
    throw new Error("INTERNAL_ERROR");
  }
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
