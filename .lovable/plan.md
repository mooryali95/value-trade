## المرحلة الثانية: تحويل الهوية إلى ثيم فاتح فاخر + تفعيل Lovable Cloud والمصادقة

### 1) تحليل الهوية المرفقة

من الصور المرفقة (الشعار + العينات اللونية + بوستر "وحدة القيمة"):

**اللوحة اللونية الأساسية (Light Luxury):**
- خلفية أساسية: `Ivory / Warm White` — `oklch(0.98 0.005 85)` (من الصورة الفاتحة الرمادية-البيج)
- خلفية ثانوية: `Soft Stone` — `oklch(0.95 0.008 85)` (بطاقات، أقسام)
- حدود ناعمة: `oklch(0.88 0.01 85)`
- النص الأساسي (Primary Ink): `Deep Navy` — `oklch(0.22 0.05 260)` (من نص "وحدة القيمة" في البوستر)
- النص الثانوي: `oklch(0.45 0.02 260)`
- **اللون الذهبي المميز (Signature Gold):** `oklch(0.72 0.11 82)` (من الصورة الذهبية والخطوط الذهبية في البوستر)
- ذهبي فاتح لل hover/glow: `oklch(0.82 0.09 84)`
- **لون شعار Value (Burgundy accent):** `oklch(0.38 0.11 20)` (الحواف الحمراء-العنابية للشعار) — يُستخدم كـ accent ثانوي للتمييز فقط
- Bull (أخضر متوافق مع الفخامة): `oklch(0.55 0.13 155)`
- Bear (عنابي بدلاً من الأحمر الفاقع): `oklch(0.48 0.16 25)`

**التوجه البصري:** فاخر هادئ — خلفيات عاجية، طباعة كحلي داكن، حدود شعرية، لمسات ذهبية معدنية (تدرجات، خطوط رفيعة، إطارات)، ظلال ناعمة جداً (soft-elevation) بدل ظلال قوية. مستوحى من الملف التنفيذي الفاخر.

### 2) إعادة بناء نظام التصميم (src/styles.css)

- قلب `:root` بالكامل من ثيم كحلي داكن إلى ثيم فاتح عاجي.
- تعديل `--background, --foreground, --card, --primary (gold), --secondary, --muted, --border, --input, --ring`.
- إضافة توكنز جديدة: `--ink`, `--stone`, `--gold-metallic`, `--burgundy` (accent الشعار), `--shadow-luxury`.
- تدرجات مُحدَّثة: `gold-gradient` بلون معدني حقيقي، `ivory-gradient` للأقسام، `hairline` (خط ذهبي رفيع 1px).
- ضبط `text-bull / text-bear` للألوان الجديدة الأكثر هدوءاً.
- إبقاء الخطوط (IBM Plex Sans Arabic + Inter).

### 3) مراجعة المكونات لتتناسب مع الثيم الفاتح

- `AppShell` (header/footer): إزالة `bg-navy` والاعتماد على `bg-background/80 + backdrop-blur`، حد سفلي شعري ذهبي، `BrandMark` بخلفية ذهبية معدنية على نص كحلي.
- `MarketPill`, أزرار اللغة والدخول: إعادة صياغة الحواف والألوان للفاتح.
- `candlestick-chart`: تحديث ألوان الخلفية/الشبكة/الشموع لتناسب الفاتح.
- مراجعة صفحات: `index, market, market.$slug, trade.$symbol, workspace, shariah, company.$id` وتبديل أي `bg-navy*`, `text-white`, ألوان مباشرة بالتوكنز الجديدة. لا تغيير في التخطيط أو المحتوى — فقط الألوان والخلفيات والظلال.

### 4) شعار Value

- إنشاء `src/assets/value-logo.png.asset.json` عبر `lovable-assets` من الشعار المرفق.
- استبدال `BrandMark` الحالي (المربع الذهبي مع الحرف) باستخدام الشعار الفعلي كـ `<img>` مع إطار عنابي رفيع مطابق للأصل، مع الحفاظ على نفس المقاسات.

### 5) تفعيل Lovable Cloud + نظام المصادقة (Phase 2 الفعلي)

- تفعيل `supabase--enable` (يظهر كـ Lovable Cloud للمستخدم).
- migration تنشئ:
  - `profiles (id uuid PK ref auth.users, full_name, avatar_url, locale, created_at)` مع trigger على `auth.users` لإنشاء البروفايل تلقائياً.
  - `app_role` enum: `platform_admin, shariah_board, company_owner, brand_manager, trader`.
  - `user_roles (id, user_id, role)` + unique(user_id, role).
  - `has_role(_user_id, _role)` SECURITY DEFINER.
  - GRANTs + RLS كما تفرضه معايير Lovable (grants قبل RLS، سياسات مبنية على `auth.uid()` و `has_role`).
- تفعيل مزودَي: Email/Password + Google عبر `supabase--configure_social_auth`.
- تفعيل HIBP للباسورد.

### 6) صفحات المصادقة والواجهة

- `src/routes/auth.tsx` (public): تصميم split فاخر — يسار: البراند + خلفية عاجية بخطوط ذهبية مستوحاة من البوستر؛ يمين: بطاقة Sign in / Sign up مع تبويبَين + زر Google. يدعم `?redirect=` ويحفظه بعد الدخول.
- `src/routes/_authenticated/route.tsx` (managed pattern، `ssr:false`، يتحقق من `supabase.auth.getUser()`، يعيد إلى `/auth`).
- نقل `workspace` تحت `_authenticated/workspace.tsx` (لأنها بيئة الشركات).
- إضافة `functionMiddleware` (attachSupabaseAuth) في `src/start.ts`.
- تحديث `AppShell`: زر الدخول يعرض إما "دخول" (رابط `/auth`) أو قائمة الحساب (الصورة الرمزية + اسم المستخدم + "لوحتي" + "تسجيل خروج") بحسب `supabase.auth.onAuthStateChange`.
- `src/routes/__root.tsx`: تفعيل مستمع واحد لـ `onAuthStateChange` (`SIGNED_IN/OUT/USER_UPDATED` فقط) مع `router.invalidate()` و `queryClient.invalidateQueries()`.

### 7) تفاصيل تقنية

**ملفات جديدة:**
- `src/routes/auth.tsx`
- `src/routes/_authenticated/route.tsx`
- `src/routes/_authenticated/workspace.tsx` (نقل من `workspace.tsx`)
- `src/assets/value-logo.png.asset.json`
- `src/components/user-menu.tsx`
- migration SQL (profiles, roles, has_role, RLS, grants)

**ملفات معدّلة:**
- `src/styles.css` (ثيم فاتح كامل)
- `src/components/app-shell.tsx` (شعار + ألوان + قائمة المستخدم)
- `src/components/candlestick-chart.tsx` (ألوان فاتحة)
- كل صفحات الروت (توكنز فقط، بدون تغيير محتوى)
- `src/start.ts` (attachSupabaseAuth middleware)
- `src/routes/__root.tsx` (auth listener)

**قيود ملتزم بها:**
- لا استخراج أي نص من الصور المرفقة.
- الاعتماد فقط على التوكنز الدلالية — لا `text-white` أو ألوان hex في المكونات.
- كل جدول عام يحصل على GRANTs + RLS مع سياسات مقيّدة بـ `auth.uid()`.
- المسارات العامة تبقى SSR افتراضياً؛ المحمية تحت `_authenticated/`.

### 8) خارج نطاق هذه المرحلة (سنتناولها في Phase 3+)

- الجداول متعددة الشركات (`companies, brands, company_members`) — Phase 3.
- الاكتتابات والتقييمات — Phase 4.
- محرك أوامر التداول الحقيقي — Phase 5.

هل نبدأ التنفيذ؟