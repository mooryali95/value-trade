/**
 * A page whose data cannot be read because the database is unreachable is a
 * temporary outage, not a server bug: it answers 503 Service Unavailable with
 * Retry-After (so crawlers and monitors retry instead of dropping the URL)
 * while still rendering the route's designed error state.
 *
 * How TanStack Router sets the SSR status: after the loaders run it answers
 * 404 when a loader threw notFound() and 500 when any loader threw anything
 * else (router.stores.statusCode, read by the stream handler when it creates
 * the Response). setResponseStatus() does not reach an SSR page: h3 keeps the
 * status of the Response the handler returns. So the status is corrected in
 * the SSR handler callback (src/server.ts), after the loaders and before the
 * response is created.
 */

/**
 * Stable codes meaning "the database cannot be read right now". The market
 * data reads (public-market.server.ts, book.functions.ts) throw
 * MARKET_DATA_UNAVAILABLE; a loader that calls them rethrows it.
 */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(["MARKET_DATA_UNAVAILABLE"]);

/** How long a client should wait before retrying a 503 page. */
export const RETRY_AFTER_SECONDS = 30;

export function isServiceUnavailableError(error: unknown): boolean {
  return error instanceof Error && UNAVAILABLE_CODES.has(error.message);
}

/** The part of the router this needs (a TanStack router satisfies it). */
export interface SsrRouterStatus {
  stores: {
    statusCode: { get(): number; set(value: number): void };
    matches: { get(): ReadonlyArray<{ status: string; error?: unknown }> };
  };
}

/**
 * Turns the router's 500 into 503 + Retry-After when every failed loader of
 * this request failed because the database is unavailable. A 404 (notFound)
 * or a 200 is left alone, and so is a 500 with any other cause.
 */
export function applyServiceUnavailableStatus(
  router: SsrRouterStatus,
  responseHeaders: Headers,
): void {
  if (router.stores.statusCode.get() !== 500) return;
  const failed = router.stores.matches.get().filter((m) => m.status === "error");
  if (failed.length === 0 || !failed.every((m) => isServiceUnavailableError(m.error))) return;
  router.stores.statusCode.set(503);
  responseHeaders.set("Retry-After", String(RETRY_AFTER_SECONDS));
}
