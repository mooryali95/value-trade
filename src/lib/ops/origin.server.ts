// Server-only: the one place that decides which origin the app may use when it
// builds absolute links (invitation emails, alert emails) or calls itself
// (post-deploy smoke suite). Never trust an origin supplied by the browser.
//
// Resolution order for the canonical origin:
//   1. APP_ORIGIN env var (exact origin, e.g. "https://hub.sunkvalue.com")
//   2. legacy PUBLIC_SITE_URL / PUBLIC_APP_ORIGIN env vars
//   3. the current request's own origin, only if it is on the allowlist
//   4. DEFAULT_CANONICAL_ORIGIN
//
// The allowlist is exact-match only (no wildcard hosts): the env origins above,
// APP_ALLOWED_ORIGINS (comma-separated exact origins), the known production
// hosts, plus http://localhost / 127.0.0.1 on any port outside production
// builds.

import { getRequest } from "@tanstack/react-start/server";

export const DEFAULT_CANONICAL_ORIGIN = "https://hub.sunkvalue.com";

const KNOWN_PRODUCTION_ORIGINS = [
  "https://hub.sunkvalue.com",
  "https://value-trade.lovable.app",
  // Immutable Lovable URLs of this project (see docs/api-public.md).
  "https://project--25e304b6-2628-4d2b-8228-c4b3a042ef30.lovable.app",
  "https://project--25e304b6-2628-4d2b-8228-c4b3a042ef30-dev.lovable.app",
] as const;

/** Parses a URL-ish string into its bare origin, or null when invalid. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

function isProductionBuild(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  try {
    return import.meta.env?.PROD === true;
  } catch {
    return false;
  }
}

function envOrigins(): string[] {
  return [process.env.APP_ORIGIN, process.env.PUBLIC_SITE_URL, process.env.PUBLIC_APP_ORIGIN]
    .map((v) => normalizeOrigin(v))
    .filter((v): v is string => !!v);
}

/** Exact list of origins the server will link to or call. */
export function allowedOrigins(): string[] {
  const extra = (process.env.APP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((v) => normalizeOrigin(v))
    .filter((v): v is string => !!v);
  return Array.from(new Set([...envOrigins(), ...extra, ...KNOWN_PRODUCTION_ORIGINS]));
}

/** True when `origin` is exactly on the allowlist (localhost only outside prod). */
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  const o = normalizeOrigin(origin);
  if (!o) return false;
  if (allowedOrigins().includes(o)) return true;
  if (!isProductionBuild()) {
    return /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(o);
  }
  return false;
}

/** Origin of the request currently being handled, or null outside a request. */
export function currentRequestOrigin(): string | null {
  try {
    const request = getRequest();
    return normalizeOrigin(request?.url);
  } catch {
    return null;
  }
}

/**
 * Canonical public origin for absolute links in emails. Prefers the configured
 * env origin; otherwise the current request's origin when allowlisted; else
 * the production default.
 */
export function canonicalOrigin(): string {
  const configured = envOrigins()[0];
  if (configured) return configured;
  const fromRequest = currentRequestOrigin();
  if (fromRequest && isAllowedOrigin(fromRequest)) return fromRequest;
  return DEFAULT_CANONICAL_ORIGIN;
}

/**
 * Public site origin for SEO surfaces (robots.txt, sitemap.xml): the
 * configured env origin, else the production default. Deliberately ignores the
 * request host so alternate hosts never advertise themselves as canonical.
 */
export function publicSiteOrigin(): string {
  return envOrigins()[0] ?? DEFAULT_CANONICAL_ORIGIN;
}

/**
 * Origin of this deployment for self-calls (smoke suite): the current
 * request's origin when allowlisted, else the canonical origin.
 */
export function selfOrigin(): string {
  const fromRequest = currentRequestOrigin();
  if (fromRequest && isAllowedOrigin(fromRequest)) return fromRequest;
  return canonicalOrigin();
}
