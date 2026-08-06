import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "platform_admin",
  });
  if (!isAdmin) throw new Error("FORBIDDEN");
}

export type CompanyDirectoryRow = {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  plan: string;
  sector: string | null;
  created_at: string;
  memberCount: number;
  pendingAccessRequests: number;
};

const ListInput = z.object({
  search: z.string().max(120).optional(),
});

export const listAllCompaniesAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<CompanyDirectoryRow[]> => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("companies")
      .select("id, slug, name_ar, name_en, plan, sector, created_at")
      .order("created_at", { ascending: false });
    if (data.search) {
      q = q.or(
        `name_ar.ilike.%${data.search}%,name_en.ilike.%${data.search}%,slug.ilike.%${data.search}%`,
      );
    }
    const { data: companies, error } = await q;
    if (error) throw new Error(error.message);
    const rows = companies ?? [];
    if (rows.length === 0) return [];

    const ids = rows.map((r: { id: string }) => r.id);
    const [{ data: members }, { data: pending }] = await Promise.all([
      supabaseAdmin.from("company_members").select("company_id").in("company_id", ids),
      (supabaseAdmin.from("access_requests" as any) as any)
        .select("requested_company_id")
        .eq("status", "pending")
        .in("requested_company_id", ids),
    ]);

    const memberCounts = new Map<string, number>();
    for (const m of (members ?? []) as { company_id: string }[]) {
      memberCounts.set(m.company_id, (memberCounts.get(m.company_id) ?? 0) + 1);
    }
    const pendingCounts = new Map<string, number>();
    for (const p of (pending ?? []) as { requested_company_id: string }[]) {
      pendingCounts.set(
        p.requested_company_id,
        (pendingCounts.get(p.requested_company_id) ?? 0) + 1,
      );
    }

    return rows.map((r: Omit<CompanyDirectoryRow, "memberCount" | "pendingAccessRequests">) => ({
      ...r,
      memberCount: memberCounts.get(r.id) ?? 0,
      pendingAccessRequests: pendingCounts.get(r.id) ?? 0,
    }));
  });
