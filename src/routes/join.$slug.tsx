import { createFileRoute, redirect } from "@tanstack/react-router";

// /join/:slug -> /request-access?slug=:slug (pre-fills the company and tags
// the request as join_method="link" instead of "search"). Anything that is
// not a company slug opens the plain request form.
export const Route = createFileRoute("/join/$slug")({
  loader: ({ params }) => {
    const slug = params.slug.trim().toLowerCase();
    throw redirect({
      to: "/request-access",
      search: /^[a-z0-9-]{1,48}$/.test(slug) ? { slug } : {},
    });
  },
});
