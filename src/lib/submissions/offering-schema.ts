/**
 * Class-specific prospectus fields captured by the offering form and stored
 * in product_submissions.offering_details (jsonb). Client-safe.
 */
import type { AssetClass } from "@/lib/market/asset-classes";

export type OfferingField = {
  key: string;
  ar: string;
  en: string;
  kind: "text" | "longtext" | "number" | "date";
  required?: boolean;
};

const COMMON: OfferingField[] = [
  { key: "summary", ar: "ملخص الطرح", en: "Offering summary", kind: "longtext", required: true },
  { key: "issue_size_units", ar: "عدد الوحدات المطروحة", en: "Units offered", kind: "number", required: true },
  { key: "offering_price", ar: "سعر الطرح (ريال)", en: "Offering price (SAR)", kind: "number", required: true },
  { key: "min_subscription", ar: "الحد الأدنى للاكتتاب (وحدات)", en: "Minimum subscription (units)", kind: "number" },
  { key: "use_of_proceeds", ar: "استخدام متحصلات الطرح", en: "Use of proceeds", kind: "longtext" },
  { key: "risk_factors", ar: "عوامل المخاطر الرئيسية", en: "Key risk factors", kind: "longtext", required: true },
];

const BY_CLASS: Record<AssetClass, OfferingField[]> = {
  stock: [
    { key: "nominal_value", ar: "القيمة الاسمية للسهم (ريال)", en: "Nominal value per share (SAR)", kind: "number", required: true },
    { key: "shares_outstanding", ar: "إجمالي الأسهم المصدرة", en: "Shares outstanding", kind: "number", required: true },
    { key: "dividend_policy", ar: "سياسة توزيع الأرباح", en: "Dividend policy", kind: "longtext" },
  ],
  fund: [
    { key: "fund_manager", ar: "مدير الصندوق", en: "Fund manager", kind: "text", required: true },
    { key: "fund_type", ar: "نوع الصندوق (مفتوح/مغلق)", en: "Fund type (open/closed)", kind: "text", required: true },
    { key: "management_fee_pct", ar: "رسوم الإدارة السنوية (%)", en: "Annual management fee (%)", kind: "number" },
    { key: "valuation_frequency", ar: "دورية التقييم", en: "Valuation frequency", kind: "text" },
  ],
  sukuk: [
    { key: "sukuk_structure", ar: "هيكل الصكوك (إجارة، مرابحة...)", en: "Sukuk structure (Ijara, Murabaha...)", kind: "text", required: true },
    { key: "profit_rate_pct", ar: "معدل العائد المتوقع (%)", en: "Expected profit rate (%)", kind: "number", required: true },
    { key: "maturity_date", ar: "تاريخ الاستحقاق", en: "Maturity date", kind: "date", required: true },
    { key: "payment_frequency", ar: "دورية التوزيعات", en: "Distribution frequency", kind: "text" },
  ],
  brand: [],
};

export function offeringFields(cls: AssetClass): OfferingField[] {
  return [...COMMON, ...BY_CLASS[cls]];
}

/** Returns a clean details object or throws INVALID_INPUT. */
export function validateOfferingDetails(cls: AssetClass, raw: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const fields = offeringFields(cls);
  const allowed = new Set(fields.map((f) => f.key));
  for (const k of Object.keys(raw ?? {})) if (!allowed.has(k)) throw new Error("INVALID_INPUT");
  // Brand units keep the legacy short form; details are optional there.
  const enforce = cls !== "brand";
  for (const f of fields) {
    const v = (raw?.[f.key] ?? "").trim();
    if (!v) {
      if (enforce && f.required) throw new Error("INVALID_INPUT");
      continue;
    }
    if (v.length > 2000) throw new Error("INVALID_INPUT");
    if (f.kind === "number" && !(Number.isFinite(Number(v)) && Number(v) >= 0)) throw new Error("INVALID_INPUT");
    if (f.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("INVALID_INPUT");
    out[f.key] = v;
  }
  return out;
}
