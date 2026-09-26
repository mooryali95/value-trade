import { cleanZero, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export type NumKind = "number" | "currency" | "pct" | "qty";

const LOCALE = "en-US";

/**
 * Formats a number the way <Num> shows it (without the wrapper), "—" when
 * there is no value. Exposed for places that need a string (titles, CSV).
 *   currency: 2 decimals, grouping ("1,234.56")
 *   number:   2 decimals by default (prices), grouping
 *   qty:      whole units with grouping; legacy fractional units keep up to 4 decimals
 *   pct:      the value is already in percent (12.5 -> "12.50%")
 */
export function formatNum(
  value: number | null | undefined,
  kind: NumKind = "number",
  opts: { signed?: boolean; decimals?: number } = {},
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (kind === "pct") {
    const s = formatPct(value, opts.decimals ?? 2);
    // formatPct signs positives already; unsigned mode drops the "+".
    return opts.signed ? s : s.replace(/^\+/, "");
  }
  const min = kind === "qty" ? (opts.decimals ?? 0) : (opts.decimals ?? 2);
  const max = kind === "qty" ? Math.max(min, opts.decimals ?? 4) : min;
  const v = cleanZero(value, max);
  const text = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max }).format(v);
  return opts.signed && v > 0 ? `+${text}` : text;
}

/**
 * A number in running text or a table cell. Always left-to-right and
 * direction-isolated, so "-1,234.56" or "+2.50%" keeps its sign in place
 * inside Arabic (RTL) text; tabular figures so columns line up. Shows "—"
 * for a missing or non-finite value and never a negative zero.
 */
export function Num({
  value,
  kind = "number",
  signed = false,
  decimals,
  className,
}: {
  value: number | null | undefined;
  kind?: NumKind;
  signed?: boolean;
  decimals?: number;
  className?: string;
}) {
  return (
    <span dir="ltr" className={cn("whitespace-nowrap tabular-nums", className)} style={{ unicodeBidi: "isolate" }}>
      {formatNum(value, kind, { signed, decimals })}
    </span>
  );
}
