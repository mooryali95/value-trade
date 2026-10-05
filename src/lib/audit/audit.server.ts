import type { Json } from "@/integrations/supabase/types";

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
 *
 * audit_log is append-only and not writable by users: the row is inserted
 * with the service role. `entry.actorId` must be the verified JWT user id of
 * the caller (every call site passes `context.userId`). The `supabase`
 * argument is kept for call-site compatibility and is not used.
 */
export async function writeAudit(_supabase: unknown, entry: AuditEntry): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("audit_log").insert({
      actor_id: entry.actorId,
      company_id: entry.companyId ?? null,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      metadata: (entry.metadata ?? {}) as Json,
    });
    if (error) {
      console.warn("[audit] insert failed:", error.code ?? "", error.message);
    }
  } catch (e) {
    console.warn("[audit] insert threw:", e instanceof Error ? e.name : "unknown");
  }
}
