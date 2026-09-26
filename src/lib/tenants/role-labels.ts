import type { Key } from "@/lib/i18n";

/**
 * Display labels for roles. Company roles (company_members.role) decide what
 * a member may do inside a company workspace; they never enable trading on
 * the market. Trading is the platform role "trader", activated per investor
 * by a platform admin.
 */

export const COMPANY_ROLES = ["owner", "finance", "shariah", "trader", "viewer"] as const;
export type CompanyRoleName = (typeof COMPANY_ROLES)[number];
/** Roles an owner may invite or approve (only a platform admin appoints owners). */
export const INVITABLE_ROLES = ["finance", "shariah", "trader", "viewer"] as const;

const COMPANY_ROLE_KEY: Record<CompanyRoleName, Key> = {
  owner: "r_roleOwner",
  finance: "r_roleFinance",
  shariah: "r_roleShariah",
  trader: "r_roleTrader",
  viewer: "r_roleViewer",
};

const COMPANY_ROLE_HINT_KEY: Record<CompanyRoleName, Key> = {
  owner: "r_roleOwnerHint",
  finance: "r_roleFinanceHint",
  shariah: "r_roleShariahHint",
  trader: "r_roleTraderHint",
  viewer: "r_roleViewerHint",
};

const APP_ROLE_KEY: Record<string, Key> = {
  platform_admin: "r_appRolePlatformAdmin",
  shariah_board: "r_appRoleShariahBoard",
  trader: "r_appRoleTrader",
  company_owner: "r_appRoleCompanyOwner",
  brand_manager: "r_appRoleBrandManager",
};

export function isCompanyRole(role: string): role is CompanyRoleName {
  return (COMPANY_ROLES as readonly string[]).includes(role);
}

/** i18n key of a company role label; null for an unknown role. */
export function companyRoleKey(role: string | null | undefined): Key | null {
  return role && isCompanyRole(role) ? COMPANY_ROLE_KEY[role] : null;
}

/** i18n key of the one-line description of a company role. */
export function companyRoleHintKey(role: string | null | undefined): Key | null {
  return role && isCompanyRole(role) ? COMPANY_ROLE_HINT_KEY[role] : null;
}

/** i18n key of a platform (app) role label; null for an unknown role. */
export function appRoleKey(role: string | null | undefined): Key | null {
  return role ? (APP_ROLE_KEY[role] ?? null) : null;
}
