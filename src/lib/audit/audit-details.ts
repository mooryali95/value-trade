import type { Key } from "@/lib/i18n";
import { companyRoleKey } from "@/lib/tenants/role-labels";

/**
 * The details of an audit row (audit_log.metadata) as labelled items for the
 * audit screen: known keys get a translated label, known values (yes/no,
 * roles, Shariah statuses, request kinds) a translated text, numbers and
 * identifiers a left-to-right form; nested objects become nested items. The
 * raw JSON stays in the CSV export.
 */
export type AuditValue =
  | { type: "empty" }
  | { type: "text"; text: string }
  | { type: "ltr"; text: string }
  | { type: "number"; value: number; kind: "number" | "qty" }
  | { type: "label"; key: Key }
  | { type: "id"; id: string }
  | { type: "sector"; sector: string }
  | { type: "group"; items: AuditItem[] };

export type AuditItem = { key: string; label: Key | null; value: AuditValue };

const KEY_LABELS: Record<string, Key> = {
  symbol: "e2_colSymbol",
  brandSymbol: "e2_colSymbol",
  slug: "fl_auditKey_slug",
  status: "fl_auditKey_status",
  previousStatus: "fl_auditKey_previousStatus",
  previousRuling: "fl_auditKey_previousRuling",
  changeReason: "changeReason",
  reason: "reason",
  changed: "fl_auditKey_changed",
  cancelledOrders: "fl_auditKey_cancelledOrders",
  from: "fl_auditKey_from",
  to: "fl_auditKey_to",
  referencePrice: "referencePrice",
  price: "price",
  qty: "qty",
  amount: "fl_auditKey_amount",
  submissionId: "fl_auditKey_submissionId",
  issuanceId: "fl_auditKey_issuanceId",
  holderId: "fl_auditKey_holderId",
  rulingRecorded: "fl_auditKey_rulingRecorded",
  rulingId: "fl_auditKey_rulingId",
  brandId: "fl_auditKey_brandId",
  targetUserId: "fl_auditKey_targetUserId",
  invitationId: "fl_auditKey_invitationId",
  role: "role",
  email: "email",
  emailSent: "fl_auditKey_emailSent",
  accountExists: "fl_auditKey_accountExists",
  kind: "fl_auditKey_kind",
  name_ar: "nameAr",
  name_en: "nameEn",
  sector: "sector",
};

const SHARIAH_KEYS: Record<string, Key> = {
  halal: "e2_shariahHalal",
  non_halal: "e2_shariahNonHalal",
  reviewing: "e2_shariahReviewing",
};

const REQUEST_KIND_KEYS: Record<string, Key> = {
  investor: "fl_auditKind_investor",
  join: "fl_auditKind_join",
  new_company: "fl_auditKind_new_company",
};

const QTY_KEYS = new Set(["qty", "cancelledOrders"]);
const LTR_KEYS = new Set(["symbol", "brandSymbol", "slug", "email"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

function valueOf(key: string, v: unknown, depth: number): AuditValue {
  if (v == null || v === "") return { type: "empty" };
  if (typeof v === "boolean") return { type: "label", key: v ? "fl_yes" : "fl_no" };
  if (typeof v === "number") {
    return Number.isFinite(v) ? { type: "number", value: v, kind: QTY_KEYS.has(key) ? "qty" : "number" } : { type: "text", text: String(v) };
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (key === "role" || key === "from" || key === "to") {
      const roleKey = companyRoleKey(s);
      if (roleKey) return { type: "label", key: roleKey };
    }
    if ((key === "status" || key === "previousStatus" || key === "previousRuling") && SHARIAH_KEYS[s]) {
      return { type: "label", key: SHARIAH_KEYS[s] };
    }
    if (key === "kind" && REQUEST_KIND_KEYS[s]) return { type: "label", key: REQUEST_KIND_KEYS[s] };
    if (key === "sector") return { type: "sector", sector: s };
    if (UUID_RE.test(s)) return { type: "id", id: s };
    if (LTR_KEYS.has(key)) return { type: "ltr", text: s };
    if (NUMERIC_RE.test(s) && KEY_LABELS[key] && key !== "reason" && key !== "changeReason") {
      return { type: "number", value: Number(s), kind: QTY_KEYS.has(key) ? "qty" : "number" };
    }
    return { type: "text", text: s };
  }
  if (Array.isArray(v)) {
    const parts = v.map((x) => (x == null ? "" : typeof x === "object" ? JSON.stringify(x) : String(x))).filter(Boolean);
    return parts.length ? { type: "text", text: parts.join(" · ") } : { type: "empty" };
  }
  if (typeof v === "object") {
    if (depth >= 2) return { type: "text", text: JSON.stringify(v) };
    const items = itemsOf(v as Record<string, unknown>, depth + 1);
    return items.length ? { type: "group", items } : { type: "empty" };
  }
  return { type: "text", text: String(v) };
}

// Items follow the order of KEY_LABELS (symbol first, "from" before "to"),
// unknown keys last: jsonb does not keep the order the keys were written in.
const KEY_ORDER = new Map(Object.keys(KEY_LABELS).map((k, i) => [k, i]));

function itemsOf(obj: Record<string, unknown>, depth: number): AuditItem[] {
  const rank = (k: string) => KEY_ORDER.get(k) ?? KEY_ORDER.size;
  return Object.entries(obj)
    .map(([k, v], i) => ({ i, item: { key: k, label: KEY_LABELS[k] ?? null, value: valueOf(k, v, depth) } }))
    .sort((a, b) => rank(a.item.key) - rank(b.item.key) || a.i - b.i)
    .map((x) => x.item);
}

export function auditDetailItems(metadata: unknown): AuditItem[] {
  if (metadata == null) return [];
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    const value = valueOf("", metadata, 0);
    return value.type === "empty" ? [] : [{ key: "", label: null, value }];
  }
  return itemsOf(metadata as Record<string, unknown>, 0);
}

/** A readable form of an unknown key ("cancelledOrders" -> "cancelled orders"). */
export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase();
}
