import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
// Selects the market data provider at boot (mock by default, live feed when
// VITE_MARKET_PROVIDER=live — see docs/market-data-migration.md).
import { registerMarketProvider } from "./lib/integrations/live-provider";

registerMarketProvider();

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
