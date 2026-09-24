/**
 * Post-sign-in redirect targets.
 *
 * A redirect target comes from the URL (`/auth?redirect=...`, `?next=...`),
 * so it is attacker-controlled. Only same-origin paths are accepted: the
 * value must start with a single "/" (not "//" or "/\", which browsers read
 * as protocol-relative URLs), contain no control characters or backslashes,
 * and still resolve to the same origin once parsed. Anything else falls back
 * to "/".
 *
 * Google sign-in leaves the page (the OAuth broker redirects back to the
 * site origin), so the target is kept in sessionStorage for the round trip
 * and consumed once a session exists.
 */

const PLACEHOLDER_ORIGIN = "https://value-unit.invalid";

/** Same-origin path (+ query + hash) for `target`, or `fallback` when unsafe. */
export function safeRedirect(target: unknown, fallback = "/"): string {
  if (typeof target !== "string") return fallback;
  const value = target.trim();
  if (value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Backslashes and control characters (tab, newline...) are normalised away
  // by URL parsers and can turn a path into another host.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  const origin =
    typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null"
      ? window.location.origin
      : PLACEHOLDER_ORIGIN;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== new URL(origin).origin) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Never bounce back into the sign-in page itself.
  if (url.pathname === "/auth") return fallback;
  return path || fallback;
}

const STASH_KEY = "vu_post_auth_redirect";
const STASH_TTL_MS = 30 * 60 * 1000;

/** Remember where to go after an off-site sign-in (Google). */
export function stashPostAuthRedirect(target: string): void {
  const safe = safeRedirect(target, "");
  if (!safe || safe === "/") return;
  try {
    sessionStorage.setItem(STASH_KEY, JSON.stringify({ to: safe, at: Date.now() }));
  } catch {
    // storage blocked: the user lands on the home page instead
  }
}

/** Read and forget the remembered target; null when none, stale or unsafe. */
export function consumePostAuthRedirect(now = Date.now()): string | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(STASH_KEY);
    if (raw !== null) sessionStorage.removeItem(STASH_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { to?: unknown; at?: unknown };
    if (typeof parsed.at !== "number" || now - parsed.at > STASH_TTL_MS || now < parsed.at - 60_000) return null;
    const safe = safeRedirect(parsed.to, "");
    return safe && safe !== "/" ? safe : null;
  } catch {
    return null;
  }
}

/** Drop any remembered target (sign-out). */
export function clearPostAuthRedirect(): void {
  try {
    sessionStorage.removeItem(STASH_KEY);
  } catch {
    // ignore
  }
}
