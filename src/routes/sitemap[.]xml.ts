import { createFileRoute } from "@tanstack/react-router";

const PUBLIC_PATHS = [
  "/",
  "/market",
  "/shariah",
  "/auth",
  "/legal/terms",
  "/legal/privacy",
  "/legal/shariah-disclosures",
  "/legal/cookies",
];

export const Route = createFileRoute("/api/public/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const now = new Date().toISOString();
        const urls = PUBLIC_PATHS.map(
          (p) => `  <url><loc>${origin}${p}</loc><lastmod>${now}</lastmod></url>`,
        ).join("\n");
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