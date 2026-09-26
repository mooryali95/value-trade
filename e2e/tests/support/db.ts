// Direct database access for arranging data and asserting on it. Connects as
// the cluster superuser (local throwaway stack only). Money and units are
// only ever created through the same SQL functions the server calls, run as
// the service role, so every invariant the app relies on holds.
import crypto from "node:crypto";
import pg from "pg";
import { stack } from "./stack";

// numeric -> string by default in pg; the helpers below convert explicitly.
let pool: pg.Pool | null = null;

function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: stack().DATABASE_URL, max: 4 });
    pool.on("error", () => undefined);
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) await pool.end().catch(() => undefined);
  pool = null;
}

export async function sql<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await db().query(text, params);
  return res.rows as T[];
}

export async function one<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T> {
  const rows = await sql<T>(text, params);
  if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}: ${text}`);
  return rows[0];
}

/** Runs `fn` in one transaction as the API's service role (like the server's supabaseAdmin). */
export async function asServiceRole<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('role', 'service_role', true), set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

// ------------------------------------------------------------ seeded data ---

/** Password of every seeded account (e2e/stack/seed.sql). */
export const SEED_PASSWORD = "Preview123!";

export const SEEDED = {
  admin: { id: "a0000000-0000-4000-8000-000000000001", email: "admin@preview.local" },
  reviewer: { id: "a0000000-0000-4000-8000-000000000002", email: "reviewer@preview.local" },
  owner: { id: "a0000000-0000-4000-8000-000000000003", email: "owner@preview.local" },
  owner2: { id: "a0000000-0000-4000-8000-000000000004", email: "owner2@preview.local" },
  investor: { id: "a0000000-0000-4000-8000-000000000011", email: "investor@preview.local" },
  investor2: { id: "a0000000-0000-4000-8000-000000000012", email: "investor2@preview.local" },
  investor3: { id: "a0000000-0000-4000-8000-000000000013", email: "investor3@preview.local" },
} as const;

export const SAMPLE_COMPANY_A = {
  id: "c0000000-0000-4000-8000-00000000000a",
  nameAr: "شركة تجريبية أ",
  nameEn: "Sample Company A",
};

// ------------------------------------------------------------- fixtures ---

/** A short unique tag for names, e-mails and symbols of one test attempt. */
export function uniqueTag(): string {
  return `${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`.toLowerCase();
}

const hashPw = (pw: string) => crypto.createHash("sha256").update(pw).digest("hex");

/**
 * A confirmed account that can sign in with `password` (the auth stub keeps a
 * SHA-256 of it in auth.users.encrypted_password). handle_new_user creates
 * the profile. `roles` are app roles (e.g. trader).
 */
export async function createUser(opts: {
  email: string;
  password: string;
  fullName: string;
  roles?: string[];
}): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO auth.users (email, raw_user_meta_data, email_confirmed_at, encrypted_password)
     VALUES (lower($1), jsonb_build_object('full_name', $2::text), now(), $3) RETURNING id`,
    [opts.email, opts.fullName, hashPw(opts.password)],
  );
  for (const role of opts.roles ?? []) {
    await sql("INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2::app_role)", [row.id, role]);
  }
  return row.id;
}

export async function userIdByEmail(email: string): Promise<string | null> {
  const rows = await sql<{ id: string }>("SELECT id FROM auth.users WHERE lower(email) = lower($1)", [email]);
  return rows[0]?.id ?? null;
}

/** A deposit through post_cash_movement (the only way cash enters), recorded by the seeded admin. */
export async function deposit(userId: string, amount: number): Promise<void> {
  await asServiceRole((c) =>
    c.query("SELECT public.post_cash_movement($1, 'deposit', $2, NULL, 'e2e deposit', $3)", [
      userId,
      amount,
      SEEDED.admin.id,
    ]),
  );
}

/**
 * A published brand unit with a halal ruling and a reference price, and no
 * trades (its price band is +/-20% of the reference price). Created off the
 * market, then listed through set_instrument_published, like the seed.
 */
export async function createListedInstrument(opts: {
  symbol: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  referencePrice: number;
  companyId?: string;
}): Promise<void> {
  await sql(
    `INSERT INTO public.brands (symbol, slug, name_ar, name_en, sector, reference_price, published, company_id)
     VALUES ($1, $2, $3, $4, 'retail', $5, false, $6)`,
    [opts.symbol, opts.slug, opts.nameAr, opts.nameEn, opts.referencePrice, opts.companyId ?? SAMPLE_COMPANY_A.id],
  );
  await sql(
    `INSERT INTO public.shariah_decisions (symbol, status, reason, reviewer_id, updated_by)
     VALUES ($1, 'halal', 'e2e: ruling for a test instrument', $2, $2)`,
    [opts.symbol, SEEDED.reviewer.id],
  );
  await sql("SELECT 1 FROM public.set_instrument_published($1, true, $2)", [opts.symbol, SEEDED.admin.id]);
}

/** Primary issuance through issue_units (the only way units are created). */
export async function issueUnits(userId: string, symbol: string, qty: number, price: number): Promise<void> {
  await asServiceRole((c) =>
    c.query("SELECT public.issue_units($1, $2, $3, $4, $5, 'e2e issuance')", [
      SEEDED.admin.id,
      userId,
      symbol,
      qty,
      price,
    ]),
  );
}

/** A limit order through the matching engine (as the server places it). */
export async function placeLimitOrder(
  userId: string,
  symbol: string,
  side: "buy" | "sell",
  qty: number,
  price: number,
): Promise<{ orderId: string; status: string }> {
  return asServiceRole(async (c) => {
    const r = await c.query(
      "SELECT m.order_id, m.status FROM public.match_order($1, $2, 'brand', $3, 'limit', $4, $5) m",
      [userId, symbol, side, qty, price],
    );
    return { orderId: r.rows[0].order_id as string, status: r.rows[0].status as string };
  });
}

export async function cashBalance(userId: string): Promise<number> {
  const r = await sql<{ cash_balance: string }>("SELECT cash_balance FROM public.portfolios WHERE user_id = $1", [userId]);
  return r.length ? Number(r[0].cash_balance) : 0;
}

export async function positionQty(userId: string, symbol: string): Promise<number> {
  const r = await sql<{ qty: string }>("SELECT qty FROM public.positions WHERE user_id = $1 AND symbol = $2", [
    userId,
    symbol,
  ]);
  return r.length ? Number(r[0].qty) : 0;
}

export async function hasRole(userId: string, role: string): Promise<boolean> {
  const r = await sql("SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = $2::app_role", [userId, role]);
  return r.length > 0;
}
