// Deterministic mock data for 256 brands + candles + orders.

export type Sector =
  | "tech" | "fintech" | "food" | "fashion" | "media" | "health"
  | "energy" | "logistics" | "realestate" | "education" | "retail" | "auto";

export type ShariahStatus = "halal" | "reviewing" | "restricted";

export type AssetClass = "brand" | "stock" | "sukuk";

export type Brand = {
  id: string;
  slug: string;
  symbol: string;
  nameAr: string;
  nameEn: string;
  sector: Sector;
  companyId: string;
  companyNameAr: string;
  companyNameEn: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  shariah: ShariahStatus;
  instrument: "equity" | "sukuk" | "mudarabah";
  established: number;
  color: string;
  assetClass?: AssetClass;
  // Stock-only
  exchange?: "TADAWUL" | "DFM" | "ADX" | "MSM" | "BSE";
  pe?: number;
  divYield?: number;
  // Sukuk-only
  issuer?: string;
  couponPct?: number;
  ytmPct?: number;
  maturity?: string; // ISO date
  tenorYears?: number;
};

const sectors: Sector[] = ["tech","fintech","food","fashion","media","health","energy","logistics","realestate","education","retail","auto"];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const ARABIC_ROOTS = ["نور","بيت","درة","واحة","نجم","قصر","تاج","برج","سما","بحر","جبل","نخيل","ذهب","لؤلؤ","فجر","شمس","قمر","ريان","مسك","عود","صقر","رياض","مدى","أفق","رمال","واثق","أصيل","صدى","نبض","وسام"];
const ARABIC_SUFFIX = ["للتقنية","الغذائية","للأزياء","الطبية","للطاقة","للاستثمار","العقارية","للنقل","للتعليم","للإعلام","للتجزئة","للسيارات","المالية","للمنتجات","للخدمات"];
const EN_ROOTS = ["Noor","Beit","Durra","Waha","Najm","Qasr","Taj","Burj","Sama","Bahr","Jabal","Nakhil","Dhahab","Loloa","Fajr","Shams","Qamar","Rayan","Musk","Oud","Saqr","Riyad","Mada","Ufuq","Rimal","Wathiq","Aseel","Sada","Nabd","Wisam"];
const EN_SUFFIX = ["Tech","Foods","Fashion","Health","Energy","Capital","Estates","Logistics","Learning","Media","Retail","Motors","Finance","Group","Ventures"];

const COMPANIES = [
  { id: "co-qeema", ar: "قيمة القابضة", en: "Qeema Holding" },
  { id: "co-mada", ar: "مدى للاستثمار", en: "Mada Investments" },
  { id: "co-ufuq", ar: "أفق العربية", en: "Ufuq Arabia" },
  { id: "co-loloa", ar: "لؤلؤ الخليج", en: "Loloa Gulf" },
  { id: "co-najm", ar: "مجموعة نجم", en: "Najm Group" },
  { id: "co-sama", ar: "سما للاستثمار", en: "Sama Ventures" },
  { id: "co-burj", ar: "برج القابضة", en: "Burj Holding" },
  { id: "co-durra", ar: "درة العربية", en: "Durra Arabia" },
];

// Luxury brand palette — muted, deep, editorial. Ink / gold / burgundy / emerald / copper / graphite.
const LUXURY_PALETTE = [
  "oklch(0.24 0.05 260)", // deep ink
  "oklch(0.52 0.13 72)",  // gold deep
  "oklch(0.36 0.13 24)",  // burgundy
  "oklch(0.42 0.09 158)", // emerald
  "oklch(0.5 0.12 45)",   // copper
  "oklch(0.32 0.03 260)", // graphite
  "oklch(0.44 0.1 230)",  // slate blue
  "oklch(0.4 0.11 340)",  // plum
];
function goldenColor(i: number) {
  return LUXURY_PALETTE[i % LUXURY_PALETTE.length];
}

function generateBrands(): Brand[] {
  const rand = seededRandom(4242);
  const brands: Brand[] = [];
  for (let i = 0; i < 256; i++) {
    const rootIdx = i % ARABIC_ROOTS.length;
    const sufIdx = (i * 7) % ARABIC_SUFFIX.length;
    const nameAr = `${ARABIC_ROOTS[rootIdx]} ${ARABIC_SUFFIX[sufIdx]}`;
    const nameEn = `${EN_ROOTS[rootIdx]} ${EN_SUFFIX[sufIdx]}`;
    const sector = sectors[i % sectors.length];
    const company = COMPANIES[i % COMPANIES.length];
    const symbol = `${EN_ROOTS[rootIdx].slice(0, 3).toUpperCase()}${(i + 1).toString().padStart(3, "0")}`;
    const basePrice = 5 + rand() * 495;
    const change = (rand() - 0.5) * 12;
    const vol = Math.floor(rand() * 5_000_000) + 50_000;
    const cap = basePrice * (100_000 + Math.floor(rand() * 9_000_000));
    const shariahRoll = rand();
    const shariah: ShariahStatus = shariahRoll > 0.92 ? "reviewing" : shariahRoll > 0.98 ? "restricted" : "halal";
    const instRoll = rand();
    const instrument = instRoll > 0.85 ? "sukuk" : instRoll > 0.75 ? "mudarabah" : "equity";
    brands.push({
      id: `brand-${i + 1}`,
      slug: symbol.toLowerCase(),
      symbol,
      nameAr,
      nameEn,
      sector,
      companyId: company.id,
      companyNameAr: company.ar,
      companyNameEn: company.en,
      price: Number(basePrice.toFixed(2)),
      change24h: Number(change.toFixed(2)),
      volume24h: vol,
      marketCap: Math.floor(cap),
      shariah,
      instrument,
      established: 2005 + (i % 20),
      color: goldenColor(i),
      assetClass: "brand",
    });
  }
  return brands;
}

const BASE_BRANDS: Brand[] = generateBrands();

// Curated GCC stocks (mock but realistic tickers/sectors — for demo only)
const STOCK_SEED: Array<{ sym: string; ar: string; en: string; ex: Brand["exchange"]; sec: Sector; px: number; halal: ShariahStatus }> = [
  { sym: "2222", ar: "أرامكو السعودية", en: "Saudi Aramco", ex: "TADAWUL", sec: "energy", px: 28.4, halal: "halal" },
  { sym: "1120", ar: "الراجحي", en: "Al Rajhi Bank", ex: "TADAWUL", sec: "fintech", px: 92.1, halal: "halal" },
  { sym: "7010", ar: "الاتصالات السعودية", en: "STC", ex: "TADAWUL", sec: "tech", px: 39.8, halal: "halal" },
  { sym: "2010", ar: "سابك", en: "SABIC", ex: "TADAWUL", sec: "energy", px: 74.3, halal: "halal" },
  { sym: "4013", ar: "الدواء", en: "Al Dawaa Medical", ex: "TADAWUL", sec: "health", px: 66.0, halal: "halal" },
  { sym: "4001", ar: "أسواق العثيم", en: "Othaim Markets", ex: "TADAWUL", sec: "retail", px: 12.6, halal: "halal" },
  { sym: "4002", ar: "مركز الرعاية الطبية", en: "Care Medical", ex: "TADAWUL", sec: "health", px: 138.0, halal: "halal" },
  { sym: "EMAAR", ar: "إعمار العقارية", en: "Emaar Properties", ex: "DFM", sec: "realestate", px: 8.2, halal: "reviewing" },
  { sym: "ADCB", ar: "بنك أبوظبي التجاري", en: "ADCB", ex: "ADX", sec: "fintech", px: 9.4, halal: "reviewing" },
  { sym: "SALIK", ar: "سالك", en: "Salik", ex: "DFM", sec: "logistics", px: 5.1, halal: "halal" },
  { sym: "OMTL", ar: "عمانتل", en: "Omantel", ex: "MSM", sec: "tech", px: 0.83, halal: "halal" },
  { sym: "BHTL", ar: "بتلكو", en: "Batelco", ex: "BSE", sec: "tech", px: 0.42, halal: "halal" },
];

function generateStocks(): Brand[] {
  const rand = seededRandom(9131);
  return STOCK_SEED.map((s, i) => {
    const change = (rand() - 0.5) * 6;
    const cap = s.px * (500_000_000 + Math.floor(rand() * 3_000_000_000));
    return {
      id: `stock-${s.sym}`,
      slug: s.sym.toLowerCase(),
      symbol: s.sym,
      nameAr: s.ar,
      nameEn: s.en,
      sector: s.sec,
      companyId: `co-${s.sym.toLowerCase()}`,
      companyNameAr: s.ar,
      companyNameEn: s.en,
      price: Number(s.px.toFixed(2)),
      change24h: Number(change.toFixed(2)),
      volume24h: Math.floor(rand() * 12_000_000) + 500_000,
      marketCap: Math.floor(cap),
      shariah: s.halal,
      instrument: "equity" as const,
      established: 1970 + (i * 3),
      color: LUXURY_PALETTE[i % LUXURY_PALETTE.length],
      assetClass: "stock" as const,
      exchange: s.ex,
      pe: Number((12 + rand() * 22).toFixed(1)),
      divYield: Number((1 + rand() * 5).toFixed(2)),
    } satisfies Brand;
  });
}

// Curated sovereign & corporate sukuk (mock)
const SUKUK_SEED: Array<{ sym: string; ar: string; en: string; issuer: string; coupon: number; tenor: number; halal: ShariahStatus }> = [
  { sym: "KSA-30", ar: "صكوك حكومة السعودية 2030", en: "KSA Govt Sukuk 2030", issuer: "MoF KSA", coupon: 4.5, tenor: 6, halal: "halal" },
  { sym: "KSA-33", ar: "صكوك حكومة السعودية 2033", en: "KSA Govt Sukuk 2033", issuer: "MoF KSA", coupon: 4.75, tenor: 9, halal: "halal" },
  { sym: "IDB-28", ar: "صكوك البنك الإسلامي للتنمية", en: "IsDB Sukuk 2028", issuer: "IsDB", coupon: 4.25, tenor: 4, halal: "halal" },
  { sym: "ARB-31", ar: "صكوك الراجحي 2031", en: "Al Rajhi Sukuk 2031", issuer: "Al Rajhi", coupon: 5.0, tenor: 7, halal: "halal" },
  { sym: "STC-29", ar: "صكوك STC 2029", en: "STC Sukuk 2029", issuer: "STC", coupon: 4.85, tenor: 5, halal: "halal" },
  { sym: "DPW-32", ar: "صكوك موانئ دبي 2032", en: "DP World Sukuk 2032", issuer: "DP World", coupon: 5.4, tenor: 8, halal: "halal" },
  { sym: "EMR-27", ar: "صكوك إعمار 2027", en: "Emaar Sukuk 2027", issuer: "Emaar", coupon: 4.65, tenor: 3, halal: "halal" },
  { sym: "QAT-34", ar: "صكوك قطر السيادية 2034", en: "Qatar Sovereign Sukuk 2034", issuer: "MoF Qatar", coupon: 4.4, tenor: 10, halal: "halal" },
];

function generateSukuk(): Brand[] {
  const rand = seededRandom(7373);
  const now = new Date();
  return SUKUK_SEED.map((s, i) => {
    const price = 98 + rand() * 6; // clean price near par
    const ytm = s.coupon + (rand() - 0.5) * 1.2;
    const maturity = new Date(now.getFullYear() + s.tenor, 6, 15).toISOString().slice(0, 10);
    return {
      id: `sukuk-${s.sym}`,
      slug: s.sym.toLowerCase(),
      symbol: s.sym,
      nameAr: s.ar,
      nameEn: s.en,
      sector: "fintech" as Sector,
      companyId: `iss-${s.issuer.toLowerCase().replace(/\s/g, "-")}`,
      companyNameAr: s.issuer,
      companyNameEn: s.issuer,
      price: Number(price.toFixed(2)),
      change24h: Number(((rand() - 0.5) * 0.6).toFixed(2)),
      volume24h: Math.floor(rand() * 800_000) + 20_000,
      marketCap: Math.floor(price * 1_000_000_000),
      shariah: s.halal,
      instrument: "sukuk" as const,
      established: now.getFullYear() - 1,
      color: LUXURY_PALETTE[(i + 3) % LUXURY_PALETTE.length],
      assetClass: "sukuk" as const,
      issuer: s.issuer,
      couponPct: s.coupon,
      ytmPct: Number(ytm.toFixed(2)),
      maturity,
      tenorYears: s.tenor,
    } satisfies Brand;
  });
}

export const STOCKS: Brand[] = generateStocks();
export const SUKUK: Brand[] = generateSukuk();
export const BRANDS: Brand[] = [...BASE_BRANDS, ...STOCKS, ...SUKUK];

export function getBrand(slug: string): Brand | undefined {
  const key = slug.toLowerCase();
  return BRANDS.find((b) => b.slug === key || b.symbol.toLowerCase() === key);
}

export function getCompanyBrands(companyId: string): Brand[] {
  return BRANDS.filter((b) => b.companyId === companyId);
}

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

export function generateCandles(seedStr: string, count = 180, basePrice = 100): Candle[] {
  const seed = seedStr.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = seededRandom(seed);
  const candles: Candle[] = [];
  let price = basePrice;
  const now = Math.floor(Date.now() / 1000);
  const step = 60 * 60 * 4; // 4h
  for (let i = count; i > 0; i--) {
    const time = now - i * step;
    const drift = (rand() - 0.48) * price * 0.03;
    const open = price;
    const close = Math.max(0.1, price + drift);
    const high = Math.max(open, close) + rand() * price * 0.015;
    const low = Math.min(open, close) - rand() * price * 0.015;
    const volume = Math.floor(rand() * 100_000) + 5000;
    candles.push({
      time,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume,
    });
    price = close;
  }
  return candles;
}

export type OrderRow = { price: number; qty: number; total: number };

export function generateOrderBook(basePrice: number, seedStr: string): { bids: OrderRow[]; asks: OrderRow[] } {
  const seed = seedStr.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = seededRandom(seed + 7);
  const bids: OrderRow[] = [];
  const asks: OrderRow[] = [];
  for (let i = 1; i <= 12; i++) {
    const bp = Number((basePrice - i * basePrice * 0.001 * (0.5 + rand())).toFixed(2));
    const ap = Number((basePrice + i * basePrice * 0.001 * (0.5 + rand())).toFixed(2));
    const bq = Math.floor(rand() * 900) + 100;
    const aq = Math.floor(rand() * 900) + 100;
    bids.push({ price: bp, qty: bq, total: Number((bp * bq).toFixed(2)) });
    asks.push({ price: ap, qty: aq, total: Number((ap * aq).toFixed(2)) });
  }
  return { bids, asks };
}

export const MARKET_STATS = {
  totalMarketCap: BRANDS.reduce((s, b) => s + b.marketCap, 0),
  dayVolume: BRANDS.reduce((s, b) => s + b.volume24h, 0),
  activeInstruments: BRANDS.length,
  isOpen: true,
};

export const SHARIAH_BOARD = [
  { nameAr: "د. أحمد الرشيد", nameEn: "Dr. Ahmed Al-Rashid", roleAr: "رئيس الهيئة", roleEn: "Chairman" },
  { nameAr: "د. سارة الدوسري", nameEn: "Dr. Sarah Al-Dosari", roleAr: "عضو", roleEn: "Member" },
  { nameAr: "د. خالد المنصور", nameEn: "Dr. Khalid Al-Mansour", roleAr: "عضو", roleEn: "Member" },
  { nameAr: "د. فاطمة الحربي", nameEn: "Dr. Fatima Al-Harbi", roleAr: "عضو", roleEn: "Member" },
];

export const SHARIAH_STANDARDS = [
  { code: "AAOIFI-21", ar: "صكوك الاستثمار", en: "Investment Sukuk" },
  { code: "AAOIFI-30", ar: "المتاجرة في العملات", en: "Currency Trading" },
  { code: "AAOIFI-12", ar: "الشركة والشركات الحديثة", en: "Modern Corporations" },
  { code: "AAOIFI-17", ar: "صكوك الاستثمار العامة", en: "General Investment Sukuk" },
  { code: "AAOIFI-14", ar: "بطاقات الائتمان والحسم", en: "Debit & Credit Cards" },
];