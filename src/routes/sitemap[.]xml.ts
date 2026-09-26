import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { publicSiteOrigin } from "@/lib/ops/origin.server";

// Indexable pages only: anything rendered with a noindex robots meta
// (e.g. /request-access, /auth, /unsubscribe) must not be listed here.
const PUBLIC_PATHS = [
  "/",
  "/market",
  "/shariah",
  "/legal/terms",
  "/legal/risk",
  "/legal/privacy",
  "/legal/shariah-disclosures",
  "/legal/cookies",
];

/**
 * Published instruments are part of the public surface, so each one gets its
 * own sitemap entry. Read through the publishable key (anon) — the
 * `brands_public_read_published` policy already limits rows to published
 * instruments, so nothing unlisted can leak here.
 */
async function publishedBrandSlugs(): Promise<{ slug: string; updatedAt: string }[]> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return [];
  try {
    const supabase = createClient<Database>(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
            h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { data, error } = await supabase
      .from("brands")
      .select("slug, updated_at")
      .eq("published", true)
      .order("symbol", { ascending: true })
      .limit(2000);
    if (error || !data) return [];
    return data.map((r) => ({ slug: r.slug, updatedAt: r.updated_at }));
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        // Always the canonical public host, whichever host served the request.
        const origin = publicSiteOrigin();
        const now = new Date().toISOString();
        const brands = await publishedBrandSlugs();
        const urls = [
          ...PUBLIC_PATHS.map(
            (p) => `  <url><loc>${origin}${p}</loc><lastmod>${now}</lastmod></url>`,
          ),
          ...brands.map(
            (b) =>
              `  <url><loc>${origin}/market/${encodeURIComponent(b.slug)}</loc><lastmod>${b.updatedAt}</lastmod><changefreq>daily</changefreq></url>`,
          ),
        ].join("\n");
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
        return new Response(body, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
