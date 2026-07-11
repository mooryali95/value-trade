import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole =
  | "platform_admin"
  | "shariah_board"
  | "company_owner"
  | "brand_manager"
  | "trader";

export type CompanyRole = "owner" | "finance" | "shariah" | "trader" | "viewer";

export type MyRoles = {
  userId: string;
  appRoles: AppRole[];
  companyRoles: Record<string, CompanyRole>;
};

export const getMyRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyRoles> => {
    const { supabase, userId } = context;
    const [{ data: appRows }, { data: coRows }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("company_members").select("company_id, role").eq("user_id", userId),
    ]);
    const appRoles = ((appRows ?? []) as Array<{ role: AppRole }>).map((r) => r.role);
    const companyRoles: Record<string, CompanyRole> = {};
    for (const r of (coRows ?? []) as Array<{ company_id: string; role: CompanyRole }>) {
      companyRoles[r.company_id] = r.role;
    }
    return { userId, appRoles, companyRoles };
  });

export function hasAppRole(roles: MyRoles | undefined, role: AppRole): boolean {
  return !!roles?.appRoles.includes(role);
}

export function hasAnyCompanyRole(roles: MyRoles | undefined, role: CompanyRole): boolean {
  if (!roles) return false;
  return Object.values(roles.companyRoles).includes(role);
}