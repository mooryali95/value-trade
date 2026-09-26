import type { z } from "zod";

/**
 * Validates a server function's input. A failure reaches the browser as the
 * stable code INVALID_INPUT, never as zod's issue dump (which quotes field
 * names and the rules they broke).
 */
export function parseOr<T>(schema: z.ZodType<T>, input: unknown, code = "INVALID_INPUT"): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error(code);
  return parsed.data;
}
