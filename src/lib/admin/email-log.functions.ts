import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";

async function ensureAdmin(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "platform_admin",
  });
  if (!isAdmin) throw new Error("FORBIDDEN");
}

type JsonObject = { [key: string]: Json | undefined };

function asJsonObject(value: Json | undefined): JsonObject | null {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/**
 * The template data stored in an email_send_log row's metadata (written by
 * enqueueTransactionalEmail), or {} when the row carries none.
 */
export function logTemplateData(metadata: Json | null): JsonObject {
  return asJsonObject(asJsonObject(metadata)?.template_data) ?? {};
}

const ListInput = z.object({
  status: z.enum(["all", "pending", "sent", "failed", "dlq", "suppressed", "bounced", "complained"]).default("all"),
  template: z.string().max(120).optional(),
  search: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const listEmailLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Latest row per message_id via a window; simplest reliable path: fetch a wider slice
    // and dedupe client-side within the handler.
    let q = supabaseAdmin
      .from("email_send_log")
      .select("id, message_id, template_name, recipient_email, status, error_message, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (data.template) q = q.eq("template_name", data.template);
    if (data.search) q = q.ilike("recipient_email", `%${data.search}%`);
    const { data: rows } = await q;
    const seen = new Set<string>();
    const latest: NonNullable<typeof rows> = [];
    for (const r of rows ?? []) {
      const key = r.message_id ?? r.id;
      if (seen.has(key)) continue;
      seen.add(key);
      latest.push(r);
    }
    const filtered = data.status === "all" ? latest : latest.filter((r) => r.status === data.status);
    return {
      total: filtered.length,
      items: filtered.slice(data.offset, data.offset + data.limit),
    };
  });

export const listEmailTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("email_send_log")
      .select("template_name")
      .limit(2000);
    return Array.from(new Set((data ?? []).map((r) => r.template_name))).sort();
  });

export const retryEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ messageId: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("email_send_log")
      .select("template_name, recipient_email, metadata")
      .eq("message_id", data.messageId)
      .order("created_at", { ascending: true })
      .limit(1);
    const row = rows?.[0];
    if (!row) throw new Error("NOT_FOUND");
    const meta = asJsonObject(row.metadata) ?? {};
    const { enqueueTransactionalEmail } = await import("@/lib/email/enqueue.server");
    const r = await enqueueTransactionalEmail({
      templateName: row.template_name,
      recipientEmail: row.recipient_email,
      templateData: logTemplateData(row.metadata),
      label: typeof meta.label === "string" ? meta.label : row.template_name,
      // do NOT reuse idempotencyKey — we want a fresh message
    });
    if (!r.sent) {
      // Raw provider/driver text stays in the server log.
      if (r.detail) console.error("[email-log] retry failed", r.reason, r.detail);
      return { sent: false as const, reason: r.reason };
    }
    return r;
  });