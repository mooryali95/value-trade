import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    if (error) throw new Error(error.message);
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
    return { company, members: members ?? [], brands: brands ?? [] };
  });

const AddMemberInput = z.object({
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["owner", "finance", "shariah", "trader", "viewer"]),
});
export const addCompanyMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AddMemberInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("company_members")
      .insert({ company_id: data.companyId, user_id: data.userId, role: data.role, invited_by: userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const removeCompanyMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ memberId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("company_members").delete().eq("id", data.memberId);
    if (error) throw new Error(error.message);
    return { ok: true };
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
    if (error) throw new Error(error.message === "BRAND_CAP_REACHED" ? "BRAND_CAP_REACHED" : error.message);
    return row;
  });

export const removeCompanyBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ brandId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("company_brands").delete().eq("id", data.brandId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });