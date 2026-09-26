import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;

const tables: {
  brands: Row[];
  positions: Row[];
  symbol_watchers: Row[];
  price_alerts: Row[];
  notification_preferences: Row[];
  suppressed_emails: Row[];
  email_send_log: Row[];
} = {
  brands: [],
  positions: [],
  symbol_watchers: [],
  price_alerts: [],
  notification_preferences: [],
  suppressed_emails: [],
  email_send_log: [],
};

const enqueueCalls: Array<{ queue: string; payload: any }> = [];

let nextId = 0;
function makeSelectChain(rows: Row[]) {
  type F = { col: string; val: unknown; op: "eq" | "in" | "gt" };
  const test = (r: Row, f: F) =>
    f.op === "eq" ? r[f.col] === f.val
    : f.op === "in" ? (f.val as unknown[]).includes(r[f.col])
    : String(r[f.col] ?? "") > String(f.val) || (typeof f.val === "number" && Number(r[f.col] ?? 0) > f.val);
  const chain: any = {
    _filters: [] as F[],
    _limit: Infinity,
    select() { return this; },
    order() { return this; },
    limit(n: number) { this._limit = n; return this; },
    eq(col: string, val: unknown) { this._filters.push({ col, val, op: "eq" }); return this; },
    in(col: string, val: unknown[]) { this._filters.push({ col, val, op: "in" }); return this; },
    gt(col: string, val: unknown) { this._filters.push({ col, val, op: "gt" }); return this; },
    maybeSingle() {
      const match = rows.find((r) => this._filters.every((f: F) => test(r, f)));
      return Promise.resolve({ data: match ?? null, error: null });
    },
    then(resolve: (v: { data: Row[]; error: null }) => unknown) {
      const filtered = rows
        .filter((r) => this._filters.every((f: F) => test(r, f)))
        .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")))
        .slice(0, this._limit);
      return Promise.resolve(resolve({ data: filtered, error: null }));
    },
  };
  return chain;
}
/** A row with an id (recipient lookups page by id) and, for positions, units. */
const row = (r: Row): Row => ({ id: `r${String(++nextId).padStart(6, "0")}`, qty: 1, ...r });

const supabaseAdmin = {
  from(table: keyof typeof tables) {
    return {
      ...makeSelectChain(tables[table]),
      insert: (row: Row) => {
        tables[table].push(row);
        return Promise.resolve({ data: row, error: null });
      },
    };
  },
  rpc: vi.fn(async (name: string, args: any) => {
    if (name === "enqueue_email") {
      enqueueCalls.push({ queue: args.queue_name, payload: args.payload });
      return { data: 1, error: null };
    }
    return { data: null, error: null };
  }),
  auth: {
    admin: {
      getUserById: vi.fn(async (uid: string) => ({
        data: { user: { id: uid, email: `${uid}@example.com` } },
        error: null,
      })),
    },
  },
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

// Avoid pulling React email rendering by mocking enqueueTransactionalEmail
// to call the same admin insert + rpc path the real helper exercises.
vi.mock("@/lib/email/enqueue.server", () => ({
  enqueueTransactionalEmail: vi.fn(async (input: any) => {
    const email = input.recipientEmail.toLowerCase();
    const suppressed = tables.suppressed_emails.find((s) => s.email === email);
    if (suppressed) return { sent: false, reason: "suppressed" };
    const messageId = `msg-${enqueueCalls.length + 1}`;
    tables.email_send_log.push({
      message_id: messageId,
      template_name: input.templateName,
      recipient_email: email,
      status: "pending",
      metadata: { idempotency_key: input.idempotencyKey ?? messageId },
    });
    enqueueCalls.push({
      queue: "transactional_emails",
      payload: { to: email, idempotency_key: input.idempotencyKey ?? messageId, template: input.templateName },
    });
    return { sent: true, messageId };
  }),
}));

beforeEach(() => {
  for (const k of Object.keys(tables) as Array<keyof typeof tables>) tables[k].length = 0;
  enqueueCalls.length = 0;
  // Listed instruments of the tests below.
  tables.brands.push({ symbol: "ARAMCO", published: true }, { symbol: "SUKUK1", published: true });
});

describe("notifySymbolEvent", () => {
  it("dedupes users across watchers, positions and price_alerts", async () => {
    tables.positions.push(row({ user_id: "u1", symbol: "ARAMCO" }));
    tables.symbol_watchers.push(row({ user_id: "u1", symbol: "ARAMCO" }));
    tables.price_alerts.push(row({ user_id: "u2", symbol: "ARAMCO" }));

    const { notifySymbolEvent } = await import("./notify.server");
    const r = await notifySymbolEvent({
      symbol: "ARAMCO",
      pref: "shariah_decisions_email",
      templateName: "shariah-decision",
      idempotencyPrefix: "e:1",
      templateData: { symbol: "ARAMCO" },
    });
    expect(r.notified).toBe(2);
    const recipients = enqueueCalls.map((c) => c.payload.to).sort();
    expect(recipients).toEqual(["u1@example.com", "u2@example.com"]);
  });

  it("respects notification_preferences opt-out", async () => {
    tables.positions.push(row({ user_id: "u1", symbol: "ARAMCO" }));
    tables.positions.push(row({ user_id: "u2", symbol: "ARAMCO" }));
    tables.notification_preferences.push({ user_id: "u2", shariah_decisions_email: false });

    const { notifySymbolEvent } = await import("./notify.server");
    const r = await notifySymbolEvent({
      symbol: "ARAMCO",
      pref: "shariah_decisions_email",
      templateName: "shariah-decision",
      idempotencyPrefix: "e:2",
      templateData: { symbol: "ARAMCO" },
    });
    expect(r.notified).toBe(1);
    expect(enqueueCalls[0].payload.to).toBe("u1@example.com");
  });

  it("audience='positions' skips watcher-only and alert-only users", async () => {
    tables.positions.push(row({ user_id: "holder", symbol: "SUKUK1" }));
    tables.symbol_watchers.push(row({ user_id: "watcher", symbol: "SUKUK1" }));
    tables.price_alerts.push(row({ user_id: "alerter", symbol: "SUKUK1" }));

    const { notifySymbolEvent } = await import("./notify.server");
    const r = await notifySymbolEvent({
      symbol: "SUKUK1",
      pref: "position_updates_email",
      templateName: "position-update",
      audience: "positions",
      idempotencyPrefix: "pos:1",
      templateData: { symbol: "SUKUK1", headline: "update" },
    });
    expect(r.notified).toBe(1);
    expect(enqueueCalls[0].payload.to).toBe("holder@example.com");
  });

  it("notifies nobody about an instrument that is not listed (pre-listing or delisted)", async () => {
    tables.brands.push({ symbol: "SECRET", published: false });
    tables.positions.push(row({ user_id: "holder", symbol: "SECRET" }));
    tables.symbol_watchers.push(row({ user_id: "watcher", symbol: "SECRET" }));
    tables.price_alerts.push(row({ user_id: "alerter", symbol: "SECRET" }));

    const { notifySymbolEvent } = await import("./notify.server");
    for (const symbol of ["SECRET", "secret", "NOSUCH"]) {
      const r = await notifySymbolEvent({
        symbol,
        pref: "shariah_decisions_email",
        templateName: "shariah-decision",
        idempotencyPrefix: `e:${symbol}`,
        templateData: { symbol, status: "non_halal", reason: "confidential" },
      });
      expect(r.notified).toBe(0);
    }
    const alert = await notifySymbolEvent({
      symbol: "SECRET",
      pref: "price_alerts_email",
      templateName: "price-alert",
      idempotencyPrefix: "pa:1",
      onlyUserId: "alerter",
      templateData: { symbol: "SECRET" },
    });
    expect(alert.notified).toBe(0);
    expect(enqueueCalls).toHaveLength(0);
  });

  it("pages through every recipient (no silent cut at the API row limit)", async () => {
    for (let i = 0; i < 1203; i++) tables.symbol_watchers.push(row({ user_id: `w${i}`, symbol: "ARAMCO" }));
    const { notifySymbolEvent } = await import("./notify.server");
    const r = await notifySymbolEvent({
      symbol: " aramco ",
      pref: "shariah_decisions_email",
      templateName: "shariah-decision",
      idempotencyPrefix: "e:many",
      templateData: { symbol: "ARAMCO" },
    });
    expect(r.notified).toBe(1203);
  });

  it("uses a fresh idempotency key on retry (no duplicate suppression)", async () => {
    tables.positions.push(row({ user_id: "u1", symbol: "ARAMCO" }));

    const { notifySymbolEvent } = await import("./notify.server");
    await notifySymbolEvent({
      symbol: "ARAMCO",
      pref: "shariah_decisions_email",
      templateName: "shariah-decision",
      idempotencyPrefix: "e:orig",
      templateData: { symbol: "ARAMCO" },
    });
    await notifySymbolEvent({
      symbol: "ARAMCO",
      pref: "shariah_decisions_email",
      templateName: "shariah-decision",
      idempotencyPrefix: "e:retry",
      templateData: { symbol: "ARAMCO" },
    });
    const keys = enqueueCalls.map((c) => c.payload.idempotency_key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).not.toEqual(keys[1]);
  });
});