import { describe, expect, it } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
} from "@tanstack/react-router";
import {
  isServiceUnavailableError,
  RETRY_AFTER_SECONDS,
  shouldServeUnavailable,
  toServiceUnavailable,
} from "./service-unavailable";

/** The route matches of a server-side router whose /page loader behaves as given. */
async function loadedMatches(loader: () => unknown) {
  const rootRoute = createRootRoute();
  const pageRoute = createRoute({ getParentRoute: () => rootRoute, path: "/page", loader });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: ["/page"] }),
    isServer: true,
  });
  await router.load();
  return router.stores.matches.get();
}

describe("503 for a database outage", () => {
  it("recognises the market data outage code only", () => {
    expect(isServiceUnavailableError(new Error("MARKET_DATA_UNAVAILABLE"))).toBe(true);
    expect(isServiceUnavailableError(new Error("INTERNAL_ERROR"))).toBe(false);
    expect(isServiceUnavailableError("MARKET_DATA_UNAVAILABLE")).toBe(false);
    expect(isServiceUnavailableError(undefined)).toBe(false);
  });

  it("a 500 page whose loader failed with MARKET_DATA_UNAVAILABLE becomes 503", async () => {
    const matches = await loadedMatches(() => {
      throw new Error("MARKET_DATA_UNAVAILABLE");
    });
    expect(shouldServeUnavailable(500, matches)).toBe(true);
  });

  it("any other loader failure stays 500", async () => {
    const matches = await loadedMatches(() => {
      throw new Error("INTERNAL_ERROR");
    });
    expect(shouldServeUnavailable(500, matches)).toBe(false);
  });

  it("not found and normal pages are left alone", async () => {
    const nf = await loadedMatches(() => {
      throw notFound();
    });
    expect(shouldServeUnavailable(404, nf)).toBe(false);
    const ok = await loadedMatches(() => ({ ok: true }));
    expect(shouldServeUnavailable(200, ok)).toBe(false);
  });

  it("an outage mixed with another failure stays 500", () => {
    expect(
      shouldServeUnavailable(500, [
        { status: "error", error: new Error("MARKET_DATA_UNAVAILABLE") },
        { status: "error", error: new Error("INTERNAL_ERROR") },
      ]),
    ).toBe(false);
  });

  it("keeps the rendered body and headers, adding 503 and Retry-After", async () => {
    const res = toServiceUnavailable(
      new Response("<html>error page</html>", {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe(String(RETRY_AFTER_SECONDS));
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("<html>error page</html>");
  });
});
