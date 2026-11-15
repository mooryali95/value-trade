import { afterEach, describe, expect, it, vi } from "vitest";

// The route loader must never hold a page hostage to a slow or failing
// database: it gives up after a bounded wait and lets the browser fetch.

const getMarketOverview = vi.fn();
vi.mock("@/lib/market/public-market.functions", () => ({ getMarketOverview: () => getMarketOverview() }));
vi.mock("@tanstack/react-router", () => ({ Link: () => null }));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: vi.fn() }));

const { loadOverviewOrNull, OVERVIEW_LOADER_TIMEOUT_MS } = await import("./market-data");

afterEach(() => {
  getMarketOverview.mockReset();
  vi.useRealTimers();
});

describe("loadOverviewOrNull", () => {
  it("returns the overview when the database answers", async () => {
    const overview = { instruments: [], summary: null };
    getMarketOverview.mockResolvedValue(overview);
    await expect(loadOverviewOrNull()).resolves.toBe(overview);
  });

  it("returns null when the database call fails", async () => {
    getMarketOverview.mockRejectedValue(new Error("MARKET_DATA_UNAVAILABLE"));
    await expect(loadOverviewOrNull()).resolves.toBeNull();
  });

  it("returns null once the timeout passes instead of waiting on a slow database", async () => {
    vi.useFakeTimers();
    getMarketOverview.mockReturnValue(new Promise(() => {}));
    const result = loadOverviewOrNull();
    await vi.advanceTimersByTimeAsync(OVERVIEW_LOADER_TIMEOUT_MS);
    await expect(result).resolves.toBeNull();
  });
});
