import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyRoles, hasAppRole, type MyRoles, type AppRole, type CompanyRole } from "@/lib/tenants/roles.functions";

export function useMyRoles() {
  const fn = useServerFn(getMyRoles);
  const q = useQuery<MyRoles>({
    queryKey: ["my-roles"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
  const roles = q.data;
  return {
    ...q,
    roles,
    isTrader: hasAppRole(roles, "trader"),
    isReviewer: hasAppRole(roles, "shariah_board"),
    isAdmin: hasAppRole(roles, "platform_admin"),
    hasApp: (r: AppRole) => hasAppRole(roles, r),
    companyRole: (companyId: string): CompanyRole | undefined => roles?.companyRoles[companyId],
  };
}