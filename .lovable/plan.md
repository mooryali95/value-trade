
## المرحلة الخامسة — الحوكمة، تعدد المستأجرين، والطروحات

### 1) توسعة `/shariah/review` — سجل قرارات كامل مع تدقيق
- عرض جدول قرارات مع أعمدة: الرمز، الحالة، السبب، المراجع، التاريخ، آخر تعديل.
- إتاحة **تعديل قرار سابق** (حالة/سبب) عبر modal مع إجبار كتابة سبب التعديل.
- كل تعديل يُسجَّل صفًا جديدًا في جدول جديد `shariah_decision_audit` (لا استبدال — سجل تاريخي كامل).
- تصفية: حسب الحالة، حسب المراجع، حسب الفترة الزمنية، بحث بالرمز.
- عرض "خط زمني" لكل رمز يوضح تسلسل القرارات.

**قاعدة البيانات:**
- `shariah_decision_audit`: `decision_id, previous_status, new_status, previous_reason, new_reason, changed_by, changed_at, change_reason`.
- Trigger على `shariah_decisions` عند `UPDATE` يكتب تلقائيًا في `shariah_decision_audit`.
- إضافة `updated_at`, `updated_by` إلى `shariah_decisions`.
- RLS: القراءة للجميع المصادَق عليهم، الكتابة/التعديل للمراجعين فقط عبر `has_role`.

---

### 2) توسعة `/portfolio` — سجل أوامر ومراكز متقدم
- تبويبان: **المراكز** و**سجل الأوامر** (مفصولان بوضوح، حاليًا مدموجان).
- سجل الأوامر: بحث بالرمز، تصفية حسب: الحالة (منفّذ/معلّق/ملغى/معدّل)، الجانب (شراء/بيع)، النوع (limit/market)، الفترة.
- عمود "تتبع الحالة" مع خط زمني مصغّر: `placed → filled/cancelled/modified`.
- إتاحة **إلغاء أمر معلّق** و**تعديل أمر معلّق** (السعر/الكمية) عبر modal.
- كل تعديل/إلغاء يُسجَّل في `orders_audit` مع الطابع الزمني والمستخدم.

**قاعدة البيانات:**
- إضافة قيمة `modified` إلى `orders.status`.
- `orders_audit`: `order_id, action (cancel|modify), previous_qty, previous_price, new_qty, new_price, changed_by, changed_at`.
- Server fns جديدة: `cancelOrder`, `modifyOrder` (تحت `requireSupabaseAuth`، تتحقق أن الأمر ملك المستخدم وحالته `pending`).

---

### 3) نظام Multi-Tenant للشركات والبراندات
كل **شركة** (Tenant) تدير حتى 30 براند وعدة مستخدمين بأدوار مختلفة.

**قاعدة البيانات:**
- `companies`: `id, name_ar, name_en, slug, created_by, plan (basic|pro|enterprise)`.
- `company_members`: `company_id, user_id, role (owner|finance|shariah|trader|viewer), invited_by, joined_at` — UNIQUE(company_id, user_id).
- `company_brands`: `company_id, brand_symbol, added_at` مع CHECK يمنع تجاوز 30 عبر trigger.
- security definer `has_company_role(_user_id, _company_id, _role)`.
- RLS: كل الجداول (positions/orders/alerts/decisions/brands) تصبح مقيّدة بـ `company_id` + دور مناسب:
  - `finance` → قراءة المحفظة والتقارير.
  - `shariah` → قراءة/كتابة قرارات الشريعة.
  - `trader` → وضع/تعديل الأوامر.
  - `owner` → كل الصلاحيات + إدارة الأعضاء.

**واجهة:**
- `/company/settings` (owner فقط): إدارة الأعضاء، تعيين الأدوار، إضافة/إزالة براندات (بحد 30).
- Selector لتبديل الشركة النشطة في `AppShell` (لمن ينتمي لأكثر من شركة).
- كل الاستعلامات القائمة تحصل على فلتر `company_id` من السياق النشط.

**ملاحظة:** يتطلب تعديلاً لكل الجداول القائمة (portfolios/positions/orders/price_alerts) لإضافة `company_id`. Migration ينشئ شركة افتراضية للمستخدمين الحاليين ويربط بياناتهم بها.

---

### 4) سير عمل اعتماد الطروحات العامة
عميل (شركة) يقدّم منتجًا (سهم/صك) للنشر في المنصة العامة، والمراجعون يعتمدون/يرفضون.

**قاعدة البيانات:**
- `product_submissions`: `id, company_id, submitted_by, asset_class (stock|sukuk), symbol, name_ar, name_en, sector, prospectus_url, status (pending|approved|rejected), reviewer_id, review_reason, submitted_at, reviewed_at`.
- عند `approved` يظهر البراند في السوق العام؛ عند `rejected` يبقى داخل مساحة الشركة فقط.
- RLS: الشركة ترى/تعدّل طروحاتها فقط، المراجعون (`shariah_board` أو دور جديد `platform_reviewer`) يرون كل الطروحات.

**واجهة:**
- `/company/submit` (owner/finance): نموذج تقديم منتج جديد.
- `/company/submissions`: قائمة طروحات الشركة مع حالتها.
- `/admin/submissions` (reviewer): قائمة طروحات معلّقة مع أزرار قبول/رفض + سبب.
- شارة "قيد المراجعة/مقبول/مرفوض" على البطاقات ذات الصلة.

---

### 5) اختبار تلقائي لمسار `cron-alerts`
- ملف اختبار `src/routes/api/public/cron-alerts.test.ts` باستخدام Vitest.
- يحاكي:
  1. طلب بدون توقيع → 401.
  2. طلب بتوقيع غير صحيح → 401.
  3. طلب صحيح مع تنبيه سعري نشط شرطه محقق → يستدعي `supabaseAdmin.update` ويعيّن `active=false, triggered_at`.
  4. طلب صحيح مع تنبيه شرطه غير محقق → لا تحديث.
- Mock لـ `supabaseAdmin` و`BRANDS` لعزل الاختبار عن الشبكة.
- يُضاف script `test:cron` في `package.json` وتُشغَّل في CI عبر `bunx vitest run`.

---

### التقنية / الملفات

**Migrations جديدة:**
- `companies`, `company_members`, `company_brands` (+ `has_company_role`).
- `product_submissions`.
- `shariah_decision_audit` + trigger.
- `orders_audit` + إضافة `modified` لحالة الأمر.
- إضافة `company_id` لكل جداول البيانات وتحديث RLS.

**ملفات جديدة:**
- `src/lib/tenants/company.functions.ts` (إدارة أعضاء/براندات).
- `src/lib/tenants/context.tsx` (Provider للشركة النشطة).
- `src/lib/trading/order-mutations.functions.ts` (cancel/modify).
- `src/lib/submissions/submissions.functions.ts`.
- `src/routes/_authenticated/company.settings.tsx`.
- `src/routes/_authenticated/company.submit.tsx`.
- `src/routes/_authenticated/company.submissions.tsx`.
- `src/routes/_authenticated/admin.submissions.tsx`.
- `src/routes/api/public/cron-alerts.test.ts`.

**ملفات معدّلة:**
- `portfolio.tsx` — تبويبات + تصفية + إلغاء/تعديل.
- `shariah.review.tsx` — تعديل قرار + سجل تدقيق + تصفية.
- `app-shell.tsx` — Selector للشركة + روابط جديدة.
- `i18n.tsx` — مفاتيح جديدة.
- `place-order.functions.ts` — دعم `company_id`.

### خارج النطاق
- لا مدفوعات لخطط الشركات.
- لا نظام دعوة عبر البريد (يُضاف عضو عبر email/user_id مباشرة).
- لا لوحة Super-admin عامة.
