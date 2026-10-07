import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getPublicClient } from "@/lib/trading/book.server";
import { checkRateLimit } from "@/lib/security/rate-limit.server";
import { buildInstrumentContext, streamAnswer } from "@/lib/assistant/instrument-assistant.server";

/** Daily questions per signed-in user. */
const DAILY_LIMIT = 30;

const Body = z.object({
  slug: z.string().trim().regex(/^[A-Za-z0-9._-]{1,64}$/),
  question: z.string().trim().min(2).max(1000),
  lang: z.enum(["ar", "en"]).default("ar"),
});

const err = (status: number, code: string) =>
  new Response(JSON.stringify({ error: code }), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/instrument-assistant")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return err(401, "UNAUTHENTICATED");
        const { data: claims } = await getPublicClient().auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (!userId) return err(401, "UNAUTHENTICATED");

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return err(400, "INVALID_INPUT");

        if (!(await checkRateLimit(`assistant:${userId}`, DAILY_LIMIT, 86_400))) return err(429, "RATE_LIMITED");

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return err(500, "NOT_CONFIGURED");

        const ctx = await buildInstrumentContext(parsed.data.slug).catch(() => null);
        if (!ctx) return err(404, "NOT_FOUND");

        try {
          const stream = await streamAnswer({ apiKey, context: ctx.context, question: parsed.data.question, lang: parsed.data.lang, signal: request.signal });
          return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
        } catch (e) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          const status = e instanceof Response ? e.status : 502;
          return err(status === 402 || status === 429 || status === 403 ? status : 502, "AI_FAILED");
        }
      },
    },
  },
});
