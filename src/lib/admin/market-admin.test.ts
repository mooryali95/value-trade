import { beforeEach, describe, expect, it, vi } from "vitest";

// Server functions of the private market's admin tools and reviewer queues,
// run through a light createServerFn shim with mocked Supabase clients.

const state = {
  isAdmin: true,
  isReviewer: true,
  adminRpc: { data: null as unknown, error: null as null | { message: string; code?: string } },
  userRows: {} as Record<string, unknown[]>,
  adminRows: {} as Record<string, unknown[]>,
  userErrors: {} as Record<string, { code: string; message: string }>,
};
type Write = { op: string; table: string; payload: unknown };
const adminCalls: { rpc: { name: string; args: Record<string, unknown> }[]; tables: string[]; writes: string[]; payloads: Write[] } = {
  rpc: [],
  tables: [],
  writes: [],
  payloads: [],
};
const userCalls: { writes: string[]; payloads: Write[] } = { writes: [], payloads: [] };

function query(
  rows: unknown[],
  writes?: string[],
  table?: string,
  payloads?: Write[],
  error: { code: string; message: string } | null = null,
) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "order", "limit", "range", "or"]) q[m] = () => q;
  for (const m of ["insert", "update", "upsert", "delete"]) {
    q[m] = (payload?: unknown) => {
      writes?.push(`${m}:${table}`);
      payloads?.push({ op: m, table: table ?? "", payload });
      return q;
    };
  }
  q.maybeSingle = async () => ({ data: rows[0] ?? null, error });
  q.single = async () => ({ data: rows[0] ?? null, error });
  q.then = (resolve: (v: { data: unknown[] | null; error: unknown }) => unknown) =>
    Promise.resolve(resolve({ data: error ? null : rows, error }));
  return q;
}

const supabaseMock = {
  rpc: vi.fn(async (name: string, args: { _role?: string }) => {
    if (name === "has_role") return { data: args._role === "platform_admin" ? state.isAdmin : state.isReviewer, error: null };
    throw new Error(`unexpected user rpc ${name}`);
  }),
  from: (table: string) =>
    query(state.userRows[table] ?? [], userCalls.writes, table, userCalls.payloads, state.userErrors[table] ?? null),
};

const supabaseAdmin = {
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    adminCalls.rpc.push({ name, args });
    return state.adminRpc;
  }),
  from: (table: string) => {
    adminCalls.tables.push(table);
    return query(state.adminRows[table] ?? [], adminCalls.writes, table, adminCalls.payloads);
  },
  auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: "invitee@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" } }, error: null }) } },
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
import {
  issueUnits,
  parseIssueUnitsInput,
  parseReferencePriceInput,
  setInstrumentPublished,
  setReferencePrice,
} from "./listing.functions";
import { listPendingSubmissions, parseSubmitInput, reviewSubmission } from "@/lib/submissions/submissions.functions";
import { listShariahDecisions } from "@/lib/trading/shariah.functions";
import { writeAudit } from "@/lib/audit/audit.server";
import { listMyInvitations } from "@/lib/tenants/invitations.functions";

const USER = "3f1d6a5e-2b1c-4c8e-9a47-0c2f5d8e1b7a";
const call = <T,>(fn: (i: never) => Promise<T>, data?: unknown) => fn({ data } as never);

beforeEach(() => {
  state.isAdmin = true;
  state.isReviewer = true;
  state.adminRpc = { data: null, error: null };
  state.userRows = {};
  state.adminRows = {};
  state.userErrors = {};
  adminCalls.rpc.length = 0;
  adminCalls.tables.length = 0;
  adminCalls.writes.length = 0;
  adminCalls.payloads.length = 0;
  userCalls.writes.length = 0;
  userCalls.payloads.length = 0;
  vi.mocked(writeAudit).mockClear();
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

  it("setReferencePrice needs a platform admin and goes through set_reference_price (audited in SQL)", async () => {
    state.isAdmin = false;
    await expect(call(setReferencePrice, { symbol: "ACM", price: 10 })).rejects.toThrow(/^FORBIDDEN_ADMIN_REQUIRED$/);
    expect(adminCalls.rpc).toHaveLength(0);
    state.isAdmin = true;
    state.adminRpc = { data: null, error: { message: "INSTRUMENT_NOT_FOUND" } };
    await expect(call(setReferencePrice, { symbol: "ACM", price: 10 })).rejects.toThrow(/^INSTRUMENT_NOT_FOUND$/);
    state.adminRpc = { data: null, error: { message: "INVALID_PRICE" } };
    await expect(call(setReferencePrice, { symbol: "ACM", price: 10 })).rejects.toThrow(/^INVALID_PRICE$/);
    state.adminRpc = { data: null, error: { message: 'permission denied for table brands', code: "42501" } };
    await expect(call(setReferencePrice, { symbol: "ACM", price: 10 })).rejects.toThrow(/^INTERNAL_ERROR$/);
    state.adminRpc = { data: [{ brand_id: "b-1", symbol: "ACM", previous_price: 100, reference_price: 10, changed: true }], error: null };
    adminCalls.rpc.length = 0;
    await expect(call(setReferencePrice, { symbol: "acm", price: 10 })).resolves.toEqual({ symbol: "ACM", referencePrice: 10 });
    expect(adminCalls.rpc[0]).toMatchObject({ name: "set_reference_price", args: { _symbol: "ACM", _price: 10, _actor_id: "admin-1" } });
    // No direct table write, and the audit row is written by the SQL function.
    expect(adminCalls.writes).not.toContain("update:brands");
    expect(vi.mocked(writeAudit)).not.toHaveBeenCalled();
  });
});

describe("queues that cross company boundaries", () => {
  it("reviewer queue keeps submissions of companies the reviewer is not a member of", async () => {
    // Read with the service role after the reviewer / admin check.
    state.adminRows.product_submissions = [
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
    // Read with the service role for the caller's own confirmed address (not the JWT email claim).
    state.adminRows.company_invitations = [
      { id: "i-1", role: "owner", token: "t", status: "pending", company_id: "co-9", expires_at: "2999-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
    ];
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

describe("listing truth: approval, publishing, rulings", () => {
  const SUB_ID = "7a1d6a5e-2b1c-4c8e-9a47-0c2f5d8e1b7a";

  it("approval is one database call (instrument, ruling and status together), with the verified reviewer id", async () => {
    state.adminRpc = {
      data: [{ submission_id: SUB_ID, status: "approved", symbol: "ACM", brand_id: "b-1", ruling_id: "d-1", ruling_recorded: true, previous_ruling: null }],
      error: null,
    };
    await expect(call(reviewSubmission, { submissionId: SUB_ID, status: "approved" })).resolves.toEqual({
      ok: true,
      status: "approved",
      symbol: "ACM",
      rulingRecorded: true,
    });
    expect(adminCalls.rpc).toEqual([
      {
        name: "review_submission",
        args: { _submission_id: SUB_ID, _reviewer_id: "admin-1", _decision: "approved", _reason: null, _replace_ruling: false },
      },
    ]);
    // No separate brand, ruling or status writes that could half-apply.
    expect(adminCalls.writes).toEqual([]);
    expect(userCalls.writes).toEqual([]);
  });

  it("an existing non-compliant ruling is never overridden silently", async () => {
    state.adminRpc = { data: null, error: { message: "SHARIAH_RULING_CONFLICT" } };
    await expect(call(reviewSubmission, { submissionId: SUB_ID, status: "approved" })).rejects.toThrow(/^SHARIAH_RULING_CONFLICT$/);
    state.adminRpc = { data: null, error: { message: 'duplicate key value violates unique constraint "brands_slug_key"', code: "23505" } };
    await expect(call(reviewSubmission, { submissionId: SUB_ID, status: "approved" })).rejects.toThrow(/^SYMBOL_TAKEN$/);
    state.adminRpc = { data: null, error: { message: 'relation "x" does not exist' } };
    await expect(call(reviewSubmission, { submissionId: SUB_ID, status: "approved" })).rejects.toThrow(/^INTERNAL_ERROR$/);
  });

  it("a rejection needs a reason, and only a Shariah reviewer decides", async () => {
    await expect(call(reviewSubmission, { submissionId: SUB_ID, status: "rejected", reason: "short" })).rejects.toThrow(/^REJECTION_REASON_REQUIRED$/);
    state.isReviewer = false;
    await expect(call(reviewSubmission, { submissionId: SUB_ID, status: "rejected", reason: "Documents are incomplete." })).rejects.toThrow(/^FORBIDDEN$/);
    expect(adminCalls.rpc).toEqual([]);
  });

  it("publishing is audited by the database function, not by a second best-effort write", async () => {
    state.adminRpc = {
      data: [{ brand_id: "b-1", company_id: null, symbol: "ACM", published: true, changed: true, cancelled_orders: 0 }],
      error: null,
    };
    await expect(call(setInstrumentPublished, { symbol: "acm", published: true })).resolves.toEqual({
      symbol: "ACM",
      published: true,
      changed: true,
      cancelledOrders: 0,
    });
    expect(writeAudit).not.toHaveBeenCalled();
    state.adminRpc = { data: null, error: { message: "SHARIAH_RULING_REQUIRED" } };
    await expect(call(setInstrumentPublished, { symbol: "ACM", published: true })).rejects.toThrow(/^SHARIAH_RULING_REQUIRED$/);
  });

  it("the rulings console is for Shariah reviewers and platform admins, and reports database errors", async () => {
    state.isReviewer = false;
    state.isAdmin = false;
    await expect(call(listShariahDecisions)).rejects.toThrow(/^FORBIDDEN$/);
    state.isAdmin = true;
    state.userRows.shariah_decisions = [{ id: "d-1", symbol: "ACM", status: "halal" }];
    await expect(call(listShariahDecisions)).resolves.toHaveLength(1);
    state.userErrors.shariah_decisions = { code: "57014", message: "canceling statement due to statement timeout" };
    await expect(call(listShariahDecisions)).rejects.toThrow(/^INTERNAL_ERROR$/);
  });
});
