// Server-only constant-time comparison for secrets (API keys, bearer tokens,
// HMAC signatures). Both inputs are hashed to fixed-length SHA-256 digests, so
// timingSafeEqual always compares equal-length buffers and neither the content
// nor the length of the expected secret leaks through timing.
import { createHash, timingSafeEqual } from "crypto";

export function safeEqualSecret(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Extracts the token from an `Authorization: Bearer <token>` header value. */
export function bearerToken(header: string | null | undefined): string {
  const m = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());
  return m ? m[1]!.trim() : "";
}
