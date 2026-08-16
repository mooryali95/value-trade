import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const OriginSchema = z.object({
  origin: z
    .string()
    .url()
    .refine(
      (v) =>
        /^https:\/\/[a-z0-9.-]+\.lovable\.app$/.test(v) ||
        /^https:\/\/([a-z0-9-]+\.)*sunkvalue\.com$/.test(v) ||
        /^http:\/\/localhost:\d+$/.test(v),
      "ORIGIN_NOT_ALLOWED",
    ),
  sendEmail: z.boolean().default(true),
});

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "platform_admin",
  });
  if (!isAdmin) throw new Error("FORBIDDEN_ADMIN_REQUIRED");
}

/** Runs the post-deploy smoke suite and returns a pass/fail report. */
export const runSmokeSuite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => OriginSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { runSmoke } = await import("./smoke.server");
    const email = (context.claims as { email?: string } | null)?.email ?? null;
    return runSmoke({
      userId: context.userId,
      email,
      origin: data.origin,
      sendEmail: data.sendEmail,
    });
  });

/** Last runs of every operational job (cron scan + smoke suite). */
export const getOpsRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: runs } = await supabaseAdmin
      .from("ops_run_log")
      .select("id, job, status, detail, metrics, duration_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    const list = runs ?? [];
    const latest = (job: string) => list.find((r) => r.job === job) ?? null;
    const { count: activeAlerts } = await supabaseAdmin
      .from("price_alerts")
      .select("*", { count: "exact", head: true })
      .eq("active", true);

    return {
      checkedAt: new Date().toISOString(),
      runs: list,
      lastCron: latest("cron-alerts"),
      lastSmoke: latest("smoke"),
      activeAlerts: activeAlerts ?? 0,
    };
  });