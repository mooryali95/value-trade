import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const renderEmailPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        template: z.string().min(1),
        data: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "platform_admin",
    });
    if (!isAdmin) throw new Error("FORBIDDEN");

    const { TEMPLATES } = await import("@/lib/email-templates/registry");
    const entry = TEMPLATES[data.template];
    if (!entry) throw new Error("UNKNOWN_TEMPLATE");

    const { render } = await import("@react-email/render");
    const React = await import("react");
    const props = { ...(entry.previewData ?? {}), ...(data.data ?? {}) };
    const html = await render(
      React.createElement(entry.component as any, props),
      { pretty: false },
    );
    const subject =
      typeof entry.subject === "function" ? entry.subject(props) : entry.subject;
    return { html, subject };
  });