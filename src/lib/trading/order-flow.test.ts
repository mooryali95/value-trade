import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server side of the order lifecycle: placeOrder / cancelOrder / modifyOrder /
 * restoreOrder only ever call the service-role engine functions with the
 * verified user id, never write through the user's client, map engine errors
 * to stable codes, and fail closed on the Shariah pre-check.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

const state = {
  isTrader: true,
  ruling: { data: null, error: null } as Result,
  order: { data: { id: "o-1", symbol: "NOO001", side: "buy" }, error: null } as Result,
  instrument: { symbol: "NOO001", assetClass: "brand", published: true } as
    | { symbol: string; assetClass: string; published: boolean }
    | null,
  adminRpc: { data: null, error: null } as Result,
};

const userWrites: string[] = [];
const shariahQueries: string[] = [];

function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in"]) {
    b[m] = (...args: unknown[]) => {
      if (table === "shariah_decisions" && m === "order") shariahQueries.push(String(args[0]));
      return b;
    };
  }
  for (const m of ["insert", "update", "upsert", "delete"]) {
    b[m] = () => {
      userWrites.push(`${m}:${table}`);
      return b;
    };
  }
  b.maybeSingle = async () => {
    if (table === "shariah_decisions") return state.ruling;
    if (table === "orders") return state.order;
    if (table === "portfolios") return { data: { cash_balance: 84900 }, error: null };
    return { data: null, error: null };
  };
  return b;
}

const supabaseMock = {
  rpc: vi.fn(async (name: string) => {
    if (name === "has_role") return { data: state.isTrader, error: null };
    throw new Error(`unexpected user rpc ${name}`);
  }),
  from: (table: string) => builder(table),
};

const adminRpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => state.adminRpc);

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { _middleware: true, server: () => ({}) },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (name: string, args: Record<string, unknown>) => adminRpc(name, args) },
}));
vi.mock("@/lib/security/rate-limit.server", () => ({ assertRateLimit: vi.fn(async () => undefined) }));
vi.mock("@/lib/instruments/instrument.server", () => ({ getInstrument: vi.fn(async () => state.instrument) }));

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
          return h({ data, context: { supabase: supabaseMock, userId: "user-1", claims: { sub: "user-1" } } });
        };
      },
    };
    return api;
  },
}));

import { placeOrder } from "./place-order.functions";
import { cancelOrder, modifyOrder, restoreOrder } from "./order-mutations.functions";

const ORDER_ID = "3f1d6a5e-2b1c-4c8e-9a47-0c2f5d8e1b7a";
const call = <T,>(fn: (i: never) => Promise<T>, data: unknown) => fn({ data } as never);

beforeEach(() => {
  state.isTrader = true;
  state.ruling = { data: null, error: null };
  state.order = { data: { id: ORDER_ID, symbol: "NOO001", side: "buy" }, error: null };
  state.instrument = { symbol: "NOO001", assetClass: "brand", published: true };
  state.adminRpc = { data: [{ order_id: "new-1", filled_qty: 150, avg_price: 100.6667, status: "filled" }], error: null };
  adminRpc.mockClear();
  supabaseMock.rpc.mockClear();
  userWrites.length = 0;
  shariahQueries.length = 0;
});

describe("placeOrder", () => {
  it("routes the order through match_order with the JWT user id and returns K3 fields", async () => {
    const res = await call(placeOrder, { symbolSlug: "noo001", side: "buy", type: "limit", qty: 150, price: 101 });
    expect(adminRpc).toHaveBeenCalledWith("match_order", expect.objectContaining({
      _user_id: "user-1", _symbol: "NOO001", _side: "buy", _type: "limit", _qty: 150, _limit_price: 101,
    }));
    expect(res).toMatchObject({ orderId: "new-1", status: "filled", filledQty: 150, filledPrice: 100.6667, cashBalance: 84900 });
    expect(userWrites).toEqual([]);
  });

  it("sends no price for a market order and reports an unfilled one as cancelled", async () => {
    state.adminRpc = { data: [{ order_id: "m-1", filled_qty: 0, avg_price: null, status: "cancelled" }], error: null };
    const res = await call(placeOrder, { symbolSlug: "noo001", side: "sell", type: "market", qty: 5, price: 3.333 });
    expect(adminRpc.mock.calls[0]![1]._limit_price).toBeUndefined();
    expect(res).toMatchObject({ orderId: "m-1", status: "cancelled", filledQty: 0 });
  });

  it("reads the LATEST Shariah ruling and blocks a buy on non_halal", async () => {
    state.ruling = { data: { status: "non_halal" }, error: null };
    await expect(call(placeOrder, { symbolSlug: "noo001", side: "buy", type: "market", qty: 1 })).rejects.toThrow(/^SHARIAH_BLOCKED$/);
    expect(shariahQueries[0]).toBe("effective_at");
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("fails closed when the Shariah ruling cannot be read", async () => {
    state.ruling = { data: null, error: { message: "connection reset", code: "08006" } };
    await expect(call(placeOrder, { symbolSlug: "noo001", side: "buy", type: "market", qty: 1 })).rejects.toThrow(/^INTERNAL_ERROR$/);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("refuses unpublished instruments", async () => {
    state.instrument = { symbol: "NOO001", assetClass: "brand", published: false };
    await expect(call(placeOrder, { symbolSlug: "noo001", side: "sell", type: "market", qty: 1 })).rejects.toThrow(/^INSTRUMENT_NOT_FOUND$/);
  });

  it("passes engine codes through and never leaks raw database text", async () => {
    state.adminRpc = { data: null, error: { message: "PRICE_OUT_OF_BAND" } };
    await expect(call(placeOrder, { symbolSlug: "noo001", side: "sell", type: "limit", qty: 1, price: 500 })).rejects.toThrow(/^PRICE_OUT_OF_BAND$/);
    state.adminRpc = { data: null, error: { message: 'new row for relation "orders" violates check constraint', code: "23514" } };
    const err = await call(placeOrder, { symbolSlug: "noo001", side: "sell", type: "limit", qty: 1, price: 100 }).catch((e: Error) => e);
    expect((err as Error).message).toBe("INTERNAL_ERROR");
  });

  it("rejects fractional quantities and sub-cent prices before any database work", async () => {
    await expect(call(placeOrder, { symbolSlug: "noo001", side: "buy", type: "limit", qty: 1.5, price: 100 })).rejects.toThrow(/^INVALID_QTY$/);
    await expect(call(placeOrder, { symbolSlug: "noo001", side: "buy", type: "limit", qty: 1, price: 100.001 })).rejects.toThrow(/^INVALID_PRICE$/);
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith("has_role", expect.anything());
  });
});

describe("order lifecycle", () => {
  it("cancels through cancel_order with the JWT user id", async () => {
    state.adminRpc = { data: [{ order_id: ORDER_ID, status: "cancelled", filled_qty: 0 }], error: null };
    const res = await call(cancelOrder, { orderId: ORDER_ID });
    expect(adminRpc).toHaveBeenCalledWith("cancel_order", { _user_id: "user-1", _order_id: ORDER_ID });
    expect(res).toMatchObject({ ok: true, orderId: ORDER_ID, status: "cancelled" });
    expect(userWrites).toEqual([]);
  });

  it("maps a foreign or closed order to ORDER_NOT_OPEN", async () => {
    state.adminRpc = { data: null, error: { message: "ORDER_NOT_OPEN" } };
    await expect(call(cancelOrder, { orderId: ORDER_ID })).rejects.toThrow(/^ORDER_NOT_OPEN$/);
    await expect(call(cancelOrder, { orderId: "not-a-uuid" })).rejects.toThrow(/^ORDER_NOT_OPEN$/);
  });

  it("modifies atomically through replace_order and resolves to the NEW order", async () => {
    state.adminRpc = { data: [{ order_id: "new-2", filled_qty: 0, avg_price: null, status: "open" }], error: null };
    const res = await call(modifyOrder, { orderId: ORDER_ID, price: 101.5, qty: 20 });
    expect(adminRpc).toHaveBeenCalledWith("replace_order", { _user_id: "user-1", _order_id: ORDER_ID, _price: 101.5, _qty: 20 });
    expect(res).toEqual({ orderId: "new-2", status: "open", filledQty: 0, filledPrice: null });
    expect(userWrites).toEqual([]);
  });

  it("restores through restore_order and resolves to the NEW order", async () => {
    state.adminRpc = { data: [{ order_id: "new-3", filled_qty: 10, avg_price: 100, status: "filled" }], error: null };
    const res = await call(restoreOrder, { orderId: ORDER_ID });
    expect(adminRpc).toHaveBeenCalledWith("restore_order", { _user_id: "user-1", _order_id: ORDER_ID });
    expect(res).toEqual({ orderId: "new-3", status: "filled", filledQty: 10, filledPrice: 100 });
  });

  it("requires the trader role to modify or restore", async () => {
    state.isTrader = false;
    await expect(call(modifyOrder, { orderId: ORDER_ID, price: 101.5, qty: 20 })).rejects.toThrow(/^FORBIDDEN_TRADER_REQUIRED$/);
    await expect(call(restoreOrder, { orderId: ORDER_ID })).rejects.toThrow(/^FORBIDDEN_TRADER_REQUIRED$/);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("blocks re-placing a buy on a non_halal symbol and an order that is not the caller's", async () => {
    state.ruling = { data: { status: "non_halal" }, error: null };
    await expect(call(restoreOrder, { orderId: ORDER_ID })).rejects.toThrow(/^SHARIAH_BLOCKED$/);
    state.ruling = { data: null, error: null };
    state.order = { data: null, error: null };
    await expect(call(modifyOrder, { orderId: ORDER_ID, price: 101.5, qty: 20 })).rejects.toThrow(/^ORDER_NOT_OPEN$/);
    expect(adminRpc).not.toHaveBeenCalled();
  });
});
