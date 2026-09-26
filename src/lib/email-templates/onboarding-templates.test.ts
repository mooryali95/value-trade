import { describe, expect, it } from "vitest";
import * as React from "react";
import { render } from "@react-email/render";
import { TEMPLATES } from "./registry";
import { InviteEmail } from "./invite";
import { RecoveryEmail } from "./recovery";
import { EmailChangeEmail } from "./email-change";

function subjectOf(t: { subject: unknown }, d: Record<string, unknown>): string {
  return typeof t.subject === "function" ? (t.subject as (x: Record<string, unknown>) => string)(d) : String(t.subject);
}

async function text(el: React.ReactElement): Promise<string> {
  return render(el, { plainText: true });
}

describe("onboarding e-mail templates", () => {
  it("invitation: bilingual, names each language's company name and role, links the invitation page", async () => {
    const t = TEMPLATES.invitation;
    const out = await text(
      React.createElement(t.component, {
        companyNameAr: "شركة مثال",
        companyNameEn: "Example Co.",
        role: "trader",
        acceptUrl: "https://hub.sunkvalue.com/invite/00000000-0000-4000-8000-000000000000",
        expiresAt: "2026-10-01T12:00:00Z",
      }),
    );
    expect(out).toContain("شركة مثال");
    expect(out).toContain("Example Co.");
    expect(out).toContain("مكتب التداول");
    expect(out).toContain("Trading desk");
    expect(out).toContain("https://hub.sunkvalue.com/invite/00000000-0000-4000-8000-000000000000");
    expect(out).not.toMatch(/undefined|null|\btrader\b/);
    expect(subjectOf(t, { companyNameAr: "شركة مثال", companyNameEn: "Example Co." })).toContain("Example Co.");
  });

  it("access request received: reference code, status link, per-kind wording", async () => {
    const t = TEMPLATES["access-request-received"];
    for (const kind of ["investor", "join", "new_company"] as const) {
      const out = await text(
        React.createElement(t.component, {
          fullName: "سارة",
          referenceCode: "VU-7KQ2-M9XD",
          kind,
          companyNameAr: kind === "investor" ? null : "شركة مثال",
          companyNameEn: kind === "investor" ? null : "Example Co.",
          statusUrl: "https://hub.sunkvalue.com/request-access?ref=VU-7KQ2-M9XD",
        }),
      );
      expect(out).toContain("VU-7KQ2-M9XD");
      expect(out).toContain("https://hub.sunkvalue.com/request-access?ref=VU-7KQ2-M9XD");
      expect(out).not.toMatch(/undefined|null/);
    }
  });

  it("access request decision: rejection with the reviewer's note; approval of an existing account", async () => {
    const t = TEMPLATES["access-request-decision"];
    const rejected = await text(
      React.createElement(t.component, {
        decision: "rejected",
        kind: "new_company",
        fullName: "Omar",
        referenceCode: "VU-7KQ2-M9XD",
        companyNameAr: "شركة مثال",
        companyNameEn: "Example Co.",
        note: "Incomplete registration details.",
        requestUrl: "https://hub.sunkvalue.com/request-access",
      }),
    );
    expect(rejected).toContain("Incomplete registration details.");
    expect(rejected).toContain("https://hub.sunkvalue.com/request-access");
    expect(rejected).not.toMatch(/undefined|null/);
    const approved = await text(
      React.createElement(t.component, { decision: "approved", kind: "investor", signInUrl: "https://hub.sunkvalue.com/auth" }),
    );
    expect(approved).toContain("https://hub.sunkvalue.com/auth");
    expect(subjectOf(t, { decision: "approved" })).toContain("Request approved");
  });

  it("auth templates: invite and recovery carry the confirmation link", async () => {
    const url = "https://example.supabase.co/auth/v1/verify?token=x&type=invite";
    expect(await text(React.createElement(InviteEmail, { siteName: "Value Unit", siteUrl: "", confirmationUrl: url }))).toContain(url);
    expect(await text(React.createElement(RecoveryEmail, { siteName: "Value Unit", confirmationUrl: url }))).toContain(url);
  });

  it("email change: works when the previous address is missing", async () => {
    const out = await text(
      React.createElement(EmailChangeEmail, { siteName: "Value Unit", oldEmail: null, email: null, newEmail: "new@example.com", confirmationUrl: "https://x/y" }),
    );
    expect(out).toContain("new@example.com");
    expect(out).not.toMatch(/undefined|null/);
  });
});
