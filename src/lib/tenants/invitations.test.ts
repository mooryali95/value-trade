import { describe, it, expect, vi, beforeEach } from "vitest";

// We exercise the acceptInvitation server function's error surface plus the
// revokeInvitation status filter by mocking the auth-middleware context so
// no real Supabase is required.

type Row = { id: string; status: string; email: string; expires_at: string };

const state: { rows: Row[]; lastRpc?: { name: string; args: unknown } } = { rows: [] };

function makeQuery(rows: Row[]) {
  const build = (currentRows: Row[]) => {
    const chain: {
      _filter: { col: string; val: unknown }[];
      _patch?: Partial<Row>;
      eq: (col: string, val: unknown) => typeof chain;
      update: (patch: Partial<Row>) => typeof chain;
      select: () => typeof chain;
      single: () => Promise<{ data: Row | null; error: null | { message: string } }>;
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => Promise<unknown>;
    } = {
      _filter: [],
      eq(col, val) { this._filter.push({ col, val }); return this; },
      update(patch) { this._patch = patch; return this; },
      select() { return this; },
      async single() {
        const match = currentRows.find((r) => this._filter.every((f) => (r as unknown as Record<string, unknown>)[f.col] === f.val));
        if (!match) return { data: null, error: { message: "not found" } };
        return { data: match, error: null };
      },
      then(resolve) {
        const filtered = currentRows.filter((r) => this._filter.every((f) => (r as unknown as Record<string, unknown>)[f.col] === f.val));
        if (this._patch) {
          for (const r of filtered) Object.assign(r, this._patch);
        }
        return Promise.resolve(resolve({ data: filtered, error: null }));
      },
    };
    return chain;
  };
  return { from: (_t: string) => build(rows) };
}

const supabaseMock = {
  ...makeQuery(state.rows),
  rpc: vi.fn(async (name: string, args: unknown) => {
    state.lastRpc = { name, args };
    if (name === "is_company_owner") return { data: true, error: null };
    if (name === "accept_company_invitation") {
      const token = (args as { _token: string })._token;
      const invite = state.rows.find((r) => (r as unknown as Record<string, unknown>).token === token);
      if (!invite) return { data: null, error: { message: "INVITATION_NOT_FOUND" } };
      if (invite.status === "revoked") return { data: null, error: { message: "INVITATION_NOT_PENDING" } };
      if (invite.status === "expired" || new Date(invite.expires_at) < new Date()) {
        invite.status = "expired";
        return { data: null, error: { message: "INVITATION_EXPIRED" } };
      }
      if (invite.status !== "pending") return { data: null, error: { message: "INVITATION_NOT_PENDING" } };
      invite.status = "accepted";
      return { data: "co-1", error: null };
    }
    return { data: null, error: null };
  }),
};

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: {
    _middleware: true,
    server: () => ({
      // no-op
    }),
  },
}));

// Replace the createServerFn behavior with a light shim that runs .handler() directly.
vi.mock("@tanstack/react-start", () => {
  return {
    createServerFn: () => {
      const api: {
        _mw: unknown[];
        _validator?: (i: unknown) => unknown;
        _handler?: (ctx: { data: unknown; context: unknown }) => unknown;
        middleware: (m: unknown[]) => typeof api;
        inputValidator: (v: (i: unknown) => unknown) => typeof api;
        handler: (h: (ctx: { data: unknown; context: unknown }) => unknown) => (input: { data?: unknown }) => Promise<unknown>;
      } = {
        _mw: [],
        middleware(m) { this._mw = m; return this; },
        inputValidator(v) { this._validator = v; return this; },
        handler(h) {
          this._handler = h;
          return async (input?: { data?: unknown }) => {
            const data = this._validator ? this._validator(input?.data) : input?.data;
            return h({ data, context: { supabase: supabaseMock, userId: "user-1" } });
          };
        },
      };
      return api;
    },
  };
});

// Import after mocks are registered.
import { acceptInvitation, revokeInvitation } from "./invitations.functions";

describe("invitation lifecycle guards", () => {
  beforeEach(() => {
    state.rows.length = 0;
  });

  it("rejects an expired invitation with INVITATION_EXPIRED", async () => {
    state.rows.push({
      id: "i1",
      status: "pending",
      email: "user@example.com",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (state.rows[0] as any).token = "00000000-0000-0000-0000-000000000001";

    await expect(
      acceptInvitation({ data: { token: "00000000-0000-0000-0000-000000000001" } }),
    ).rejects.toThrow(/INVITATION_EXPIRED/);

    expect(state.rows[0].status).toBe("expired");
  });

  it("rejects a revoked invitation with INVITATION_NOT_PENDING", async () => {
    state.rows.push({
      id: "i2",
      status: "revoked",
      email: "user@example.com",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (state.rows[0] as any).token = "00000000-0000-0000-0000-000000000002";

    await expect(
      acceptInvitation({ data: { token: "00000000-0000-0000-0000-000000000002" } }),
    ).rejects.toThrow(/INVITATION_NOT_PENDING/);
  });

  it("after revoke, a subsequent accept is blocked", async () => {
    state.rows.push({
      id: "00000000-0000-0000-0000-0000000000i3".replace("i3", "0a3"),
      status: "pending",
      email: "user@example.com",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (state.rows[0] as any).token = "00000000-0000-0000-0000-000000000003";

    await revokeInvitation({ data: { invitationId: state.rows[0].id } });
    expect(state.rows[0].status).toBe("revoked");

    await expect(
      acceptInvitation({ data: { token: "00000000-0000-0000-0000-000000000003" } }),
    ).rejects.toThrow(/INVITATION_NOT_PENDING/);
  });

  it("accepts a pending, non-expired invitation once", async () => {
    state.rows.push({
      id: "i4",
      status: "pending",
      email: "user@example.com",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (state.rows[0] as any).token = "00000000-0000-0000-0000-000000000004";

    const res = (await acceptInvitation({ data: { token: "00000000-0000-0000-0000-000000000004" } })) as { companyId: string };
    expect(res.companyId).toBe("co-1");
    expect(state.rows[0].status).toBe("accepted");

    // A second accept must fail because status is no longer pending.
    await expect(
      acceptInvitation({ data: { token: "00000000-0000-0000-0000-000000000004" } }),
    ).rejects.toThrow(/INVITATION_NOT_PENDING/);
  });
});