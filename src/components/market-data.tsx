import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, ShieldWarning, Hourglass, Storefront, CloudSlash, ArrowClockwise } from "@phosphor-icons/react";
import { useI18n, type Key, type Lang } from "@/lib/i18n";
import { useErrorMessage } from "@/hooks/use-error-message";
import { Num } from "@/components/num";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import {
  getMarketOverview,
  type MarketOverview,
  type PublicInstrument,
  type ShariahStatus,
} from "@/lib/market/public-market.functions";
import { ASSET_CLASS_LABEL, isAssetClass } from "@/lib/market/asset-classes";

/**
 * Client helpers for the public market data (src/lib/market). Every number
 * shown through these comes from the database: a price is either the last
 * executed trade or the listing reference price, and the UI always says
 * which one it is. Nothing here generates or fills in data.
 */

export const MARKET_OVERVIEW_KEY = ["market-overview"] as const;

/** The public board. `initialData` is the route loader's result, when it has one. */
export function useMarketOverview(initialData?: MarketOverview | null, opts?: { enabled?: boolean }) {
  const fn = useServerFn(getMarketOverview);
  return useQuery({
    queryKey: MARKET_OVERVIEW_KEY,
    queryFn: () => fn(),
    initialData: initialData ?? undefined,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    enabled: opts?.enabled ?? true,
  });
}

/** How long a route loader waits for the overview before rendering without it. */
export const OVERVIEW_LOADER_TIMEOUT_MS = 5_000;

/**
 * Loader helper: the overview, or null when the database cannot be read or is
 * slower than OVERVIEW_LOADER_TIMEOUT_MS. A slow database must not hold the
 * whole page: with null the page renders at once and useMarketOverview fetches
 * the board in the browser (showing its loading, then data or error state).
 */
export async function loadOverviewOrNull(timeoutMs = OVERVIEW_LOADER_TIMEOUT_MS): Promise<MarketOverview | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([getMarketOverview(), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type Mark = { price: number; isReference: boolean };

/** Last traded price, else the listing reference price (flagged as such). */
export function markOf(i: Pick<PublicInstrument, "lastPrice" | "referencePrice">): Mark {
  return i.lastPrice != null
    ? { price: i.lastPrice, isReference: false }
    : { price: i.referencePrice, isReference: true };
}

export function instrumentName(i: { nameAr: string; nameEn: string }, lang: Lang): string {
  return lang === "ar" ? i.nameAr || i.nameEn : i.nameEn || i.nameAr;
}

export function indexBySymbol<T extends { symbol: string }>(list: T[] | undefined): Map<string, T> {
  const m = new Map<string, T>();
  for (const i of list ?? []) m.set(i.symbol.toUpperCase(), i);
  return m;
}

/** Trading day and timestamps are shown in Asia/Riyadh time, the engine's trading day. */
export const MARKET_TIME_ZONE = "Asia/Riyadh";

function dateLocale(lang: Lang) {
  return lang === "ar" ? "ar-u-nu-latn-ca-gregory" : "en-GB";
}

export function formatDateTime(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(dateLocale(lang), {
    timeZone: MARKET_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** A calendar date (Gregorian, Latin digits) in the market's time zone. */
export function formatDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(dateLocale(lang), {
    timeZone: MARKET_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Short day + time ("24 Sep, 10:12"), for trade tapes that span several days. */
export function formatShortDateTime(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(dateLocale(lang), {
    timeZone: MARKET_TIME_ZONE,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Same calendar day in the market's time zone. */
export function isSameMarketDay(a: string | Date, b: string | Date): boolean {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: MARKET_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date(a)) === f.format(new Date(b));
}

/** Time of day on the market clock, 24-hour (as the tape's older rows). */
export function formatTime(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(dateLocale(lang), {
    timeZone: MARKET_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

export function formatPrice(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/** Label for an approved asset class (src/lib/market/asset-classes.ts). */
export function assetClassLabel(assetClass: string, t: ReturnType<typeof useI18n>["t"]): string {
  return isAssetClass(assetClass) ? t(ASSET_CLASS_LABEL[assetClass]) : assetClass;
}

/** Visible class tag for an instrument row or header. */
export function AssetClassBadge({ assetClass }: { assetClass: string }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded border border-border bg-secondary/40 px-1.5 text-[10px] font-medium leading-4 text-ink-soft">
      {assetClassLabel(assetClass, t)}
    </span>
  );
}

/**
 * Sector label. Sectors are stored as free-text keys ("retail", "food");
 * the known ones are translated, anything else is shown as stored.
 */
const SECTOR_KEYS: Record<string, Key> = {
  retail: "u_sectorRetail",
  food: "u_sectorFood",
  fashion: "u_sectorFashion",
  hospitality: "u_sectorHospitality",
  fintech: "u_sectorFintech",
  tech: "u_sectorTech",
  energy: "u_sectorEnergy",
  health: "u_sectorHealth",
  logistics: "u_sectorLogistics",
  realestate: "u_sectorRealEstate",
  education: "u_sectorEducation",
  media: "u_sectorMedia",
  auto: "u_sectorAuto",
};
/** The sectors the platform names (stored lower-case, labelled by sectorLabel). */
export const SECTORS = Object.keys(SECTOR_KEYS);

export function sectorLabel(sector: string | null | undefined, t: ReturnType<typeof useI18n>["t"]): string {
  if (!sector) return "";
  const key = SECTOR_KEYS[sector.trim().toLowerCase()];
  return key ? t(key) : sector;
}

/**
 * "5 listed instruments" with the correct plural form (Arabic has six:
 * zero, one, two, few, many, other).
 */
export function listedCountText(n: number, t: ReturnType<typeof useI18n>["t"], lang: Lang): string {
  const cat = n === 0 ? "zero" : new Intl.PluralRules(lang === "ar" ? "ar" : "en").select(n);
  const key = (
    {
      zero: "u_listedN_zero",
      one: "u_listedN_one",
      two: "u_listedN_two",
      few: "u_listedN_few",
      many: "u_listedN_many",
    } as Record<string, Key>
  )[cat] ?? "u_listedN_other";
  return t(key).replace("{n}", new Intl.NumberFormat("en-US").format(n));
}

/** Deterministic decorative colour for an instrument's monogram (not data). */
const MONOGRAM_PALETTE = [
  "oklch(0.24 0.05 260)",
  "oklch(0.52 0.13 72)",
  "oklch(0.36 0.13 24)",
  "oklch(0.42 0.09 158)",
  "oklch(0.5 0.12 45)",
  "oklch(0.32 0.03 260)",
  "oklch(0.44 0.1 230)",
  "oklch(0.4 0.11 340)",
];
export function monogramColor(symbol: string): string {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return MONOGRAM_PALETTE[h % MONOGRAM_PALETTE.length];
}

/**
 * Decorative symbol tile. Shows the whole symbol (up to 5 characters), so
 * instruments sharing a prefix stay distinguishable.
 */
export function Monogram({ symbol, className }: { symbol: string; className?: string }) {
  const label = symbol.slice(0, 5);
  return (
    <div
      aria-hidden
      dir="ltr"
      className={`grid shrink-0 place-items-center overflow-hidden rounded-lg font-bold leading-none text-ivory ring-1 ring-inset ring-white/10 ${className ?? "h-9 w-9"}`}
      style={{ background: monogramColor(symbol), containerType: "size" }}
    >
      <span style={{ fontSize: label.length > 4 ? "21cqw" : label.length > 3 ? "25cqw" : "30cqw" }} className="block">
        {label}
      </span>
    </div>
  );
}

/** A price with a visible "reference" tag when no trade has happened yet. */
export function PriceText({ mark, className }: { mark: Mark; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex items-baseline gap-1 ${className ?? ""}`}>
      <Num value={mark.price} className="font-mono" />
      {mark.isReference && (
        <span
          className="rounded border border-border px-1 text-[10px] font-medium not-italic leading-4 text-muted-foreground"
          title={t("e2_referencePriceHint")}
        >
          {t("e2_refShort")}
        </span>
      )}
    </span>
  );
}

/** 24h change, or a dash when there is no comparable trade. */
export function ChangeText({ pct, className }: { pct: number | null; className?: string }) {
  if (pct == null) return <span className={`font-mono text-muted-foreground ${className ?? ""}`}>—</span>;
  const rounded = Math.round(pct * 100) / 100;
  const tone = rounded > 0 ? "text-[var(--bull)]" : rounded < 0 ? "text-[var(--bear)]" : "text-muted-foreground";
  return <Num value={pct} kind="pct" signed className={`font-mono ${tone} ${className ?? ""}`} />;
}

/** The Shariah ruling in force, or "no ruling yet". */
export function ShariahPill({ status, compact }: { status: ShariahStatus | null; compact?: boolean }) {
  const { t } = useI18n();
  const cfg =
    status === "halal"
      ? { cls: "border-[var(--bull)]/30 bg-[var(--bull)]/10 text-[var(--bull)]", label: t("e2_shariahHalal"), Icon: ShieldCheck }
      : status === "non_halal"
        ? { cls: "border-[var(--bear)]/30 bg-[var(--bear)]/10 text-[var(--bear)]", label: t("e2_shariahNonHalal"), Icon: ShieldWarning }
        : status === "reviewing"
          ? { cls: "border-border bg-secondary/40 text-ink-soft", label: t("e2_shariahReviewing"), Icon: Hourglass }
          : { cls: "border-border bg-background text-muted-foreground", label: t("e2_shariahNone"), Icon: Hourglass };
  if (compact) {
    return (
      <span title={cfg.label} aria-label={cfg.label} className={status === "halal" ? "text-[var(--bull)]" : status === "non_halal" ? "text-[var(--bear)]" : "text-muted-foreground"}>
        <cfg.Icon size={14} weight="duotone" />
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${cfg.cls}`}>
      <cfg.Icon size={12} weight="duotone" />
      {cfg.label}
    </span>
  );
}

/** Designed empty state for a market with no published instrument yet. */
export function NoListingsState({ compact }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={<Storefront size={22} weight="duotone" />}
      title={t("e2_noListingsTitle")}
      description={compact ? t("e2_noListingsShort") : t("e2_noListingsDesc")}
      action={
        <Link
          to="/request-access"
          search={{ kind: "new" }}
          className="inline-flex min-h-11 items-center rounded-md gold-gradient px-5 text-sm font-semibold text-ink"
        >
          {t("e2_requestAccessCompanies")}
        </Link>
      }
    />
  );
}

/** Inline, retryable error for a market data panel. */
export function MarketDataError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const errorMessage = useErrorMessage();
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-xl border border-[var(--bear)]/25 bg-[var(--bear)]/5 px-4 py-6 text-center"
    >
      <span className="grid h-10 w-10 place-items-center rounded-full border border-[var(--bear)]/25 bg-card text-[var(--bear)]">
        <CloudSlash size={20} weight="duotone" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-ink">{t("e2_marketDataUnavailableTitle")}</p>
      <p className="max-w-sm text-xs leading-relaxed text-ink-soft">
        {errorMessage(error, { MARKET_DATA_UNAVAILABLE: "e2_marketDataUnavailable" })}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex min-h-10 items-center gap-1.5 rounded-md border border-[var(--gold)]/50 bg-card px-4 text-xs font-semibold text-[var(--gold-ink)] transition hover:bg-[var(--gold-soft)]"
        >
          <ArrowClockwise size={14} weight="bold" aria-hidden />
          {t("tryAgain")}
        </button>
      )}
    </div>
  );
}

/** Route-level error for a page whose loader could not read the market data. */
export function InstrumentLoadError({ error, reset }: { error: unknown; reset: () => void }) {
  const errorMessage = useErrorMessage();
  return (
    <ErrorState
      reset={reset}
      description={errorMessage(error, { MARKET_DATA_UNAVAILABLE: "e2_marketDataUnavailable" })}
    />
  );
}
