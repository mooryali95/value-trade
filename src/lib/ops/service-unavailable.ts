/**
 * A page whose data cannot be read because the database is unreachable is a
 * temporary outage, not a server bug: it answers 503 Service Unavailable with
 * Retry-After (so crawlers and monitors retry instead of dropping the URL)
 * while still rendering the route's designed error state.
 *
 * How TanStack Router sets the SSR status: after the loaders run it answers
 * 404 when a loader threw notFound() and 500 when any loader threw anything
 * else and the stream handler creates the Response with that status. The way the
 * router stores it is internal and changed between versions, so the status
 * is corrected on the Response the SSR handler callback returns
 * (src/server.ts): only the final status and the public route matches are read.
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

/** A route match as the router exposes it (router.stores.matches). */
export interface SsrMatchStatus {
  status: string;
  error?: unknown;
}

/**
 * True when the rendered page answered 500 and every failed loader of this
 * request failed because the database is unavailable. A 404 (notFound), a 200
 * and a 500 with any other cause are left alone.
 */
export function shouldServeUnavailable(
  responseStatus: number,
  matches: ReadonlyArray<SsrMatchStatus>,
): boolean {
  if (responseStatus !== 500) return false;
  const failed = matches.filter((m) => m.status === "error");
  return failed.length > 0 && failed.every((m) => isServiceUnavailableError(m.error));
}

/** The same rendered page (body and headers), answered as 503 + Retry-After. */
export function toServiceUnavailable(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Retry-After", String(RETRY_AFTER_SECONDS));
  return new Response(response.body, { status: 503, statusText: "Service Unavailable", headers });
}
