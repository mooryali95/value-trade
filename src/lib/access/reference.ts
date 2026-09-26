/**
 * Access request references. New requests get a short code (VU-XXXX-XXXX,
 * 8 symbols from a 32-letter alphabet without 0/O/1/I); requests filed
 * before the codes existed are referenced by their full id (a UUID).
 */

export const REF_CODE_RE = /^VU-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalises what an applicant types (case, spaces, missing dashes, the
 * look-alike letters O/I for 0/1 are not in the alphabet so they are left to
 * fail). Returns the canonical reference, or null when it cannot be one.
 */
export function normalizeReference(input: string): string | null {
  const raw = (input ?? "").trim();
  if (UUID_RE.test(raw)) return raw.toLowerCase();
  const compact = raw.toUpperCase().replace(/[\s-]/g, "");
  const body = compact.startsWith("VU") ? compact.slice(2) : compact;
  if (body.length !== 8) return null;
  const code = `VU-${body.slice(0, 4)}-${body.slice(4)}`;
  return REF_CODE_RE.test(code) ? code : null;
}
