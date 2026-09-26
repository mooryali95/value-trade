import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

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
  });

  return router;
};
