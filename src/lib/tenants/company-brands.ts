/**
 * The 30-brand cap per company, as the database enforces it
 * (enforce_brand_cap / company_brand_count).
 */
export const BRAND_CAP = 30;

export type CompanyBrandRow = {
  /** company_brands row id; null for an owned instrument not on the roster. */
  id: string | null;
  symbol: string;
  /** When the roster entry was added; null for an owned instrument only. */
  addedAt: string | null;
  /** The company owns the instrument (brands.company_id). */
  owned: boolean;
  /** Only a roster entry for an instrument the company does not own can be removed. */
  removable: boolean;
};

/**
 * The company's brands, counted as the database counts them against the cap
 * (company_brand_count): its roster (company_brands) together with the
 * instruments it owns (brands.company_id, e.g. listed through a product
 * submission), each symbol once. The workspace and the company settings both
 * use this list, so they always show the same count.
 */
export function companyBrandRows(
  roster: ReadonlyArray<{ id: string; brand_symbol: string; added_at?: string | null }>,
  instruments: ReadonlyArray<{ symbol: string }>,
): CompanyBrandRow[] {
  const owned = new Set(instruments.map((b) => b.symbol.trim().toUpperCase()));
  const rows: CompanyBrandRow[] = [];
  const seen = new Set<string>();
  for (const r of roster) {
    const symbol = r.brand_symbol.trim().toUpperCase();
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    rows.push({ id: r.id, symbol, addedAt: r.added_at ?? null, owned: owned.has(symbol), removable: !owned.has(symbol) });
  }
  for (const symbol of owned) {
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    rows.push({ id: null, symbol, addedAt: null, owned: true, removable: false });
  }
  return rows;
}
