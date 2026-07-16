import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditEntry = {
  actorId: string;
  companyId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Best-effort audit write. Never throws — failures are logged only.
 * Uses the caller's RLS-scoped supabase client so writes require actor_id = auth.uid().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeAudit(supabase: SupabaseClient<any, any, any>, entry: AuditEntry): Promise<void> {
  try {
    const { error } = await supabase.from("audit_log").insert({
      actor_id: entry.actorId,
      company_id: entry.companyId ?? null,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[audit] insert failed:", error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[audit] insert threw:", e);
  }
}