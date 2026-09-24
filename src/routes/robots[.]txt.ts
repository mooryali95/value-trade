import { createFileRoute } from "@tanstack/react-router";
import { publicSiteOrigin } from "@/lib/ops/origin.server";

function body(origin: string): string {
  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /auth
Disallow: /docs
Disallow: /join
Disallow: /lovable/
Disallow: /unsubscribe

Sitemap: ${origin}/sitemap.xml
`;
}

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(body(publicSiteOrigin()), {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        }),
    },
  },
});
