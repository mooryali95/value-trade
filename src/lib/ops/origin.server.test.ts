import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    throw new Error("no request context");
  },
}));

import {
  canonicalOrigin,
  isAllowedOrigin,
  normalizeOrigin,
  publicSiteOrigin,
  selfOrigin,
} from "./origin.server";

describe("origin allowlist", () => {
  beforeEach(() => {
    delete process.env.APP_ORIGIN;
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.PUBLIC_APP_ORIGIN;
    delete process.env.APP_ALLOWED_ORIGINS;
  });

  it("accepts only exact known hosts, never arbitrary lovable.app subdomains", () => {
    expect(isAllowedOrigin("https://hub.sunkvalue.com")).toBe(true);
    expect(isAllowedOrigin("https://value-trade.lovable.app")).toBe(true);
    expect(isAllowedOrigin("https://attacker.lovable.app")).toBe(false);
    expect(isAllowedOrigin("https://evil.sunkvalue.com")).toBe(false);
    expect(isAllowedOrigin("https://hub.sunkvalue.com.evil.example")).toBe(false);
    expect(isAllowedOrigin("javascript:alert(1)")).toBe(false);
    expect(isAllowedOrigin("https://user:pw@hub.sunkvalue.com")).toBe(false);
  });

  it("allows localhost outside production builds", () => {
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
  });

  it("honours APP_ORIGIN and APP_ALLOWED_ORIGINS exactly", () => {
    process.env.APP_ORIGIN = "https://app.example.com/some/path";
    process.env.APP_ALLOWED_ORIGINS = "https://preview.example.com, not a url";
    expect(canonicalOrigin()).toBe("https://app.example.com");
    expect(publicSiteOrigin()).toBe("https://app.example.com");
    expect(isAllowedOrigin("https://preview.example.com")).toBe(true);
    expect(isAllowedOrigin("https://other.example.com")).toBe(false);
  });

  it("falls back to the production default outside a request", () => {
    expect(canonicalOrigin()).toBe("https://hub.sunkvalue.com");
    expect(selfOrigin()).toBe("https://hub.sunkvalue.com");
    expect(normalizeOrigin("HTTPS://HUB.SUNKVALUE.COM/x?y=1")).toBe("https://hub.sunkvalue.com");
  });
});
