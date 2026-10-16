/**
 * The approved asset classes — the single source of truth for the app.
 * The database enforces the same list (CHECK constraints
 * brands_asset_class_approved / product_submissions_asset_class_approved).
 * Adding a class means: add it here, add its translation keys, and add a
 * migration that widens both constraints.
 */
import type { Key } from "@/lib/i18n";

export const ASSET_CLASSES = ["stock", "fund", "sukuk", "brand"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const ASSET_CLASS_LABEL: Record<AssetClass, Key> = {
  stock: "e2_assetStock",
  fund: "e2_assetFund",
  sukuk: "e2_assetSukuk",
  brand: "e2_assetBrand",
};

export function isAssetClass(v: unknown): v is AssetClass {
  return typeof v === "string" && (ASSET_CLASSES as readonly string[]).includes(v);
}

/** Instrument counts per approved class (unknown classes are ignored). */
export function countByClass(list: ReadonlyArray<{ assetClass: string }>): Record<AssetClass, number> {
  const out: Record<AssetClass, number> = { stock: 0, fund: 0, sukuk: 0, brand: 0 };
  for (const i of list) if (isAssetClass(i.assetClass)) out[i.assetClass]++;
  return out;
}
