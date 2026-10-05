import { describe, expect, it } from "vitest";
import {
  createScriptNonce,
  isEmbeddablePreviewHost,
  securityHeadersFor,
  withSecurityHeaders,
} from "./security-headers";

describe("security headers", () => {
  it("production hosts refuse framing and get HSTS", () => {
    for (const host of [
      "hub.sunkvalue.com",
      "value-trade.lovable.app",
      "project--25e304b6-2628-4d2b-8228-c4b3a042ef30.lovable.app",
    ]) {
      const h = securityHeadersFor(new URL(`https://${host}/market`));
      expect(h["X-Frame-Options"]).toBe("DENY");
      expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
      expect(h["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
      expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["Permissions-Policy"]).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
    }
  });

  it("Lovable preview and dev hosts stay embeddable in the editor", () => {
    for (const host of [
      "id-preview--25e304b6-2628-4d2b-8228-c4b3a042ef30.lovable.app",
      "project--25e304b6-2628-4d2b-8228-c4b3a042ef30-dev.lovable.app",
      "25e304b6-2628-4d2b-8228-c4b3a042ef30.lovableproject.com",
      "localhost",
    ]) {
      expect(isEmbeddablePreviewHost(host)).toBe(true);
      const h = securityHeadersFor(new URL(`https://${host}/`));
      expect(h["X-Frame-Options"]).toBeUndefined();
      expect(h["Content-Security-Policy"]).not.toContain("frame-ancestors");
      expect(h["Content-Security-Policy"]).toContain("object-src 'none'");
    }
    expect(isEmbeddablePreviewHost("evil-dev.lovable.app.example.com")).toBe(false);
  });

  it("no HSTS over plain http; no script policy that would break hydration", () => {
    const h = securityHeadersFor(new URL("http://127.0.0.1:3000/"));
    expect(h["Strict-Transport-Security"]).toBeUndefined();
    expect(h["Content-Security-Policy"]).not.toMatch(/script-src|default-src/);
  });

  it("adds headers without overriding the response's own, also on immutable headers", () => {
    const req = new Request("https://hub.sunkvalue.com/");
    const res = withSecurityHeaders(
      new Response("x", { headers: { "Referrer-Policy": "no-referrer" } }),
      req,
    );
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    const frozen = Response.redirect("https://hub.sunkvalue.com/auth", 302);
    const out = withSecurityHeaders(frozen, req);
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe("https://hub.sunkvalue.com/auth");
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("rendered pages on production hosts get a nonce script policy", () => {
    const nonce = createScriptNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createScriptNonce()).not.toBe(nonce);
    const h = securityHeadersFor(new URL("https://hub.sunkvalue.com/market"), nonce);
    expect(h["Content-Security-Policy"]).toContain(`script-src 'self' 'nonce-${nonce}'`);
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).not.toContain("unsafe-inline");
  });

  it("no script policy without a nonce, on preview hosts, or for a malformed nonce", () => {
    expect(
      securityHeadersFor(new URL("https://hub.sunkvalue.com/"))["Content-Security-Policy"],
    ).not.toContain("script-src");
    const preview = securityHeadersFor(
      new URL("https://id-preview--25e304b6-2628-4d2b-8228-c4b3a042ef30.lovable.app/"),
      createScriptNonce(),
    );
    expect(preview["Content-Security-Policy"]).not.toContain("script-src");
    const injected = securityHeadersFor(new URL("https://hub.sunkvalue.com/"), "x'; script-src *");
    expect(injected["Content-Security-Policy"]).not.toContain("script-src");
  });
});
