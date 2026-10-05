import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { createScriptNonce } from "./lib/ops/security-headers";

export const getRouter = () => {
  // One quick retry: a failed read should reach its designed error state in
  // about a second instead of sitting on a skeleton through four attempts.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, retryDelay: 800 } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // One router per server request: its nonce goes on every inline script
    // the page streams and into that page's script-src policy (server.ts).
    ssr: typeof window === "undefined" ? { nonce: createScriptNonce() } : undefined,
  });

  return router;
};
