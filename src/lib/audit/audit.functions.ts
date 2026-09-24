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
      console.error("[audit] list failed", error.code ?? "", error.message);
      throw new Error("INTERNAL_ERROR");
    }
    return (rows ?? []) as unknown as AuditRow[];
  });