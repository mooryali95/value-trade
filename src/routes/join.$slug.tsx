import { createFileRoute, redirect } from "@tanstack/react-router";

// company.com/join/:slug -> /request-access?slug=:slug (pre-fills + tags
// the request as join_method="link" instead of "search").
export const Route = createFileRoute("/join/$slug")({
  loader: ({ params }) => {
    throw redirect({ to: "/request-access", search: { slug: params.slug } });
  },
});
