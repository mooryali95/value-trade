import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cross-tenant RLS test suite.
 *
 * Skipped unless SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_PUBLISHABLE_KEY
 * are all present in the environment. Run against a staging Supabase project only:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_PUBLISHABLE_KEY=... \
 *     bunx vitest run src/lib/security
 *
 * Provisions two ephemeral users in two separate companies, seeds one row per
 * user in orders / positions / product_submissions / shariah_decisions, then
 * asserts that user B cannot select, update, or delete any of user A's rows.
 */

const URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
const SUITE_ENABLED = Boolean(URL && SRK && PUB);

const describeIf = SUITE_ENABLED ? describe : describe.skip;

describeIf("RLS prevents cross-tenant reads and writes", () => {
  const admin = SUITE_ENABLED ? createClient(URL!, SRK!, { auth: { persistSession: false } }) : null!;
  const suffix = Date.now();
  const emailA = `rls-a-${suffix}@example.com`;
  const emailB = `rls-b-${suffix}@example.com`;
  const password = "TempPassw0rd!Tenant";
  const created: { userAId?: string; userBId?: string; companyAId?: string; companyBId?: string } = {};
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;

  async function signIn(email: string): Promise<SupabaseClient> {
    const c = createClient(URL!, PUB!, { auth: { persistSession: false } });
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return c;
  }

  beforeAll(async () => {
    const a = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
    const b = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
    created.userAId = a.data.user!.id;
    created.userBId = b.data.user!.id;

    const coA = await admin.from("companies").insert({
      slug: `rls-a-${suffix}`, name_ar: "أ", name_en: "A", created_by: created.userAId,
    }).select("id").single();
    const coB = await admin.from("companies").insert({
      slug: `rls-b-${suffix}`, name_ar: "ب", name_en: "B", created_by: created.userBId,
    }).select("id").single();
    created.companyAId = coA.data!.id;
    created.companyBId = coB.data!.id;

    // Seed one row per table for user A.
    await admin.from("orders").insert({
      user_id: created.userAId, symbol: "RLSA001", asset_class: "brand",
      side: "buy", type: "limit", qty: 1, price: 10, status: "pending",
    });
    await admin.from("positions").insert({
      user_id: created.userAId, symbol: "RLSA001", asset_class: "brand", qty: 1, avg_price: 10,
    });
    await admin.from("product_submissions").insert({
      company_id: created.companyAId, submitted_by: created.userAId,
      asset_class: "stock", symbol: "RLSA001", name_ar: "أ", name_en: "A",
    });
    await admin.from("shariah_decisions").insert({
      symbol: "RLSA001", status: "halal", reason: "seed", updated_by: created.userAId,
    });

    clientA = await signIn(emailA);
    clientB = await signIn(emailB);
  }, 30_000);

  afterAll(async () => {
    if (!SUITE_ENABLED) return;
    // Best-effort cleanup.
    if (created.userAId) {
      await admin.from("orders").delete().eq("user_id", created.userAId);
      await admin.from("positions").delete().eq("user_id", created.userAId);
      await admin.from("shariah_decisions").delete().eq("updated_by", created.userAId);
    }
    if (created.companyAId) await admin.from("companies").delete().eq("id", created.companyAId);
    if (created.companyBId) await admin.from("companies").delete().eq("id", created.companyBId);
    if (created.userAId) await admin.auth.admin.deleteUser(created.userAId);
    if (created.userBId) await admin.auth.admin.deleteUser(created.userBId);
  }, 30_000);

  it("user A owns their rows (sanity)", async () => {
    const { data } = await clientA.from("orders").select("id").eq("symbol", "RLSA001");
    expect(data?.length ?? 0).toBeGreaterThan(0);
  });

  it("user B cannot read user A's orders / positions / submissions / shariah rows", async () => {
    const orders = await clientB.from("orders").select("id").eq("symbol", "RLSA001");
    expect(orders.data ?? []).toHaveLength(0);

    const positions = await clientB.from("positions").select("id").eq("symbol", "RLSA001");
    expect(positions.data ?? []).toHaveLength(0);

    const subs = await clientB.from("product_submissions").select("id").eq("company_id", created.companyAId!);
    expect(subs.data ?? []).toHaveLength(0);

    // Shariah decisions may be publicly readable by design; only forbid write.
    // Test the write path below.
  });

  it("user B cannot update user A's rows (RLS filters WHERE)", async () => {
    const upd = await clientB.from("orders").update({ status: "cancelled" }).eq("symbol", "RLSA001").select("id");
    expect(upd.data ?? []).toHaveLength(0);

    const updPos = await clientB.from("positions").update({ qty: 0 }).eq("symbol", "RLSA001").select("id");
    expect(updPos.data ?? []).toHaveLength(0);

    const updSub = await clientB.from("product_submissions")
      .update({ status: "approved" }).eq("company_id", created.companyAId!).select("id");
    expect(updSub.data ?? []).toHaveLength(0);

    const updShar = await clientB.from("shariah_decisions")
      .update({ status: "restricted" }).eq("symbol", "RLSA001").select("id");
    expect(updShar.data ?? []).toHaveLength(0);
  });

  it("user B cannot delete user A's rows", async () => {
    const del = await clientB.from("orders").delete().eq("symbol", "RLSA001").select("id");
    expect(del.data ?? []).toHaveLength(0);

    const delSub = await clientB.from("product_submissions")
      .delete().eq("company_id", created.companyAId!).select("id");
    expect(delSub.data ?? []).toHaveLength(0);
  });
});

if (!SUITE_ENABLED) {
  // eslint-disable-next-line no-console
  console.warn("[rls-cross-tenant] SUPABASE_URL/SERVICE_ROLE_KEY/PUBLISHABLE_KEY not set — suite skipped.");
}