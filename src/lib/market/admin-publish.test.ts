import { beforeEach, describe, expect, it, vi } from "vitest";

// setInstrumentPublished / listAdminInstruments (src/lib/admin/listing.functions.ts):
// platform admins only, one service-role call to set_instrument_published
// (which closes resting orders atomically), stable error codes, audited.

const state = {
  isAdmin: true,
  rpc: { data: null as unknown, error: null as null | { message: string; code?: string } },
  brands: [] as unknown[],
};
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
const audits: Record<string, unknown>[] = [];

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { _middleware: true },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return state.rpc;
    },
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit"]) q[m] = () => q;
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: state.brands, error: null }));
      return q;
    },
  },
}));
vi.mock("@/lib/audit/audit.server", () => ({
  writeAudit: vi.fn(async (_s: unknown, entry: Record<string, unknown>) => {
    audits.push(entry);
  }),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const api: Record<string, unknown> = {
      _validator: undefined as undefined | ((i: unknown) => unknown),
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
          const supabase = {
            rpc: async (name: string, args: { _role?: string }) => {
              if (name === "has_role" && args._role === "platform_admin") return { data: state.isAdmin, error: null };
              throw new Error(`unexpected user rpc ${name}`);
            },
          };
          return h({ data, context: { supabase, userId: "admin-1" } });
        };
      },
    };
    return api;
  },
}));

import { listAdminInstruments, parsePublishInput, setInstrumentPublished } from "@/lib/admin/listing.functions";

const call = <T,>(fn: (i: never) => Promise<T>, data?: unknown) => fn({ data } as never);

beforeEach(() => {
  state.isAdmin = true;
  state.rpc = { data: null, error: null };
  state.brands = [];
  rpcCalls.length = 0;
  audits.length = 0;
});

describe("setInstrumentPublished", () => {
  it("validates input with stable codes", () => {
    expect(parsePublishInput({ symbol: " acm ", published: false })).toEqual({ symbol: "ACM", published: false });
    expect(() => parsePublishInput({ symbol: "a b", published: true })).toThrow(/^INSTRUMENT_NOT_FOUND$/);
    expect(() => parsePublishInput({ symbol: "ACM", published: "yes" })).toThrow(/^INVALID_INPUT$/);
  });

  it("is platform-admin only", async () => {
    state.isAdmin = false;
    await expect(call(setInstrumentPublished, { symbol: "ACM", published: false })).rejects.toThrow(/^FORBIDDEN_ADMIN_REQUIRED$/);
    expect(rpcCalls).toHaveLength(0);
  });

  it("delists through one database call with the verified admin id; the database writes the audit row", async () => {
    state.rpc = {
      data: [{ brand_id: "b-1", company_id: null, symbol: "ACM", published: false, changed: true, cancelled_orders: 3 }],
      error: null,
    };
    await expect(call(setInstrumentPublished, { symbol: "acm", published: false })).resolves.toEqual({
      symbol: "ACM",
      published: false,
      changed: true,
      cancelledOrders: 3,
    });
    expect(rpcCalls).toEqual([
      { name: "set_instrument_published", args: { _symbol: "ACM", _published: false, _actor_id: "admin-1" } },
    ]);
    // set_instrument_published inserts the brand.unpublish audit_log row in
    // the same transaction: no second, best-effort write from the server.
    expect(audits).toHaveLength(0);
  });

  it("passes engine codes through and hides everything else", async () => {
    state.rpc = { data: null, error: { message: "INVALID_PRICE" } };
    await expect(call(setInstrumentPublished, { symbol: "ACM", published: true })).rejects.toThrow(/^INVALID_PRICE$/);
    state.rpc = { data: null, error: { message: "INSTRUMENT_NOT_FOUND" } };
    await expect(call(setInstrumentPublished, { symbol: "ACM", published: true })).rejects.toThrow(/^INSTRUMENT_NOT_FOUND$/);
    state.rpc = { data: null, error: { message: "SHARIAH_RULING_REQUIRED" } };
    await expect(call(setInstrumentPublished, { symbol: "ACM", published: true })).rejects.toThrow(/^SHARIAH_RULING_REQUIRED$/);
    state.rpc = { data: null, error: { message: 'relation "brands" does not exist', code: "42P01" } };
    await expect(call(setInstrumentPublished, { symbol: "ACM", published: true })).rejects.toThrow(/^INTERNAL_ERROR$/);
    state.rpc = { data: [], error: null };
    await expect(call(setInstrumentPublished, { symbol: "ACM", published: true })).rejects.toThrow(/^INTERNAL_ERROR$/);
    expect(audits).toHaveLength(0);
  });
});

describe("listAdminInstruments", () => {
  it("labels where each instrument came from", async () => {
    state.brands = [
      { symbol: "2222", slug: "2222", name_ar: "a", name_en: "A", asset_class: "stock", reference_price: "28.4", published: false, company_id: null, source_submission_id: null },
      { symbol: "ACM", slug: "acm", name_ar: "b", name_en: "B", asset_class: "brand", reference_price: 50, published: true, company_id: "c-1", source_submission_id: "s-1" },
      { symbol: "CO1", slug: "co1", name_ar: "c", name_en: "C", asset_class: "brand", reference_price: 10, published: true, company_id: "c-1", source_submission_id: null },
    ];
    const rows = await call(listAdminInstruments);
    expect(rows.map((r) => [r.symbol, r.origin, r.published, r.referencePrice])).toEqual([
      ["2222", "demo_seed", false, 28.4],
      ["ACM", "submission", true, 50],
      ["CO1", "company", true, 10],
    ]);
    state.isAdmin = false;
    await expect(call(listAdminInstruments)).rejects.toThrow(/^FORBIDDEN_ADMIN_REQUIRED$/);
  });
});
