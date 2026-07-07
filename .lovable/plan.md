
# منصة قيمة — خطة البناء الشاملة

منصة تداول احترافية لوحدة القيمة (Value Unit) تدير 256 براند داخل الايكوسيستم، مع دعم متعدد المستأجرين (Multi-tenant) لتأجير المنصة للشركات، والتزام شرعي وفق معايير AAOIFI.

## الرؤية والمعمار

**نموذج ثلاثي المستويات:**
- **قيمة (Value Core):** المنصة الأم، تدير 256 براند الأصلية والسوق العام.
- **الشركات المستأجرة (Tenants):** كل شركة لها workspace خاص، براندات خاصة، سوق داخلي.
- **الطرح العام:** أي براند من أي شركة يمكن ترقيته للسوق العام بموافقة الصلاحية.

**الهوية البصرية:** Dubai Financial Luxury — كحلي عميق `#0B1F3A`، ذهبي `#C9A961`، أبيض عاجي، رمادي أزرق. خطوط: عربي (IBM Plex Sans Arabic) + لاتيني (Inter/Söhne-style). دعم RTL/LTR كامل من اليوم الأول.

---

## المرحلة 1 — الأساس البصري والهيكل (Design Foundation)

**النتيجة:** واجهة كاملة قابلة للتصفح ببيانات وهمية واقعية، بلا Backend.

- نظام تصميم Enterprise كامل: tokens، أزرار، جداول، بطاقات، مخططات شمعية Candlestick.
- شل التطبيق: هيدر مع مبدل لغة، سايدبار قابل للطي، تخطيط responsive (موبايل/آيباد/لابتوب).
- i18n كامل (عربي RTL أساسي + إنجليزي LTR) عبر مكتبة خفيفة داخلية.
- الصفحات الأساسية بواجهات فقط:
  - Landing عامة لمنصة قيمة (شرح المنظومة، 256 براند، عرض للشركات).
  - سوق عام (Market Overview) — شبكة 256 براند مع بحث/فلتر.
  - صفحة براند تفصيلية (Overview / Chart / Order Book / Financials / Shariah).
  - داشبورد تداول احترافي (Bloomberg-style): شارت شمعي، أوامر، محفظة، Watchlist.
  - ملف مستخدم شخصي، ملف شركة عام.
  - داشبورد شركة مستأجرة (Workspace).
  - صفحة الهيئة الشرعية.

## المرحلة 2 — المصادقة والحسابات (Lovable Cloud)

- تفعيل Lovable Cloud.
- تسجيل بالبريد + Google.
- جدول `profiles` مرتبط بـ `auth.users`.
- جدول `user_roles` منفصل (enum: `platform_admin`, `shariah_board`, `company_owner`, `brand_manager`, `trader`) + دالة `has_role` SECURITY DEFINER.
- صفحة `/auth` عامة، layout محمي `_authenticated`.
- صفحة `/reset-password`.
- تسجيل خروج نظيف (cancel queries → clear cache → signOut → navigate).

## المرحلة 3 — الشركات والبراندات (Multi-tenancy)

- جدول `companies` (شركات مستأجرة) + `company_members` (الأدوار داخل الشركة).
- جدول `brands` (البراند: اسم، شعار، تصنيف، company_id، شرعي/مشبوه/محرم، هل مطروح عام).
- جدول `brand_managers` (روابط دعوة للمسؤول المالي لكل براند).
- تدفق: صاحب الشركة يضيف براند → يُنشئ رابط دعوة → المسؤول المالي يقبل → يكمل ملف البراند.
- RLS كامل: كل شركة ترى بياناتها فقط، السوق العام يقرأ البراندات المطروحة فقط عبر policy `TO anon`.

## المرحلة 4 — التقييم والاكتتاب والصكوك

- جدول `valuations` (تقييم مبدئي، تاريخ، مقيّم).
- جدول `offerings` (اكتتاب: نوع [أسهم/صكوك/مضاربة/مشاركة]، سعر، كمية، تواريخ، حالة).
- جدول `subscriptions` (اكتتابات المستخدمين).
- تدفق الطرح: مسؤول براند → طلب اكتتاب → موافقة الشركة → موافقة الهيئة الشرعية → إطلاق.
- ترقية للسوق العام: موافقة صاحب الشركة + مراجعة قيمة.

## المرحلة 5 — محرك التداول والسوق

- جدول `instruments` (الأداة القابلة للتداول لكل براند/اكتتاب).
- جدول `orders` (Buy/Sell, Limit/Market, حالة، صلاحية).
- جدول `trades` (تنفيذ الأوامر بمطابقة Price-Time Priority مبسطة عبر Server Function).
- جدول `positions` (المحفظة لكل مستخدم).
- جدول `candles` (OHLCV، فترات 1m/5m/15m/1h/1d) — تُبنى من الصفقات.
- Market Hours: جدول `market_sessions` (فتح/إغلاق يومي + جلسات خاصة).
- تحديث حي عبر Supabase Realtime لأوامر/صفقات/شموع.
- شارت شمعي احترافي (lightweight-charts).

## المرحلة 6 — الشريعة والحوكمة

- جدول `shariah_standards` (معايير AAOIFI مرجعية).
- جدول `shariah_reviews` (مراجعة كل براند/اكتتاب: نتيجة، معيار، ملاحظات، مراجع).
- جدول `shariah_decisions` (قرارات الهيئة، توقيع، تاريخ).
- منع تلقائي للأدوات الربوية، حدود الرافعة، فلاتر النسب المالية.
- شارة "متوافق شرعياً" تظهر فقط بعد اعتماد.

## المرحلة 7 — الصقل والاحترافية

- Motion دقيق (Framer Motion) — انتقالات صفحات، دخول أوامر، وميض أسعار.
- SEO كامل لكل صفحة عامة (title/description/OG/twitter لكل route).
- تدقيق responsive شامل (320px → 2560px).
- توثيق تصميم داخلي (Design Tokens + Component Library) في `/docs`.
- سكان أمني + قواعد RLS مراجعة.

---

## التفاصيل التقنية

**Stack:** TanStack Start (موجود) + Lovable Cloud (Supabase) + Tailwind v4 + shadcn + lightweight-charts + Framer Motion + Supabase Realtime.

**تنظيم Routes:**
```text
/                          Landing قيمة العام
/market                    السوق العام (256 براند)
/market/$brandSlug         صفحة براند
/trade/$symbol             داشبورد تداول
/shariah                   الهيئة الشرعية
/auth, /reset-password     مصادقة (عامة)
/_authenticated/
  dashboard                لوحة المستخدم
  portfolio                المحفظة
  orders                   أوامري
  profile                  ملفي
  companies/$id            ملف شركة (عام لكن مخصص)
  workspace/               (شركات مستأجرة)
    overview
    brands
    brands/$id
    offerings
    members
    settings
  admin/                   (platform_admin فقط)
    brands, users, shariah, markets
```

**RLS Strategy:**
- Public reads فقط للبراندات `is_public=true` والصفقات المكتملة والشموع.
- Company data: عبر `company_members` membership check.
- User data: `auth.uid()` scoping.
- كل الأدوار عبر `has_role()` SECURITY DEFINER.

**Server Functions:**
- `placeOrder`, `cancelOrder`, `matchOrders` (محمية بـ `requireSupabaseAuth`).
- `submitBrandForReview`, `approveShariahReview` (محمية + role check).
- `promoteBrandToPublicMarket` (company_owner + platform review).

**بيانات أولية (Seed migration):** 256 براند تجريبية موزعة على قطاعات، شموع مولدة عشوائياً واقعياً، هيئة شرعية بمعايير AAOIFI مبدئية.

---

## ما سأبنيه في التسليمة القادمة (المرحلة 1 فقط)

بعد موافقتك، سأبني **المرحلة 1 كاملة** كأساس بصري متين قبل تفعيل Cloud:
1. نظام تصميم Dubai Financial Luxury (tokens + خطوط + RTL).
2. Shell التطبيق (هيدر + سايدبار + مبدل لغة).
3. Landing + Market Overview + Brand Detail + Trading Dashboard + Company Profile + Shariah Board — كلها ببيانات mock واقعية.
4. شارت شمعي حقيقي يعمل ببيانات وهمية.
5. i18n عربي/إنجليزي كامل.

بعدها ننتقل للمرحلة 2 (Auth + Cloud) في تسليمة منفصلة، ثم كل مرحلة على حدة للحفاظ على الجودة.
