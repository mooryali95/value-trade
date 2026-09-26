import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PublicInstrumentDetail, ShariahStatus } from "@/lib/market/public-market.functions";
import { parseSlugInput } from "@/lib/market/public-market.mappers";

/**
 * A listed (published) instrument as the trade page shows it: the public
 * instrument (getPublicInstrument) plus two fields kept for existing
 * callers.
 */
export type TradeInstrument = PublicInstrumentDetail & {
  /** Anchor of today's ±20% band: the previous close, else the listing reference. */
  bandReference: number | null;
  /** Same value as `shariahStatus` (ruling in force), kept for existing callers. */
  shariah: ShariahStatus | null;
};

const Input = z.object({ symbol: z.string().trim().min(1).max(64) });

/**
 * Thin alias of getPublicInstrument for the trade page: the same loader
 * (loadPublicInstrument, publishable key, public_instrument()), so there is
 * one way to load an instrument. Resolves to null for an unknown,
 * unpublished or malformed symbol/slug.
 */
export const getTradeInstrument = createServerFn({ method: "GET" })
  .inputValidator((input: { symbol: string }) => {
    const parsed = Input.safeParse(input);
    return parsed.success ? parsed.data : { symbol: "" };
  })
  .handler(async ({ data }): Promise<TradeInstrument | null> => {
    if (!data.symbol) return null;
    const { slug } = parseSlugInput({ slug: data.symbol });
    if (!slug) return null;
    const { loadPublicInstrument } = await import("@/lib/market/public-market.server");
    const res = await loadPublicInstrument(slug);
    if (!res) return null;
    return { ...res.instrument, bandReference: res.bandReference, shariah: res.instrument.shariahStatus };
  });
