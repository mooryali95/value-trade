import { beforeEach, describe, expect, it, vi } from "vitest";

// Server functions of the private market's admin tools and reviewer queues,
// run through a light createServerFn shim with mocked Supabase clients.

const state = {
  isAdmin: true,
  isReviewer: true,
  adminRpc: { data: null as unknown, error: null as null | { message: string; code?: string } },
  userRows: {} as Record<string, unknown[]>,
  adminRows: {} as Record<string, unknown[]>,
};
const adminCalls: { rpc: { name: string; args: Record<string, unknown> }[]; tables: string[]; writes: string[] } = {
  rpc: [],
  tables: [],
  writes: [],
};

function query(rows: unknown[], writes?: string[], table?: string) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "order", "limit", "range", "or"]) q[m] = () => q;
  for (const m of ["insert", "update", "upsert", "delete"]) {
    q[m] = () => {
      writes?.push(`${m}:${table}`);
      return q;
    };
  }
  q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  q.single = async () => ({ data: rows[0] ?? null, error: null });
  q.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve(resolve({ data: rows, error: null }));
  return q;
}

const supabaseMock = {
  rpc: vi.fn(async (name: string, args: { _role?: string }) => {
    if (name === "has_role") return { data: args._role === "platform_admin" ? state.isAdmin : state.isReviewer, error: null };
    throw new Error(`unexpected user rpc ${name}`);
  }),
  from: (table: string) => query(state.userRows[table] ?? []),
};

const supabaseAdmin = {
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    adminCalls.rpc.push({ name, args });
    return state.adminRpc;
  }),
  from: (table: string) => {
    adminCalls.tables.push(table);
    return query(state.adminRows[table] ?? [], adminCalls.writes, table);
  },
  auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id } }, error: null }) } },
};

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { _middleware: true, server: () => ({}) },
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
vi.mock("@/lib/audit/audit.server", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/security/rate-limit.server", () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const api: Record<string, unknown> = {
      _validator: undefined as undefined | ((i: unknown) => unknown),
      middleware() { return api; },
      inputValidator(v: (i: unknown) => unknown) { api._validator = v; return api; },
      handler(h: (ctx: { data: unknown; context: unknown }) => unknown) {
        return async (input?: { data?: unknown }) => {
          const validator = api._validator as ((i: unknown) => unknown) | undefined;
          const data = validator ? validator(input?.data) : input?.data;
          return h({ data, context: { supabase: supabaseMock, userId: "admin-1", claims: { sub: "admin-1" } } });
        };
      },
    };
    return api;
  },
}));

import { setTraderRole } from "./investors.functions";
import { issueUnits, parseIssueUnitsInput, parseReferencePriceInput, setReferencePrice } from "./listing.functions";
import { listPendingSubmissions, parseSubmitInput } from "@/lib/submissions/submissions.functions";
import { listMyInvitations } from "@/lib/tenants/invitations.functions";

const USER = "3f1d6a5e-2b1c-4c8e-9a47-0c2f5d8e1b7a";
const call = <T,>(fn: (i: never) => Promise<T>, data?: unknown) => fn({ data } as never);

beforeEach(() => {
  state.isAdmin = true;
  state.isReviewer = true;
  state.adminRpc = { data: null, error: null };
  state.userRows = {};
  state.adminRows = {};
  adminCalls.rpc.length = 0;
  adminCalls.tables.length = 0;
  adminCalls.writes.length = 0;
});

describe("setTraderRole", () => {
  it("deactivation revokes the role and cancels open orders in one database call", async () => {
    state.adminRpc = { data: 3, error: null };
    const res = await call(setTraderRole, { userId: USER, active: false });
    expect(res).toEqual({ userId: USER, tradingActive: false, cancelledOrders: 3 });
    expect(adminCalls.rpc).toEqual([{ name: "deactivate_trader", args: { _user_id: USER, _actor_id: "admin-1" } }]);
    // No separate role delete that could leave resting orders behind.
    expect(adminCalls.writes).not.toContain("delete:user_roles");
  });

  it("maps a database failure to a stable code", async () => {
    state.adminRpc = { data: null, error: { message: "deadlock detected", code: "40P01" } };
    await expect(call(setTraderRole, { userId: USER, active: false })).rejects.toThrow(/^INTERNAL_ERROR$/);
  });

  it("activation grants the role and records the review of any launch hold", async () => {
    const res = await call(setTraderRole, { userId: USER, active: true });
    expect(res).toMatchObject({ tradingActive: true, cancelledOrders: 0 });
    expect(adminCalls.writes).toEqual(expect.arrayContaining(["upsert:user_roles", "update:launch_review_holds"]));
  });

  it("is platform-admin only", async () => {
    state.isAdmin = false;
    await expect(call(setTraderRole, { userId: USER, active: false })).rejects.toThrow(/^FORBIDDEN_ADMIN_REQUIRED$/);
    expect(adminCalls.rpc).toHaveLength(0);
  });
});

describe("listing tools", () => {
  it("validates inputs with stable codes", () => {
    expect(parseReferencePriceInput({ symbol: "acm", price: 12.5 })).toEqual({ symbol: "ACM", price: 12.5 });
    expect(() => parseReferencePriceInput({ symbol: "a b", price: 1 })).toThrow(/^INSTRUMENT_NOT_FOUND$/);
    expect(() => parseReferencePriceInput({ symbol: "ACM", price: 1.005 })).toThrow(/^INVALID_PRICE$/);
    expect(() => parseReferencePriceInput({ symbol: "ACM", price: 0 })).toThrow(/^INVALID_PRICE$/);
    expect(() => parseIssueUnitsInput({ userId: USER, symbol: "ACM", qty: 1.5, price: 10 })).toThrow(/^INVALID_QTY$/);
    expect(() => parseIssueUnitsInput({ userId: "x", symbol: "ACM", qty: 1, price: 10 })).toThrow(/^USER_NOT_FOUND$/);
    expect(parseIssueUnitsInput({ userId: USER, symbol: "acm", qty: 5, price: 10, note: "  " })).toEqual({
      userId: USER, symbol: "ACM", qty: 5, price: 10,
    });
  });

  it("issueUnits calls issue_units for the verified admin and passes engine codes through", async () => {
    state.adminRpc = { data: "iss-1", error: null };
    const res = await call(issueUnits, { userId: USER, symbol: "acm", qty: 100, price: 25 });
    expect(res).toEqual({ issuanceId: "iss-1", symbol: "ACM", qty: 100 });
    expect(adminCalls.rpc[0]).toMatchObject({ name: "issue_units", args: { _actor_id: "admin-1", _user_id: USER, _symbol: "ACM", _qty: 100, _price: 25 } });

    state.adminRpc = { data: null, error: { message: "INSTRUMENT_NOT_FOUND" } };
    await expect(call(issueUnits, { userId: USER, symbol: "NOPE", qty: 1, price: 1 })).rejects.toThrow(/^INSTRUMENT_NOT_FOUND$/);
    state.adminRpc = { data: null, error: { message: 'relation "x" does not exist' } };
    await expect(call(issueUnits, { userId: USER, symbol: "ACM", qty: 1, price: 1 })).rejects.toThrow(/^INTERNAL_ERROR$/);
  });

  it("setReferencePrice needs a platform admin and an existing instrument", async () => {
    state.isAdmin = false;
    await expect(call(setReferencePrice, { symbol: "ACM", price: 10 })).rejects.toThrow(/^FORBIDDEN_ADMIN_REQUIRED$/);
    state.isAdmin = true;
    await expect(call(setReferencePrice, { symbol: "ACM", price: 10 })).rejects.toThrow(/^INSTRUMENT_NOT_FOUND$/);
    state.adminRows.brands = [{ id: "b-1", reference_price: 100, company_id: null }];
    await expect(call(setReferencePrice, { symbol: "acm", price: 10 })).resolves.toEqual({ symbol: "ACM", referencePrice: 10 });
    expect(adminCalls.writes).toContain("update:brands");
  });
});

describe("queues that cross company boundaries", () => {
  it("reviewer queue keeps submissions of companies the reviewer is not a member of", async () => {
    state.userRows.product_submissions = [
      { id: "s-1", company_id: "co-1", symbol: "ACM", status: "pending" },
      { id: "s-2", company_id: "co-2", symbol: "BRV", status: "pending" },
    ];
    state.adminRows.companies = [{ id: "co-1", name_ar: "أ", name_en: "Acme", slug: "acme" }];
    const rows = (await call(listPendingSubmissions)) as { id: string; companies: { name_en: string } | null }[];
    expect(rows.map((r) => r.id)).toEqual(["s-1", "s-2"]);
    expect(rows[0].companies?.name_en).toBe("Acme");
    expect(rows[1].companies).toBeNull();
  });

  it("invitee sees an invitation to a company they cannot read yet", async () => {
    state.userRows.company_invitations = [{ id: "i-1", role: "owner", token: "t", status: "pending", company_id: "co-9" }];
    state.adminRows.companies = [{ id: "co-9", name_ar: "ج", name_en: "NewCo", slug: "newco" }];
    const rows = (await call(listMyInvitations)) as { id: string; companies: { slug: string } | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].companies?.slug).toBe("newco");
  });

  it("submitProduct input errors are stable codes, not a validation dump", () => {
    const base = { companyId: USER, asset_class: "brand", symbol: "ACM", name_ar: "a", name_en: "a" };
    expect(parseSubmitInput(base).symbol).toBe("ACM");
    expect(() => parseSubmitInput({ ...base, symbol: "AC M" })).toThrow(/^INVALID_SYMBOL$/);
    expect(() => parseSubmitInput({ ...base, name_en: "" })).toThrow(/^INVALID_INPUT$/);
  });
});
