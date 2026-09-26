import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

/**
 * "Forgot password": e-mails a recovery link that lands on
 * <canonical origin>/auth/update-password. Sent by the server so the link
 * never points at an origin chosen by the browser, and rate limited per IP
 * and per address. The answer is the same whether or not the address has an
 * account (Supabase Auth itself does not reveal it either).
 */
const Input = z.object({ email: z.string().trim().toLowerCase().email().max(320) });

async function emailKey(scope: string, email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${scope}:${hex.slice(0, 32)}`;
}

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { checkRateLimit, clientKeyFromRequest } = await import("@/lib/security/rate-limit.server");
    const [ipOk, emailOk] = await Promise.all([
      checkRateLimit(clientKeyFromRequest(getRequest(), "password-reset-ip"), 10, 3600),
      checkRateLimit(await emailKey("password-reset-email", data.email), 3, 3600),
    ]);
    if (!ipOk || !emailOk) throw new Error("RATE_LIMITED");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { accountLinkRedirect } = await import("./platform-invite.server");
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(data.email, {
      redirectTo: accountLinkRedirect("recovery", "/"),
    });
    if (error) {
      const { authErrorCode } = await import("@/lib/security/auth-errors");
      const code = authErrorCode(error);
      console.error("[password-reset] failed", error.status ?? "", code);
      if (code === "AUTH_RATE_LIMITED") throw new Error("RATE_LIMITED");
      // Unknown addresses are not an error for Supabase Auth; anything else is
      // a delivery problem the user should know about.
      throw new Error("EMAIL_SEND_FAILED");
    }
    return { ok: true };
  });
