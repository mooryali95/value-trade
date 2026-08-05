import { describe, it, expect, vi } from "vitest";

/**
 * Phase 2 coverage: the *server-side* role gate on the two most sensitive
 * mutations (placing an order, recording a shariah decision). The UI hides
 * these actions, but the server must refuse them regardless of the UI.
 */

const rpcRoles: Record<string, boolean> = { trader: false, shariah_board: false };

const supabaseMock = {
  rpc: vi.fn(async (name: string, args: unknown) => {
    if (name === "has_role") {
      const role = (args as { _role: string })._role;
      return { data: rpcRoles[role] ?? false, error: null };
    }
    return { data: null, error: null };
  }),
  from: () => {
    throw new Error("DB_SHOULD_NOT_BE_TOUCHED_WHEN_FORBIDDEN");
  },
};

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { _middleware: true, server: () => ({}) },
}));

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
          return h({
            data,
            context: {
              supabase: supabaseMock,
              userId: "user-1",
              claims: { sub: "user-1", email: "user@example.com" },
            },
          });
        };
      },
    };
    return api;
  },
}));

import { placeOrder } from "./place-order.functions";
import { recordShariahDecision } from "./shariah.functions";

describe("server-side role guards", () => {
  it("blocks placing an order without the trader role", async () => {
    rpcRoles.trader = false;
    await expect(
      placeOrder({ data: { symbolSlug: "noor-tech", side: "buy", type: "market", qty: 1 } } as never),
    ).rejects.toThrow(/FORBIDDEN_TRADER_REQUIRED|SYMBOL_NOT_FOUND/);
  });

  it("rejects invalid order input before any database work", async () => {
    await expect(
      placeOrder({ data: { symbolSlug: "", side: "buy", type: "market", qty: -5 } } as never),
    ).rejects.toBeTruthy();
  });

  it("blocks recording a shariah decision without the reviewer role", async () => {
    rpcRoles.shariah_board = false;
    await expect(
      recordShariahDecision({
        data: { symbol: "NOOR", status: "halal", reason: "test" },
      } as never),
    ).rejects.toThrow(/FORBIDDEN|REVIEWER/i);
  });
});
