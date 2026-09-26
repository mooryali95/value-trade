// Exact money arithmetic, mirroring the database.
//
// Amounts are integer cents (BigInt) and quantities integer 1/10000 units,
// so nothing is lost to binary floating point. Rounding is half away from
// zero on the cent, like PostgreSQL's round(numeric, 2):
//   mulCents(q, p)          = round(q * p, 2)                (a fill amount)
//   prorataCents(c, part, w) = round(c * part / w, 2)       (money_prorata)
// Numbers from the database arrive as JS numbers (PostgREST numeric) or
// numeric strings; both are read as the decimal they print as.

const QTY_SCALE = 4n; // positions.qty is numeric(18,4)
const TEN = 10n;

function pow10(n: bigint): bigint {
  return TEN ** n;
}

/** n / d rounded half away from zero. d must not be 0. */
export function roundDivHalfAway(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError("division by zero");
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (2n * an + ad) / (2n * ad);
  return negative ? -q : q;
}

const DECIMAL = /^([+-])?(\d+)(?:\.(\d*))?$/;

/**
 * A decimal (number or numeric string) as an integer at 10^scale, rounded
 * half away from zero. null when it is not a finite decimal.
 */
export function toScaled(v: number | string | null | undefined, scale: number): bigint | null {
  if (v == null) return null;
  let s: string;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || Math.abs(v) >= 1e21) return null;
    s = String(v);
    // Exponent form (1e-7): expand it.
    if (/e/i.test(s)) s = v.toFixed(20);
  } else {
    s = v.trim();
  }
  const m = DECIMAL.exec(s);
  if (!m) return null;
  const sign = m[1] === "-" ? -1n : 1n;
  const intPart = m[2] ?? "0";
  const frac = m[3] ?? "";
  const kept = frac.slice(0, scale).padEnd(scale, "0");
  let n = BigInt(intPart) * pow10(BigInt(scale)) + BigInt(kept || "0");
  const next = frac.charCodeAt(scale) - 48; // digit after the kept ones
  if (next >= 5 && next <= 9) n += 1n;
  return sign * n;
}

/** A money amount (number or numeric string) in cents; null if not a finite decimal. */
export function toCents(v: number | string | null | undefined): bigint | null {
  return toScaled(v, 2);
}

/** A quantity in 1/10000 units. */
export function toQty4(v: number | string | null | undefined): bigint | null {
  return toScaled(v, Number(QTY_SCALE));
}

/** round(qty * price, 2) in cents: the amount a fill moves in the ledger. */
export function mulCents(qty: number | string, price: number | string): bigint {
  const q = toScaled(qty, 4);
  const p = toScaled(price, 4);
  if (q == null || p == null) return 0n;
  return roundDivHalfAway(q * p, pow10(6n));
}

/**
 * round(amount * part / whole, 2) in cents (SQL money_prorata): the cost
 * share of `part` units out of `whole`. part and whole are in 1/10000 units.
 */
export function prorataCents(amountCents: bigint, part4: bigint, whole4: bigint): bigint {
  if (whole4 === 0n) return 0n;
  return roundDivHalfAway(amountCents * part4, whole4);
}

/** Cents as a JS number of currency units (exact to the cent for |c| < 2^53). */
export function centsToNumber(c: bigint): number {
  const n = Number(c) / 100;
  return Object.is(n, -0) ? 0 : n;
}

/** 1/10000 units as a JS number. */
export function qty4ToNumber(q: bigint): number {
  const n = Number(q) / 10000;
  return Object.is(n, -0) ? 0 : n;
}

/** Cents as a plain decimal string with exactly two decimals ("-12.30"), for exports. */
export function centsToFixed(c: bigint): string {
  const negative = c < 0n;
  const a = negative ? -c : c;
  const whole = a / 100n;
  const frac = (a % 100n).toString().padStart(2, "0");
  return `${negative && a !== 0n ? "-" : ""}${whole.toString()}.${frac}`;
}

/** A currency number rounded to the cent, never -0 (for values already computed in JS). */
export function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const c = toCents(n);
  return c == null ? 0 : centsToNumber(c);
}
