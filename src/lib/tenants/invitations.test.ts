import { describe, it, expect, vi, beforeEach } from "vitest";

// Invitation server functions, run through a light createServerFn shim with
// a mocked service-role client. The SQL functions themselves are covered by
// supabase/tests/extra/r_onboarding.sh; these tests pin what the server adds
// on top: the confirmed-address rule, canonical links, permission checks,
// rate limits and stable error codes.

type Account = { id: string; email: string | null; email_confirmed_at: string | null };
type Invite = {
  id: string;
  company_id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  expires_at: string;
  created_at: string;
  invited_by: string;
};

const state = {
  account: { id: "user-1", email: "user@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" } as Account,
  owner: true,
  admin: false,
  invites: [] as Invite[],
  rpcError: null as null | { message: string; code?: string },
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  inviteUserError: null as null | { status?: number; code?: string; message?: string },
  authCalls: [] as { kind: string; email: string; redirectTo?: string }[],
};

const future = () => new Date(Date.now() + 3 * 86400_000).toISOString();
const past = () => new Date(Date.now() - 60_000).toISOString();

function invite(over: Partial<Invite> = {}): Invite {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    company_id: "00000000-0000-4000-8000-0000000000c1",
    email: "user@example.com",
    role: "viewer",
    token: "00000000-0000-4000-8000-000000000001",
    status: "pending",
    expires_at: future(),
    created_at: new Date().toISOString(),
    invited_by: "owner-1",
    ...over,
  };
}

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "in", "gt"]) q[m] = () => q;
  q.eq = (col: string, val: unknown) => {
    filters.push([col, val]);
    return q;
  };
  const rows = () =>
    (table === "company_invitations" ? state.invites : table === "companies" ? [{ id: "00000000-0000-4000-8000-0000000000c1", name_ar: "أكمي", name_en: "Acme", slug: "acme" }] : []).filter(
      (r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v),
    );
  q.update = (patch: Record<string, unknown>) => {
    q.then = (resolve: (v: unknown) => unknown) => {
      const hit = rows();
      for (const r of hit) Object.assign(r, patch);
      return Promise.resolve(resolve({ data: hit.map((r) => ({ id: (r as Invite).id })), error: null }));
    };
    return q;
  };
  // Reads return copies, as a real client would.
  q.maybeSingle = async () => ({ data: rows()[0] ? { ...rows()[0] } : null, error: null });
  q.single = async () => ({ data: rows()[0] ? { ...rows()[0] } : null, error: null });
  if (!q.then) q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: rows().map((r) => ({ ...r })), error: null }));
  return q;
}

const supabaseAdmin = {
  from: (table: string) => query(table),
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ name, args });
    if (name === "is_company_owner") return { data: state.owner, error: null };
    if (name === "has_role") return { data: state.admin, error: null };
    if (name === "company_has_member_email") return { data: false, error: null };
    if (state.rpcError) return { data: null, error: state.rpcError };
    if (name === "accept_company_invitation") return { data: "00000000-0000-4000-8000-0000000000c1", error: null };
    if (name === "renew_company_invitation") {
      const inv = state.invites.find((i) => i.id === args._invitation_id)!;
      if (args._rotate_token) inv.token = "00000000-0000-4000-8000-0000000000ff";
      inv.expires_at = future();
      inv.status = "pending";
      return { data: inv, error: null };
    }
    if (name === "create_company_invitation") {
      const inv = invite({ email: String(args._email), role: String(args._role) });
      state.invites.push(inv);
      return { data: inv, error: null };
    }
    if (name === "invitation_preview") {
      const inv = state.invites.find((i) => i.token === args._token);
      if (!inv) return { data: [], error: null };
      const status = inv.status === "pending" && new Date(inv.expires_at).getTime() <= Date.now() ? "expired" : inv.status;
      return {
        data: [{ invitation_id: inv.id, company_id: inv.company_id, company_name_ar: "أكمي", company_name_en: "Acme", email: inv.email, role: inv.role, status, expires_at: inv.expires_at }],
        error: null,
      };
    }
    return { data: null, error: null };
  }),
  auth: {
    admin: {
      getUserById: async (id: string) => ({
        data: { user: id === state.account.id ? { ...state.account } : null },
        error: null,
      }),
      inviteUserByEmail: async (email: string, opts: { redirectTo?: string }) => {
        state.authCalls.push({ kind: "invite", email, redirectTo: opts.redirectTo });
        return { data: {}, error: state.inviteUserError };
      },
    },
    resetPasswordForEmail: async (email: string, opts: { redirectTo?: string }) => {
      state.authCalls.push({ kind: "recovery", email, redirectTo: opts.redirectTo });
      return { data: {}, error: null };
    },
  },
};

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { _middleware: true, server: () => ({}) },
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
vi.mock("@/lib/audit/audit.server", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("https://hub.sunkvalue.com/x", { headers: { "cf-connecting-ip": "203.0.113.9" } }),
}));

const rateLimit = { allow: true };
vi.mock("@/lib/security/rate-limit.server", () => ({
  checkRateLimit: vi.fn(async () => rateLimit.allow),
  clientKeyFromRequest: (_r: Request, scope: string) => `${scope}:ip`,
}));

const sentInvites: { acceptUrl: string; email: string }[] = [];
vi.mock("./invitation-email.server", () => ({
  maskEmail: (e: string) => `${e[0]}***@${e.slice(e.lastIndexOf("@") + 1)}`,
  sendInvitationEmailBestEffort: vi.fn(async (input: { acceptUrl: string; email: string }) => {
    sentInvites.push(input);
    return { sent: true, provider: "lovable", messageId: "m-1" };
  }),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const api: Record<string, unknown> = {
      middleware() {
        return api;
      },
      inputValidator(v: (i: unknown) => unknown) {
        api._validator = v;
        return api;
      },
      handler(h: (ctx: { data: unknown; context: unknown }) => unknown) {
        return async (input?: { data?: unknown }) => {
          const validator = api._validator as ((i: unknown) => unknown) | undefined;
          const data = validator ? validator(input?.data) : input?.data;
          return h({
            data,
            context: {
              supabase: supabaseAdmin,
              userId: "user-1",
              // The JWT claim is deliberately different from the account's
              // own address: the server must not trust it.
              claims: { sub: "user-1", email: "someone-else@example.com" },
            },
          });
        };
      },
    };
    return api;
  },
}));

import {
  acceptInvitation,
  createInvitation,
  getInvitationPreview,
  listMyInvitations,
  resendInvitationEmail,
  revokeInvitation,
  sendInvitationAccountLink,
} from "./invitations.functions";

const TOKEN = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  state.account = { id: "user-1", email: "user@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
  state.owner = true;
  state.admin = false;
  state.invites.length = 0;
  state.rpcError = null;
  state.rpcCalls.length = 0;
  state.inviteUserError = null;
  state.authCalls.length = 0;
  sentInvites.length = 0;
  rateLimit.allow = true;
  delete process.env.APP_ORIGIN;
  delete process.env.PUBLIC_SITE_URL;
  delete process.env.PUBLIC_APP_ORIGIN;
});

describe("acceptInvitation", () => {
  it("passes the account's own address (auth.users), never the JWT email claim", async () => {
    const res = await acceptInvitation({ data: { token: TOKEN } });
    expect(res).toEqual({ companyId: "00000000-0000-4000-8000-0000000000c1" });
    const call = state.rpcCalls.find((c) => c.name === "accept_company_invitation");
    expect(call?.args).toEqual({ _token: TOKEN, _actor_id: "user-1", _actor_email: "user@example.com" });
  });

  it("requires a confirmed e-mail address", async () => {
    state.account.email_confirmed_at = null;
    await expect(acceptInvitation({ data: { token: TOKEN } })).rejects.toThrow(/^EMAIL_NOT_CONFIRMED$/);
    expect(state.rpcCalls.some((c) => c.name === "accept_company_invitation")).toBe(false);
  });

  it("passes SQL codes through and hides anything else", async () => {
    state.rpcError = { message: "INVITATION_EXPIRED" };
    await expect(acceptInvitation({ data: { token: TOKEN } })).rejects.toThrow(/^INVITATION_EXPIRED$/);
    state.rpcError = { message: "ALREADY_MEMBER" };
    await expect(acceptInvitation({ data: { token: TOKEN } })).rejects.toThrow(/^ALREADY_MEMBER$/);
    state.rpcError = { message: 'duplicate key value violates unique constraint "x"', code: "23505" };
    await expect(acceptInvitation({ data: { token: TOKEN } })).rejects.toThrow(/^INTERNAL_ERROR$/);
  });
});

describe("listMyInvitations", () => {
  it("refuses an unconfirmed account (an invitation token is a credential)", async () => {
    state.account.email_confirmed_at = null;
    state.invites.push(invite());
    await expect(listMyInvitations()).rejects.toThrow(/^EMAIL_NOT_CONFIRMED$/);
  });

  it("lists pending invitations to the confirmed address and flags expired ones", async () => {
    state.invites.push(invite(), invite({ id: "00000000-0000-4000-8000-0000000000a2", token: "t2", expires_at: past() }), invite({ id: "x3", email: "other@example.com" }));
    const rows = await listMyInvitations();
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ["00000000-0000-4000-8000-0000000000a1", "pending"],
      ["00000000-0000-4000-8000-0000000000a2", "expired"],
    ]);
    expect(rows[0].companies?.slug).toBe("acme");
  });
});

describe("company-side management", () => {
  it("owners cannot appoint owners; the RPC is not called", async () => {
    await expect(
      createInvitation({ data: { companyId: "00000000-0000-4000-8000-0000000000c1", email: "x@example.com", role: "owner" } }),
    ).rejects.toThrow(/^FORBIDDEN$/);
    expect(state.rpcCalls.some((c) => c.name === "create_company_invitation")).toBe(false);
  });

  it("a platform admin who is not a member may invite the owner of a company", async () => {
    state.owner = false;
    state.admin = true;
    const res = await createInvitation({
      data: { companyId: "00000000-0000-4000-8000-0000000000c1", email: " New.Owner@Example.com ", role: "owner" },
    });
    expect(res.invitation.role).toBe("owner");
    expect(state.rpcCalls.find((c) => c.name === "create_company_invitation")?.args._email).toBe("new.owner@example.com");
    expect(sentInvites[0].acceptUrl).toMatch(/^https:\/\/hub\.sunkvalue\.com\/invite\//);
  });

  it("outsiders cannot resend or revoke", async () => {
    state.owner = false;
    state.invites.push(invite());
    await expect(resendInvitationEmail({ data: { invitationId: state.invites[0].id } })).rejects.toThrow(/^FORBIDDEN$/);
    await expect(revokeInvitation({ data: { invitationId: state.invites[0].id } })).rejects.toThrow(/^FORBIDDEN$/);
  });

  it("resend links to the public invitation page on the canonical origin, ignoring a client origin", async () => {
    state.invites.push(invite({ email: "invitee@example.com", token: "00000000-0000-4000-8000-000000000011" }));
    const res = await resendInvitationEmail({ data: { invitationId: state.invites[0].id, origin: "https://evil.example" } });
    expect(sentInvites).toHaveLength(1);
    expect(sentInvites[0].acceptUrl).toBe("https://hub.sunkvalue.com/invite/00000000-0000-4000-8000-000000000011");
    expect(res.reissued).toBe(false);
    expect(state.rpcCalls.find((c) => c.name === "renew_company_invitation")?.args._rotate_token).toBe(false);
  });

  it("re-issue rotates the token and mails the new link", async () => {
    state.invites.push(invite({ expires_at: past() }));
    const res = await resendInvitationEmail({ data: { invitationId: state.invites[0].id, reissue: true } });
    expect(res.reissued).toBe(true);
    expect(res.invitation.status).toBe("pending");
    expect(sentInvites[0].acceptUrl).toBe("https://hub.sunkvalue.com/invite/00000000-0000-4000-8000-0000000000ff");
  });

  it("resend is rate limited with RATE_LIMITED", async () => {
    rateLimit.allow = false;
    state.invites.push(invite());
    await expect(resendInvitationEmail({ data: { invitationId: state.invites[0].id } })).rejects.toThrow(/^RATE_LIMITED$/);
    expect(sentInvites).toHaveLength(0);
  });

  it("revoking a non-pending invitation reports INVITATION_NOT_PENDING", async () => {
    state.invites.push(invite({ status: "accepted" }));
    await expect(revokeInvitation({ data: { invitationId: state.invites[0].id } })).rejects.toThrow(/^INVITATION_NOT_PENDING$/);
  });
});

describe("public invitation page", () => {
  it("masks the invited address and reports the effective status", async () => {
    state.invites.push(invite({ email: "invitee@example.com", expires_at: past() }));
    const res = await getInvitationPreview({ data: { token: TOKEN } });
    expect(res).toMatchObject({ found: true, status: "expired", emailHint: "i***@example.com", companyNameEn: "Acme" });
    expect(JSON.stringify(res)).not.toContain("invitee@example.com");
  });

  it("reveals nothing about a revoked invitation", async () => {
    state.invites.push(invite({ status: "revoked" }));
    const res = await getInvitationPreview({ data: { token: TOKEN } });
    expect(res).toEqual({ found: true, status: "revoked", companyNameAr: null, companyNameEn: null, role: null, emailHint: null, expiresAt: null });
  });

  it("sends the account link to the invited address with a canonical redirect back to the invitation", async () => {
    state.invites.push(invite({ email: "invitee@example.com" }));
    await expect(sendInvitationAccountLink({ data: { token: TOKEN } })).resolves.toEqual({ sent: true });
    expect(state.authCalls).toEqual([
      {
        kind: "invite",
        email: "invitee@example.com",
        redirectTo: `https://hub.sunkvalue.com/auth/update-password?flow=invite&next=${encodeURIComponent(`/invite/${TOKEN}`)}`,
      },
    ]);
  });

  it("falls back to a password link when the address already has an account", async () => {
    state.invites.push(invite({ email: "invitee@example.com" }));
    state.inviteUserError = { status: 422, code: "email_exists", message: "A user with this email address has already been registered" };
    await sendInvitationAccountLink({ data: { token: TOKEN } });
    expect(state.authCalls.map((c) => c.kind)).toEqual(["invite", "recovery"]);
    expect(state.authCalls[1].redirectTo).toContain("/auth/update-password?flow=recovery&next=");
  });

  it("refuses expired invitations and unknown tokens", async () => {
    state.invites.push(invite({ expires_at: past() }));
    await expect(sendInvitationAccountLink({ data: { token: TOKEN } })).rejects.toThrow(/^INVITATION_EXPIRED$/);
    await expect(sendInvitationAccountLink({ data: { token: "00000000-0000-4000-8000-00000000dead" } })).rejects.toThrow(
      /^INVITATION_NOT_FOUND$/,
    );
    expect(state.authCalls).toHaveLength(0);
  });
});
