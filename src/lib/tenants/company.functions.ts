import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/audit/audit.server";
import { toStableError } from "@/lib/ops/errors.server";

/** RLS refusals read as FORBIDDEN; other database text never reaches the browser. */
function companyError(tag: string, error: { message: string; code?: string | null }): Error {
  return toStableError(tag, error, error.code === "42501" ? "FORBIDDEN" : "INTERNAL_ERROR");
}

const CreateInput = z.object({
  slug: z.string().min(2).max(48).regex(/^[a-z0-9-]+$/),
  name_ar: z.string().min(1).max(120),
  name_en: z.string().min(1).max(120),
});

export const createCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("companies")
      .insert({ ...data, created_by: userId })
      .select("*")
      .single();
    if (error) throw companyError("company.create", error);
    await writeAudit(supabase, {
      actorId: userId, companyId: row.id, action: "company.create", entity: "companies", entityId: row.id,
      metadata: { slug: data.slug },
    });
    return row;
  });

export const listMyCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: memberships } = await supabase
      .from("company_members")
      .select("role, company_id, companies:companies!inner(id, slug, name_ar, name_en, plan)")
      .eq("user_id", userId);
    return (memberships ?? []).map((m) => ({
      role: m.role,
      company: m.companies,
    }));
  });

export const getCompanyDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: company }, { data: members }, { data: brands }] = await Promise.all([
      supabase.from("companies").select("*").eq("id", data.companyId).single(),
      supabase.from("company_members").select("id, user_id, role, joined_at").eq("company_id", data.companyId),
      supabase.from("company_brands").select("id, brand_symbol, added_at").eq("company_id", data.companyId).order("added_at", { ascending: false }),
    ]);
    // Members are listed by e-mail address, not by user id. Only rows RLS
    // already returned to this caller (a member of the company) are resolved.
    const emails = new Map<string, string | null>();
    const visible = (members ?? []).slice(0, 200);
    if (visible.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await Promise.all(
        visible.map(async (m) => {
          const { data: u } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
          emails.set(m.user_id, u?.user?.email ?? null);
        }),
      );
    }
    return {
      company,
      members: (members ?? []).map((m) => ({ ...m, email: emails.get(m.user_id) ?? null })),
      brands: brands ?? [],
    };
  });

const AddMemberInput = z.object({
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["owner", "finance", "shariah", "trader", "viewer"]),
});
/**
 * People join a company by accepting an invitation (their consent, from a
 * confirmed address). Adding an account directly is a platform-admin repair
 * tool only; API users have no insert path (20260926100300).
 */
export const addCompanyMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AddMemberInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { isPlatformAdmin } = await import("./invitations.server");
    if (!(await isPlatformAdmin(userId))) throw new Error("FORBIDDEN");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("company_members")
      .insert({ company_id: data.companyId, user_id: data.userId, role: data.role, invited_by: userId })
      .select("*")
      .single();
    if (error?.code === "23505") throw new Error("ALREADY_MEMBER");
    if (error) throw companyError("company.member.add", error);
    await writeAudit(supabase, {
      actorId: userId, companyId: data.companyId, action: "member.add", entity: "company_members", entityId: row.id,
      metadata: { targetUserId: data.userId, role: data.role },
    });
    return row;
  });

export const removeCompanyMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ memberId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prev } = await supabase.from("company_members").select("company_id, user_id, role").eq("id", data.memberId).maybeSingle();
    // RLS turns a delete the caller may not do into "0 rows": nothing
    // changed, so no audit row is written.
    const { data: removed, error } = await supabase.from("company_members").delete().eq("id", data.memberId).select("id");
    if (error) throw companyError("company.member.remove", error);
    if (!removed || removed.length === 0) throw new Error(prev ? "FORBIDDEN" : "MEMBER_NOT_FOUND");
    await writeAudit(supabase, {
      actorId: userId, companyId: prev?.company_id ?? null, action: "member.remove", entity: "company_members", entityId: data.memberId,
      metadata: { targetUserId: prev?.user_id, role: prev?.role },
    });
    return { ok: true };
  });

const UpdateMemberRoleInput = z.object({
  memberId: z.string().uuid(),
  role: z.enum(["owner", "finance", "shariah", "trader", "viewer"]),
});
/** Owners change a member's role; the DB trigger refuses to demote the last owner. */
export const updateCompanyMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateMemberRoleInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prev } = await supabase
      .from("company_members")
      .select("company_id, user_id, role")
      .eq("id", data.memberId)
      .maybeSingle();
    if (!prev) throw new Error("MEMBER_NOT_FOUND");
    const { data: row, error } = await supabase
      .from("company_members")
      .update({ role: data.role })
      .eq("id", data.memberId)
      .select("id, user_id, role")
      .single();
    if (error) throw companyError("company.member.role", error);
    await writeAudit(supabase, {
      actorId: userId, companyId: prev.company_id, action: "member.role_change", entity: "company_members", entityId: data.memberId,
      metadata: { targetUserId: prev.user_id, from: prev.role, to: data.role },
    });
    return row;
  });

const AddBrandInput = z.object({ companyId: z.string().uuid(), brandSymbol: z.string().min(1).max(32) });
export const addCompanyBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AddBrandInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("company_brands")
      .insert({ company_id: data.companyId, brand_symbol: data.brandSymbol, added_by: userId })
      .select("*")
      .single();
    if (error) throw companyError("company.brand.add", error);
    await writeAudit(supabase, {
      actorId: userId, companyId: data.companyId, action: "brand.add", entity: "company_brands", entityId: row.id,
      metadata: { brandSymbol: data.brandSymbol },
    });
    return row;
  });

export const removeCompanyBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ brandId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prev } = await supabase.from("company_brands").select("company_id, brand_symbol").eq("id", data.brandId).maybeSingle();
    const { data: removed, error } = await supabase.from("company_brands").delete().eq("id", data.brandId).select("id");
    if (error) throw companyError("company.brand.remove", error);
    if (!removed || removed.length === 0) throw new Error("FORBIDDEN");
    await writeAudit(supabase, {
      actorId: userId, companyId: prev?.company_id ?? null, action: "brand.remove", entity: "company_brands", entityId: data.brandId,
      metadata: { brandSymbol: prev?.brand_symbol },
    });
    return { ok: true };
  });