import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { toBrowserError } from "@/lib/security/browser-error";

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  // /lovable/* routes self-authenticate; bypass any custom logic here.
  const url = new URL(request.url);
  if (url.pathname.startsWith("/lovable/") || url.pathname === "/email/unsubscribe") {
    return next();
  }
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Every server function: a failure reaches the browser as a stable code
// (NOT_AUTHENTICATED, INVALID_INPUT, INTERNAL_ERROR, or the function's own
// code), never as raw validator, middleware or library text.
const stableErrorMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    throw toBrowserError(error);
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, stableErrorMiddleware],
  requestMiddleware: [errorMiddleware],
}));
