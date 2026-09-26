import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  companyId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];
export type AuditRow = {
  id: string;
  actor_id: string;
  company_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  metadata: Json;
  created_at: string;
  /**
   * Who acted, as the company owner may see it: a member's e-mail address;
   * platform staff by role only ("admin" / "reviewer"); "system" for rows
   * written without a person (migrations, jobs).
   */
  actor: { kind: "member" | "admin" | "reviewer" | "system" | "other"; email: string | null };
};

export const listAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<AuditRow[]> => {
    const { supabase } = context;
    let q = supabase
      .from("audit_log")
      .select("id, actor_id, company_id, action, entity, entity_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.companyId) q = q.eq("company_id", data.companyId);
    const { data: rows, error } = await q;
    if (error) {
      console.error("[audit] list failed", error.code ?? "");
      throw new Error("INTERNAL_ERROR");
    }
    const list = (rows ?? []) as unknown as Omit<AuditRow, "actor">[];
    if (list.length === 0) return [];
    return withActors(list, data.companyId ?? null);
  });

/**
 * Resolves the actors of audit rows RLS already returned to the caller:
 * members of the company by e-mail, platform staff by role only.
 */
async function withActors(rows: Omit<AuditRow, "actor">[], companyId: string | null): Promise<AuditRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ids = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))).slice(0, 100);
  const [members, roles] = await Promise.all([
    companyId
      ? supabaseAdmin.from("company_members").select("user_id").eq("company_id", companyId).in("user_id", ids)
      : Promise.resolve({ data: [] as { user_id: string }[], error: null }),
    supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
  ]);
  const memberIds = new Set((members.data ?? []).map((m) => m.user_id));
  const roleOf = new Map<string, string[]>();
  for (const r of roles.data ?? []) roleOf.set(r.user_id, [...(roleOf.get(r.user_id) ?? []), r.role]);
  const emails = new Map<string, string | null>();
  await Promise.all(
    Array.from(memberIds).map(async (id) => {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      emails.set(id, u?.user?.email ?? null);
    }),
  );
  return rows.map((r) => {
    const kind: AuditRow["actor"]["kind"] = !r.actor_id
      ? "system"
      : memberIds.has(r.actor_id)
        ? "member"
        : roleOf.get(r.actor_id)?.includes("platform_admin")
          ? "admin"
          : roleOf.get(r.actor_id)?.includes("shariah_board")
            ? "reviewer"
            : "other";
    return { ...r, actor: { kind, email: kind === "member" ? emails.get(r.actor_id) ?? null : null } };
  });
}