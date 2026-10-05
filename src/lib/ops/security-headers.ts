// Security headers for every response the server renders (SSR HTML, server
// functions, API routes). Applied in src/server.ts. Static files in
// public/ are served by the host before the worker runs; public/_headers
// gives them the same set where the host honours it (Cloudflare static
// assets do).
//
// What is sent, and why only this subset of CSP:
//   * Strict-Transport-Security: HTTPS only, two years, subdomains (no
//     preload: preloading cannot be undone quickly);
//   * X-Content-Type-Options: nosniff;
//   * Referrer-Policy: strict-origin-when-cross-origin;
//   * Permissions-Policy: camera, microphone, geolocation, payment, USB and
//     the interest-cohort / browsing-topics APIs are off;
//   * framing: Content-Security-Policy frame-ancestors 'none' and
//     X-Frame-Options DENY on the production hosts. Lovable's editor shows
//     the app in an iframe on its preview / dev hosts, so those hosts are
//     not denied (they are not the published site);
//   * CSP also sets base-uri 'self', object-src 'none' and form-action
//     'self';
//   * script-src on rendered pages of the production hosts: 'self' plus a
//     per-request nonce. The router puts that nonce on every inline script it
//     streams (hydration, scroll restoration, React's streaming scripts), so
//     injected inline script and scripts from other origins do not run.
//     Preview and dev hosts get no script policy: the Lovable editor injects
//     its own tooling there. There is no style-src policy (inline styles are
//     used by the UI library and carry no script execution).

export const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
};

const HSTS = "max-age=63072000; includeSubDomains";
const CSP_FRAMED = "base-uri 'self'; object-src 'none'; form-action 'self'";
const CSP_NO_FRAMING = `frame-ancestors 'none'; ${CSP_FRAMED}`;

/**
 * Hosts where Lovable's editor embeds the app (preview and dev builds).
 * Everything else, including the published *.lovable.app URLs and the
 * custom domain, refuses to be framed.
 */
export function isEmbeddablePreviewHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".lovableproject.com") ||
    (h.endsWith(".lovable.app") &&
      (h.startsWith("id-preview--") || h.startsWith("preview--") || h.endsWith("-dev.lovable.app")))
  );
}

/** A fresh nonce for one rendered page (128 random bits, base64). */
export function createScriptNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const NONCE_RE = /^[A-Za-z0-9+/]{16,}={0,2}$/;

/**
 * The headers for a response to `url` (only those the response does not set
 * itself). `scriptNonce` is the nonce the router put on the page's inline
 * scripts; with it, production hosts also get a script-src policy.
 */
export function securityHeadersFor(url: URL, scriptNonce?: string): Record<string, string> {
  const out: Record<string, string> = { ...BASE_SECURITY_HEADERS };
  if (url.protocol === "https:") out["Strict-Transport-Security"] = HSTS;
  if (isEmbeddablePreviewHost(url.hostname)) {
    out["Content-Security-Policy"] = CSP_FRAMED;
  } else {
    const scripts =
      scriptNonce && NONCE_RE.test(scriptNonce) ? `; script-src 'self' 'nonce-${scriptNonce}'` : "";
    out["Content-Security-Policy"] = CSP_NO_FRAMING + scripts;
    out["X-Frame-Options"] = "DENY";
  }
  return out;
}

/** Returns `response` with the security headers added (never overriding one it already has). */
export function withSecurityHeaders(response: Response, request: Request): Response {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return response;
  }
  // Protocol upgrades carry no document.
  if (response.status === 101) return response;
  const headers = securityHeadersFor(url);
  const apply = (target: Headers) => {
    for (const [name, value] of Object.entries(headers)) {
      if (!target.has(name)) target.set(name, value);
    }
  };
  try {
    apply(response.headers);
    return response;
  } catch {
    // Immutable headers (e.g. a response passed through from fetch()).
    const copy = new Response(response.body, response);
    apply(copy.headers);
    return copy;
  }
}
