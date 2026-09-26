import { describe, expect, it } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
} from "@tanstack/react-router";
import {
  applyServiceUnavailableStatus,
  isServiceUnavailableError,
  RETRY_AFTER_SECONDS,
} from "./service-unavailable";

/** A server-side router whose /page loader behaves as given, loaded like the SSR handler does. */
async function loadedRouter(loader: () => unknown) {
  const rootRoute = createRootRoute();
  const pageRoute = createRoute({ getParentRoute: () => rootRoute, path: "/page", loader });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: ["/page"] }),
    isServer: true,
  });
  await router.load();
  return router;
}

describe("503 for a database outage", () => {
  it("recognises the market data outage code only", () => {
    expect(isServiceUnavailableError(new Error("MARKET_DATA_UNAVAILABLE"))).toBe(true);
    expect(isServiceUnavailableError(new Error("INTERNAL_ERROR"))).toBe(false);
    expect(isServiceUnavailableError("MARKET_DATA_UNAVAILABLE")).toBe(false);
    expect(isServiceUnavailableError(undefined)).toBe(false);
  });

  it("a loader that failed with MARKET_DATA_UNAVAILABLE: the router's 500 becomes 503 + Retry-After", async () => {
    const router = await loadedRouter(() => {
      throw new Error("MARKET_DATA_UNAVAILABLE");
    });
    expect(router.stores.statusCode.get()).toBe(500);
    const headers = new Headers();
    applyServiceUnavailableStatus(router, headers);
    expect(router.stores.statusCode.get()).toBe(503);
    expect(headers.get("Retry-After")).toBe(String(RETRY_AFTER_SECONDS));
  });

  it("any other loader failure stays 500 without Retry-After", async () => {
    const router = await loadedRouter(() => {
      throw new Error("INTERNAL_ERROR");
    });
    const headers = new Headers();
    applyServiceUnavailableStatus(router, headers);
    expect(router.stores.statusCode.get()).toBe(500);
    expect(headers.has("Retry-After")).toBe(false);
  });

  it("not found stays 404 and a normal page stays 200", async () => {
    for (const [loader, status] of [
      [
        () => {
          throw notFound();
        },
        404,
      ],
      [() => ({ ok: true }), 200],
    ] as const) {
      const router = await loadedRouter(loader);
      const headers = new Headers();
      applyServiceUnavailableStatus(router, headers);
      expect(router.stores.statusCode.get()).toBe(status);
      expect(headers.has("Retry-After")).toBe(false);
    }
  });

  it("a 500 with an outage and another failure stays 500", () => {
    let status = 500;
    const router = {
      stores: {
        statusCode: {
          get: () => status,
          set: (v: number) => {
            status = v;
          },
        },
        matches: {
          get: () => [
            { status: "error", error: new Error("MARKET_DATA_UNAVAILABLE") },
            { status: "error", error: new Error("INTERNAL_ERROR") },
          ],
        },
      },
    };
    const headers = new Headers();
    applyServiceUnavailableStatus(router, headers);
    expect(status).toBe(500);
    expect(headers.has("Retry-After")).toBe(false);
  });
});
