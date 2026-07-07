// Deterministic mock data for 256 brands + candles + orders.

export type Sector =
  | "tech" | "fintech" | "food" | "fashion" | "media" | "health"
  | "energy" | "logistics" | "realestate" | "education" | "retail" | "auto";

export type ShariahStatus = "halal" | "reviewing" | "restricted";

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

function goldenColor(i: number) {
  const hue = (i * 137.508) % 360;
  return `hsl(${hue.toFixed(0)} 55% 55%)`;
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
    });
  }
  return brands;
}

export const BRANDS: Brand[] = generateBrands();

export function getBrand(slug: string): Brand | undefined {
  return BRANDS.find((b) => b.slug === slug);
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