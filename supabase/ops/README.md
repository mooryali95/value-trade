# Operations: go-live checklist

This folder holds scripts the owner runs **by hand**. Nothing here is a
migration and nothing here runs automatically.

| File | Purpose |
| --- | --- |
| `go_live_reset.sql` | One-time reset of the trading state right before the first real investor is invited. Archives, then clears orders, trades, positions, the cash ledger and unit issuances, and sets every cash balance to 0. Read its header before running it. |
| `test_go_live_reset.sh` | Regression test for the reset script (fixtures, reset, second-run refusal, restore). Run it against a throwaway database only. |

---

## English

Follow the steps in order. Do not skip a step: each one relies on the one
before it.

1. **Set the secrets** (Lovable Cloud project settings, server secrets):
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
     (provided by Lovable Cloud; check they are present);
   - `APP_ORIGIN` = the canonical origin, e.g. `https://hub.sunkvalue.com`
     (optional `APP_ALLOWED_ORIGINS`: extra exact origins, comma separated);
   - `LOVABLE_API_KEY` (transactional email);
   - `CRON_ALERTS_SECRET` (a long random value, signs the price-alert job and
     the smoke suite).
   Also fill in the confirmed operator details in `src/lib/config/site.ts`
   (legal entity, commercial registration, address, contact addresses,
   licensing status, Shariah board). Empty fields are simply not shown.
2. **Apply the migrations bundle**: every file in `supabase/migrations`, in
   filename order, on the production database (Lovable applies pending
   migrations when the project syncs; confirm none is pending or failed).
   The same bundle must pass `npm run test:db` in CI first.
3. **Publish** the app from Lovable and open the canonical URL. Check that
   the market shows no instruments and the designed empty state, and that
   Arabic pages load right-to-left.
4. **Run the smoke suite**: sign in as a platform admin, open
   `/admin/ops`, run the smoke suite and confirm every check passes.
5. **Run `go_live_reset.sql`** once, in the Lovable Cloud SQL editor, as the
   last step before inviting the first real investor:
   - paste the whole file and run it;
   - expect the notice `GO_LIVE_RESET_DONE` with the archived row counts;
   - if it stops with `GO_LIVE_RESET_ALREADY_RUN`, it has already run and
     nothing was changed; `GO_LIVE_RESET_NO_ADMIN` means no account has the
     `platform_admin` role yet; any other error also means nothing changed;
   - the archive lives in the private schema `go_live_archive`; the header
     of the script explains how to restore from it.
6. **Activate and fund investors** in `/admin/investors`: activate each
   invited investor (grants the `trader` role), then post their deposit.
   Every amount is recorded in the cash ledger and the audit log.
7. **Issue units** of each listed brand to its initial holders from the same
   screen, and set the reference price that anchors the first day's ±20%
   price band.
8. **Publish the instruments** that are ready to trade. Only published
   instruments appear on the market and accept orders. Publishing needs a
   reference price set in step 7 and a Shariah ruling in force (approving a
   product submission records the reviewer's ruling).

---

## العربية

## قائمة التحقق قبل الإطلاق

يضم هذا المجلد نصوصًا برمجية يشغّلها مالك المنصة **يدويًا**. لا شيء هنا
يُعدّ ترحيلًا (migration)، ولا شيء يعمل تلقائيًا.

| الملف | الغرض |
| --- | --- |
| `go_live_reset.sql` | إعادة ضبط حالة التداول مرة واحدة قبيل دعوة أول مستثمر فعلي: يؤرشف البيانات، ثم يحذف الأوامر والصفقات والمراكز وسجل النقد وإصدارات الوحدات، ويجعل رصيد كل محفظة صفرًا. اقرأ ترويسة الملف قبل تشغيله. |
| `test_go_live_reset.sh` | اختبار انحدار لنص إعادة الضبط (بيانات تجريبية، إعادة الضبط، رفض التشغيل الثاني، الاستعادة). شغّله على قاعدة بيانات مؤقتة فقط. |

اتبع الخطوات بالترتيب، ولا تتجاوز أيًّا منها، فكل خطوة تعتمد على ما قبلها.

1. **ضبط الأسرار** (إعدادات مشروع Lovable Cloud، أسرار الخادم):
   - `SUPABASE_URL` و`SUPABASE_PUBLISHABLE_KEY` و`SUPABASE_SERVICE_ROLE_KEY`
     (يوفّرها Lovable Cloud؛ تحقّق من وجودها)؛
   - `APP_ORIGIN` = النطاق الرسمي، مثل `https://hub.sunkvalue.com`
     (و`APP_ALLOWED_ORIGINS` اختياريًا: نطاقات إضافية مطابقة تمامًا، مفصولة بفواصل)؛
   - `LOVABLE_API_KEY` (رسائل البريد الإلكتروني)؛
   - `CRON_ALERTS_SECRET` (قيمة عشوائية طويلة توقّع مهمة تنبيهات الأسعار
     ومجموعة الفحص السريع).
   واملأ كذلك بيانات المشغّل المؤكَّدة في `src/lib/config/site.ts` (الكيان
   القانوني، والسجل التجاري، والعنوان، وعناوين التواصل، وحالة الترخيص،
   والهيئة الشرعية). الحقول الفارغة لا تظهر للمستخدمين.
2. **تطبيق حزمة الترحيلات**: كل ملفات `supabase/migrations` بترتيب أسمائها
   على قاعدة بيانات الإنتاج (يطبّق Lovable الترحيلات المعلّقة عند المزامنة؛
   تأكّد أنه لا يوجد ترحيل معلّق أو فاشل). ويجب أن تجتاز الحزمة نفسها
   `npm run test:db` في التكامل المستمر أولًا.
3. **النشر**: انشر التطبيق من Lovable وافتح النطاق الرسمي. تحقّق من أن السوق
   لا تعرض أي أداة وتظهر حالة "لا توجد إدراجات" المصمَّمة، وأن الصفحات
   العربية تُعرض من اليمين إلى اليسار.
4. **تشغيل الفحص السريع**: سجّل الدخول بحساب مدير المنصة، وافتح
   `/admin/ops`، وشغّل مجموعة الفحص السريع، وتأكّد من نجاح كل الفحوص.
5. **تشغيل `go_live_reset.sql`** مرة واحدة في محرّر SQL في Lovable Cloud،
   بوصفه الخطوة الأخيرة قبل دعوة أول مستثمر فعلي:
   - الصق الملف كاملًا وشغّله؛
   - ينبغي أن يظهر الإشعار `GO_LIVE_RESET_DONE` مع أعداد الصفوف المؤرشفة؛
   - إذا توقّف برسالة `GO_LIVE_RESET_ALREADY_RUN` فقد شُغّل سابقًا ولم يتغيّر
     شيء؛ وتعني `GO_LIVE_RESET_NO_ADMIN` أنه لا يوجد حساب بدور
     `platform_admin` بعد؛ وأي خطأ آخر يعني كذلك أنه لم يتغيّر شيء؛
   - تُحفظ الأرشيفات في المخطط الخاص `go_live_archive`، وتشرح ترويسة الملف
     طريقة الاستعادة منها.
6. **تفعيل المستثمرين وتمويلهم** من `/admin/investors`: فعّل كل مستثمر مدعو
   (يمنحه دور `trader`)، ثم سجّل إيداعه. يُقيَّد كل مبلغ في سجل النقد وسجل
   التدقيق.
7. **إصدار الوحدات** لكل علامة تجارية مدرجة إلى حامليها الأوائل من الشاشة
   نفسها، وتحديد السعر المرجعي الذي يرتكز عليه نطاق التذبذب (±20%) في يوم
   التداول الأول.
8. **نشر الأدوات** الجاهزة للتداول. لا تظهر في السوق ولا تقبل الأوامر إلا
   الأدوات المنشورة. يتطلب النشر سعرًا مرجعيًا حُدّد في الخطوة 7 وحكمًا شرعيًا
   ساريًا (اعتماد طلب الإدراج يسجّل حكم المراجع الشرعي).
