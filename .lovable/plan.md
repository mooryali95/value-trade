## المرحلة الثالثة — تلميع الهوية + توسيع أدوات التداول

### 1) تلميع تجربة الحالات (Loading / Empty / Errors)
- استبدال كل `Loading...` و`Spinner` عام بمكون واحد `<LuxurySkeleton />` يعتمد نمط النقاط الذهبية الخفيفة + shimmer بطيء (200ms ease-out).
- مكون `<EmptyState />` موحّد: أيقونة Phosphor Duotone + عنوان قصير + سطر توضيحي + CTA اختياري. صياغات عربية مؤسسية (لا صياغات AI مثل "لم أجد..." أو "دعنا نبدأ").
- مكون `<ErrorState />` موحّد للـ `errorComponent` في كل المسارات + زر إعادة يستدعي `router.invalidate()` و `reset()`.
- مراجعة نصوص كل التوستات والرسائل — إزالة أي نبرة محادثة.

### 2) توحيد Tokens الألوان والخطوط
- تدقيق `src/styles.css`: التأكد أن كل لون في المكونات يمر عبر Token (`--ink`, `--gold`, `--burgundy`, `--bull`, `--bear`, `--ivory`, `--stone`). إزالة أي `text-white` / `bg-black` / ألوان hex متبقية.
- إضافة سلّم أوزان Tajawal موحّد كـ utilities: `--font-weight-body: 400`, `--display: 700`, `--display-heavy: 900`. توحيد أحجام العناوين (h1..h4) في `@layer base`.
- سلّم ظلال موحّد: `--shadow-hairline`, `--shadow-card`, `--shadow-luxury`, `--shadow-gold` (موجودة — تطبيقها بدل الظلال المخصصة داخل المكونات).

### 3) تطبيق الهوية الفاخرة على كل الصفحات
- **Trade (`/trade/$symbol`)**: تحديث لوحة الطلبات، الشارت، دفتر الأوامر لاستخدام `--bull`/`--bear` الجديدة، حدود شعرية، خط Mono للأرقام، شارة ذهبية للأدوات الحلال.
- **Workspace (Dashboard)**: بطاقات KPI بحدود ذهبية رفيعة، رأس صفحة مع شريط ذهبي (hairline-gold)، جداول بخلفية Ivory.
- **Market / Company / Shariah**: توحيد رؤوس الصفحات (نفس نمط breadcrumbs + شارة ذهبية للحالة).
- **Auth**: مراجعة الطبقة اليسرى لتحمل خلفية نقاط ذهبية خفيفة.

### 4) نمط النقاط كطبقة بصرية
- استخدام `<DotPattern />` كخلفية خفيفة (`opacity 0.04–0.06`) خلف Hero والداشبورد وقسم الشريعة.
- إضافة فواصل `<DotDivider />` بين الأقسام في الصفحة الرئيسية (شريط أفقي من النقاط بتدرج ذهبي).
- التأكد من `pointer-events: none` وعدم تأثيره على القراءة عبر تباين اللون فقط مع `--ink-soft`.

### 5) الشعار — إعادة تصميم واستخدام موسّع
- توحيد `<BrandMark />` كنسخة SVG نقية (نقاط + "قيمة" + "VALUE UNIT") وحذف الاعتماد على أي صورة PNG قديمة (`src/assets/value-logo.png.asset.json`).
- تنويعات: `<BrandMark variant="full" | "compact" | "mark-only" />`.
- استخدامات جديدة: Watermark خفيف في تذييل الصفحات، شعار مصغّر في favicon (SVG جديد يُبنى من نفس مكون النقاط)، og:image ديناميكي بلون Ivory + النقاط الذهبية.

### 6) جاهزية التكامل مع أنظمة أخرى
- تعريف طبقة `src/lib/integrations/` تحوي:
  - `types.ts` — عقود موحّدة (`Instrument`, `Quote`, `OrderBookLevel`, `Trade`).
  - `provider.ts` — واجهة `MarketDataProvider` مع نسخة `mockProvider` حالية.
  - مكان جاهز لموفرين حقيقيين لاحقاً (Tadawul, Mubasher, TradingView) دون تعديل مكونات الواجهة.
- توحيد استدعاء البيانات في الصفحات ليمر عبر هذه الطبقة (بدل استيراد `mock-data` مباشرة).
- إضافة `src/lib/integrations/README.md` يشرح كيفية استبدال الموفر.

### 7) توسيع فئات التداول: الأسهم + الصكوك
- تحديث `src/lib/mock-data.ts`:
  - إضافة حقل `assetClass: "brand" | "stock" | "sukuk"` على العناصر.
  - إضافة ~12 سهم سعودي/خليجي معروف (رمز + قطاع + سعر) و~8 صكوك (مُصدر + عائد سنوي + استحقاق + متوافقة/غير متوافقة).
- تحديث `/market`:
  - Tabs في الأعلى: **العلامات · الأسهم · الصكوك · الكل**.
  - فلاتر إضافية للصكوك (العائد، المدة، المُصدر) وللأسهم (القطاع، السوق).
- تحديث `/trade/$symbol`:
  - عرض حقول خاصة بالأصل: للأسهم (P/E, Div Yield, Sector)، للصكوك (Coupon, Maturity, Issuer, YTM).
  - إخفاء دفتر الأوامر للصكوك واستبداله بجدول تسعير (Bid/Ask + Yield).

### 8) دراسة مرجعية (بدون كود إضافي)
- مسح سريع لواجهات Tadawul, Mubasher, Sarwa, Wahed لاستخراج أنماط:
  - رؤوس بيانات الأصل (Symbol block).
  - جداول السوق (كثافة الصف، أعمدة قياسية).
  - عرض حالة الشريعة كشارة.
- تلخيص القرارات المتبنّاة في تعليق أعلى `market.tsx` و`trade.$symbol.tsx`.

---

### ملفات ستُنشأ
- `src/components/luxury-skeleton.tsx`
- `src/components/empty-state.tsx`
- `src/components/error-state.tsx`
- `src/components/dot-divider.tsx`
- `src/lib/integrations/types.ts`
- `src/lib/integrations/provider.ts`
- `src/lib/integrations/mock-provider.ts`
- `src/lib/integrations/README.md`
- `public/favicon.svg` (شعار SVG نقي)

### ملفات ستُعدَّل
- `src/styles.css` — سلالم الخطوط/الظلال، تنظيف tokens
- `src/components/brand-mark.tsx` — variants
- `src/components/app-shell.tsx` — استخدام BrandMark الجديد + تذييل
- `src/lib/mock-data.ts` — إضافة stocks + sukuk
- `src/lib/i18n.tsx` — مصطلحات الأسهم/الصكوك + نصوص EmptyState
- `src/routes/__root.tsx` — favicon SVG + og:image محدث
- `src/routes/index.tsx` — DotDivider + نقاط خلفية
- `src/routes/market.tsx` — Tabs + فلاتر
- `src/routes/trade.$symbol.tsx` — دعم stock/sukuk
- `src/routes/_authenticated/workspace.tsx` — تطبيق الهوية
- `src/routes/shariah.tsx`, `src/routes/company.$id.tsx`, `src/routes/auth.tsx` — تطبيق الحالات الموحّدة
- كل ملفات `routes/*` — استخدام `ErrorState` و`EmptyState`

### خارج النطاق
- لا تغييرات على قاعدة البيانات / RLS / Auth.
- لا إضافة موفري بيانات حقيقيين (فقط الطبقة التجريدية).
- لا تغيير هيكل التوجيه أو المسارات المحمية.
