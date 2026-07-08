## تم الآن (إغلاق فجوات المرحلة 3)

- استبدال كل `text-white` في صفحات المنصة بـ `text-ivory` عبر Token جديد في `styles.css` (بقيت shadcn overlays فقط).
- صفحة `/trade/$symbol`: عند الأصل من نوع صك، يُستبدل دفتر الأوامر بجدول Bid/Ask + YTM؛ العلامات والأسهم تحتفظ بدفتر الأوامر.
- تحقق البناء (`tsgo`) نظيف. المراحل 1–3 مكتملة عمليًا.

---

## المرحلة الرابعة — المحفظة والتنفيذ والحوكمة

الهدف: تحويل المنصة من واجهة عرض إلى تجربة تداول متكاملة موصولة بحساب المستخدم في Lovable Cloud، مع مسار حوكمة شرعي واضح.

### 1) المحفظة (`/portfolio`)
- مسار محمي جديد `src/routes/_authenticated/portfolio.tsx`.
- ملخص علوي: إجمالي القيمة، الربح/الخسارة اليومية، النقد المتاح، توزيع الأصول (علامات · أسهم · صكوك) عبر شريط مكدّس.
- جدول المراكز: الرمز، الكمية، متوسط الدخول، السعر الحالي، P&L، الوزن، إجراء (تداول / إغلاق).
- تبويب "السجل": حركات الأوامر السابقة (منفّذ / ملغى / معلّق).
- حالات: `EmptyState` عندما لا توجد مراكز، `LuxurySkeleton` أثناء الجلب.

### 2) قاعدة بيانات المحفظة (Lovable Cloud)
جداول جديدة في مخطط `public` مع RLS كامل و`GRANT` مطابق:
- `portfolios` — محفظة واحدة لكل مستخدم، `cash_balance`.
- `positions` — `user_id, symbol, asset_class, qty, avg_price`.
- `orders` — `user_id, symbol, side (buy|sell), type (limit|market), qty, price, status, filled_at`.
- Trigger لتحديث `updated_at`، وسياسات: كل مستخدم يقرأ/يعدّل صفوفه فقط.

### 3) تنفيذ الأوامر (Server Functions)
- `src/lib/trading/place-order.functions.ts` مع `requireSupabaseAuth`:
  - Validation عبر `zod` (رمز موجود، كمية موجبة، سعر منطقي).
  - محاكاة تنفيذ فوري ضد آخر سعر من `MarketDataProvider` (mock)، تحديث `positions` و`cash_balance` و`orders` في معاملة واحدة.
  - إرجاع نتيجة موحّدة `{ order, position }`.
- ربط لوحة الأوامر في `/trade/$symbol` بهذا الـ serverFn عبر `useServerFn` + `useMutation`، مع Toasts احترافية (نجاح/خطأ) بصياغة مؤسسية.

### 4) الحوكمة الشرعية (`/shariah/review`)
- مسار محمي بدور `shariah_reviewer` (استخدام جدول `user_roles` و`has_role` الموجودَين).
- قائمة أدوات قيد المراجعة (`shariah = "reviewing"`) مع أزرار: اعتماد · رفض · طلب معلومات.
- تسجيل القرار في جدول جديد `shariah_decisions` (سبب، مراجع، تاريخ) مع RLS: القراءة للجميع، الكتابة للمراجعين فقط.
- شارة الحالة في صفحات السوق تعكس القرار مباشرة (بدل الحقل الثابت في mock).

### 5) الإشعارات + التنبيهات السعرية
- جدول `price_alerts` (`user_id, symbol, direction, target_price, active`).
- زر "أنشئ تنبيهًا" في `/trade/$symbol`.
- Server route عام `src/routes/api/public/cron-alerts.ts` (مع HMAC) يفحص التنبيهات دوريًا؛ يُستدعى من pg_cron بعد تفعيله لاحقًا (بدون تفعيل الآن، فقط جاهزية الكود).

### 6) استيراد بيانات حقيقية (اختياري في هذه المرحلة)
- Adapter جديد `src/lib/integrations/tadawul-provider.ts` يُنفّذ `MarketDataProvider` عبر HTTP JSON عام (إن توفر) — يُترك خلف feature-flag، الافتراضي يبقى mock.

### 7) تحسينات جودة
- إضافة اختبارات وحدة سريعة لدوال حساب P&L والوزن في `src/lib/trading/*.test.ts` عبر vitest.
- توسعة `EmptyState`/`ErrorState` لتغطية سيناريوهات المحفظة والأوامر.

---

### ملفات ستُنشأ
- `src/routes/_authenticated/portfolio.tsx`
- `src/routes/_authenticated/shariah.review.tsx`
- `src/lib/trading/place-order.functions.ts`
- `src/lib/trading/calc.ts` (+ `calc.test.ts`)
- `src/lib/integrations/tadawul-provider.ts`
- `src/routes/api/public/cron-alerts.ts`
- Migrations: `portfolios`, `positions`, `orders`, `shariah_decisions`, `price_alerts` (+ GRANT + RLS + triggers)

### ملفات ستُعدَّل
- `src/components/app-shell.tsx` — إضافة رابط "المحفظة" في الشريط.
- `src/routes/trade.$symbol.tsx` — ربط زر التنفيذ + تنبيه سعري.
- `src/routes/shariah.tsx` — رابط "لوحة المراجعة" للمراجعين.
- `src/lib/i18n.tsx` — مفاتيح المحفظة/الأوامر/التنبيهات.

### خارج النطاق
- لا مزوّد بيانات مدفوع.
- لا مدفوعات إيداع/سحب حقيقية.
- لا واجهة مسؤول عام (Super-admin).
