import { createHmac } from "crypto";

/** A signed cron request is accepted this long after (and before) its timestamp. */
export const CRON_SIGNATURE_MAX_AGE_SECONDS = 300;

/**
 * The signature an external scheduler sends to POST /api/public/cron-alerts
 * in x-signature: hex HMAC-SHA256 (CRON_ALERTS_SECRET) of
 * "<x-timestamp>.<raw body>", where x-timestamp is the Unix time in seconds.
 * Signing the timestamp makes a captured request useless once it is older
 * than CRON_SIGNATURE_MAX_AGE_SECONDS.
 */
export function cronSignature(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Whether x-timestamp is a Unix time in seconds within the accepted window. */
export function isFreshCronTimestamp(timestamp: string, nowMs = Date.now()): boolean {
  if (!/^\d{9,11}$/.test(timestamp)) return false;
  return Math.abs(nowMs / 1000 - Number(timestamp)) <= CRON_SIGNATURE_MAX_AGE_SECONDS;
}
