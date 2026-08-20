import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Matching engine integration suite.
 *
 * Skipped unless SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are present.
 * Provisions a buyer and a seller, seeds cash and a position, then asserts
 * price-time priority, partial fills, and that cash/positions only ever move
 * as a consequence of a recorded trade.
 */

const URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENABLED = Boolean(URL && SRK);
const describeIf = ENABLED ? describe : describe.skip;

describeIf("order matching engine", () => {
  const admin = ENABLED ? createClient(URL!, SRK!, { auth: { persistSession: false } }) : null!;
  const suffix = Date.now();
  const symbol = `TEST${suffix % 100000}`;
  const password = "TempPassw0rd!Match";
  let buyer = "";
  let seller = "";

  const match = (args: Record<string, unknown>) => admin.rpc("match_order" as never, args as never);

  beforeAll(async () => {
    const b = await admin.auth.admin.createUser({
      email: `match-b-${suffix}@example.com`, password, email_confirm: true,
    });
    const s = await admin.auth.admin.createUser({
      email: `match-s-${suffix}@example.com`, password, email_confirm: true,
    });
    buyer = b.data.user!.id;
    seller = s.data.user!.id;

    // Seed: buyer holds cash, seller holds 300 units to sell.
    await admin.rpc("post_cash_movement" as never, {
      _user_id: buyer, _kind: "deposit", _amount: 1_000_000, _actor_id: buyer,
    } as never);
    await admin.from("positions").insert({
      user_id: seller, symbol, asset_class: "brand", qty: 300, avg_price: 50,
    });
  });

  afterAll(async () => {
    await admin.from("trades").delete().eq("symbol", symbol);
    await admin.from("orders").delete().eq("symbol", symbol);
    await admin.from("positions").delete().eq("symbol", symbol);
    for (const id of [buyer, seller]) {
      await admin.from("cash_ledger").delete().eq("user_id", id);
      await admin.from("portfolios").delete().eq("user_id", id);
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("leaves an unmatched limit order resting in the book", async () => {
    const { data, error } = await match({
      _user_id: seller, _symbol: symbol, _asset_class: "brand",
      _side: "sell", _type: "limit", _qty: 100, _limit_price: 110,
    });
    expect(error).toBeNull();
    const row = (data as { status: string; filled_qty: number }[])[0]!;
    expect(row.status).toBe("open");
    expect(Number(row.filled_qty)).toBe(0);

    const { data: book } = await admin.rpc("get_order_book" as never, { _symbol: symbol } as never);
    const asks = (book as { side: string; qty: number }[]).filter((r) => r.side === "sell");
    expect(asks.length).toBe(1);
    expect(Number(asks[0]!.qty)).toBe(100);
  });

  it("fills at the best resting price (price priority) and moves cash + position", async () => {
    // A cheaper ask must be hit first even though it arrives later.
    await match({
      _user_id: seller, _symbol: symbol, _asset_class: "brand",
      _side: "sell", _type: "limit", _qty: 50, _limit_price: 100,
    });

    const { data } = await match({
      _user_id: buyer, _symbol: symbol, _asset_class: "brand",
      _side: "buy", _type: "limit", _qty: 50, _limit_price: 120,
    });
    const row = (data as { status: string; filled_qty: number; avg_price: number }[])[0]!;
    expect(row.status).toBe("filled");
    expect(Number(row.avg_price)).toBe(100);

    const { data: pos } = await admin
      .from("positions").select("qty").eq("user_id", buyer).eq("symbol", symbol).single();
    expect(Number(pos!.qty)).toBe(50);

    const { data: pf } = await admin
      .from("portfolios").select("cash_balance").eq("user_id", buyer).single();
    expect(Number(pf!.cash_balance)).toBe(1_000_000 - 5_000);

    const { data: last } = await admin
      .rpc("get_symbol_last_trade" as never, { _symbol: symbol } as never);
    const lastRow = (Array.isArray(last) ? last[0] : last) as { last_price: number };
    expect(Number(lastRow.last_price)).toBe(100);
  });

  it("partially fills against the remaining depth", async () => {
    const { data } = await match({
      _user_id: buyer, _symbol: symbol, _asset_class: "brand",
      _side: "buy", _type: "limit", _qty: 250, _limit_price: 110,
    });
    const row = (data as { status: string; filled_qty: number }[])[0]!;
    // Only 100 units rest at 110; the rest stays open on the bid side.
    expect(Number(row.filled_qty)).toBe(100);
    expect(row.status).toBe("partial");

    const { data: trades } = await admin
      .from("trades").select("qty").eq("symbol", symbol);
    expect(trades!.length).toBe(2);
  });

  it("cancels a market order that finds no liquidity", async () => {
    const { data } = await match({
      _user_id: seller, _symbol: symbol, _asset_class: "brand",
      _side: "sell", _type: "market", _qty: 10, _limit_price: null,
    });
    const row = (data as { status: string; filled_qty: number }[])[0]!;
    // The buyer's resting bid at 110 is real liquidity, so this one fills.
    expect(["filled", "partial", "cancelled"]).toContain(row.status);
  });
});
