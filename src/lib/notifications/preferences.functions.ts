import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NotificationPreferences = {
  price_alerts_email: boolean;
  shariah_decisions_email: boolean;
  position_updates_email: boolean;
};

const DEFAULTS: NotificationPreferences = {
  price_alerts_email: true,
  shariah_decisions_email: true,
  position_updates_email: true,
};

export const getMyNotificationPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationPreferences> => {
    const { data } = await context.supabase
      .from("notification_preferences")
      .select("price_alerts_email, shariah_decisions_email, position_updates_email")
      .eq("user_id", context.userId)
      .maybeSingle();
    return data ?? DEFAULTS;
  });

const UpdateInput = z.object({
  price_alerts_email: z.boolean(),
  shariah_decisions_email: z.boolean(),
  position_updates_email: z.boolean(),
});

export const updateMyNotificationPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notification_preferences")
      .upsert({ user_id: context.userId, ...data });
    if (error) {
      console.error("[preferences] write failed", error);
      throw new Error("INTERNAL_ERROR");
    }
    return { ok: true };
  });