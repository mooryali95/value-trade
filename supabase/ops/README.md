# Operations: launch bundle and go-live checklist

This folder holds scripts the owner runs **by hand**. Nothing here is a
migration and nothing here runs automatically.

| File | Purpose |
| --- | --- |
| `go_live_reset.sql` | One-time reset of the trading state right before the first real investor is invited. Archives, then clears orders, trades, positions, the cash ledger and unit issuances, and sets every cash balance to 0. Read its header before running it. |
| `test_go_live_reset.sh` | Regression test for the reset script (fixtures, reset, second-run refusal, restore). Run it against a throwaway database only. |
| `launch_bundle.sql` | **Generated.** Every migration from `20260924100000` onward, in order, in ONE transaction, with preconditions (right database, not applied yet) and the migration-history record. Run once in the Lovable Cloud SQL editor (step 2). |
| `build_launch_bundle.sh` | Regenerates `launch_bundle.sql` from `supabase/migrations` (`--check` fails when the committed bundle is stale). |
| `test_launch_bundle.sh` | Builds a production-like database (migrations before `20260924` plus legacy rows), applies the bundle, compares the schema with a migration-by-migration build, checks the data, the lifecycle, the engine, a refused second run and `go_live_reset.sql` afterwards. Self-contained (throwaway cluster). |

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
2. **Apply the launch bundle** (`supabase/ops/launch_bundle.sql`):
   - first run `bash supabase/ops/build_launch_bundle.sh --check` (the bundle
     matches the migrations), `npm run test:db` and
     `bash supabase/ops/test_launch_bundle.sh`; all must pass;
   - take a backup (or confirm point-in-time recovery is on);
   - paste the whole file into the Lovable Cloud SQL editor and run it once.
     It is one transaction: on any error nothing changes. Expect the notice
     `LAUNCH_BUNDLE_DONE`. `LAUNCH_BUNDLE_ALREADY_APPLIED` means the
     migration history already lists some of these versions (apply only the
     missing files instead); `LAUNCH_BUNDLE_WRONG_DATABASE` means this is not
     the Value Unit database;
   - what it does to existing data: legacy balances get opening ledger rows
     (cash = ledger); balances or units no history explains are put on hold
     for review (`launch_review_holds`, trading off for those accounts);
     fractional or stale resting orders are closed; every instrument without
     an admin-set reference price or a Shariah ruling leaves the market
     (including the 276 demo instruments); no Shariah ruling is invented;
   - migrations added after the bundle was applied are applied one by one,
     as usual.
3. **Publish** the app from Lovable and open the canonical URL. Check that
   the market shows no instruments and the designed empty state, and that
   Arabic pages load right-to-left.
4. **Run the smoke suite**: sign in as a platform admin, open
   `/admin/ops`, run the smoke suite and confirm every check passes. Then
   open `/admin/health`: the `integrity.*` checks list the ledger and market
   invariants (`public.integrity_report()`). Before the reset, legacy units
   with no issuance behind them may show `units_match_history` /
   `units_conserved_per_symbol` in red; step 5 clears them.
5. **Run `go_live_reset.sql`** once, in the Lovable Cloud SQL editor, as the
   last step before inviting the first real investor:
   - paste the whole file and run it;
   - expect the notice `GO_LIVE_RESET_DONE` with the archived row counts;
   - if it stops with `GO_LIVE_RESET_ALREADY_RUN`, it has already run and
     nothing was changed; `GO_LIVE_RESET_NO_ADMIN` means no account has the
     `platform_admin` role yet; any other error also means nothing changed;
   - the archive lives in the private schema `go_live_archive`; the header
     of the script explains how to restore from it;
   - afterwards every `integrity.*` check on `/admin/health` must pass (the
     script itself refuses to finish, changing nothing, if a ledger, unit or
     order check fails: `GO_LIVE_RESET_INTEGRITY`).
6. **Activate and fund investors** in `/admin/investors`: activate each
   invited investor (grants the `trader` role), then post their deposit.
   Every amount is recorded in the cash ledger and the audit log.
7. **List instruments through the lifecycle** (`/admin/submissions`), in
   this order, each step by its own role and enforced in the database:
   1. a company owner or finance member submits the product (status
      *awaiting Shariah review*);
   2. a Shariah reviewer approves it (records the ruling and creates the
      instrument off the market, no price) or rejects it with a reason. A
      different ruling already in force is never replaced silently;
   3. a platform admin approves the listing: sets a real reference price
      (it anchors the first day's ±20% band), lists the instrument and may
      allocate the first units to one of the company's owner / finance
      members, all in one step. Or declines it with a reason.
   Instruments that exist without a submission (for example a legacy
   approval taken off the market by the bundle) are ruled on from
   `/shariah/review` (which lists unpublished instruments too), then priced
   and listed from the admin listing screen.
8. **Issue further units** from `/admin/investors` when needed. Only listed
   instruments appear on the market and accept orders.

---

## العربية

## قائمة التحقق قبل الإطلاق

يضم هذا المجلد نصوصًا برمجية يشغّلها مالك المنصة **يدويًا**. لا شيء هنا
يُعدّ ترحيلًا (migration)، ولا شيء يعمل تلقائيًا.

| الملف | الغرض |
| --- | --- |
| `go_live_reset.sql` | إعادة ضبط حالة التداول مرة واحدة قبيل دعوة أول مستثمر فعلي: يؤرشف البيانات، ثم يحذف الأوامر والصفقات والمراكز وسجل النقد وإصدارات الوحدات، ويجعل رصيد كل محفظة صفرًا. اقرأ ترويسة الملف قبل تشغيله. |
| `test_go_live_reset.sh` | اختبار انحدار لنص إعادة الضبط (بيانات تجريبية، إعادة الضبط، رفض التشغيل الثاني، الاستعادة). شغّله على قاعدة بيانات مؤقتة فقط. |
| `launch_bundle.sql` | **ملف مولَّد.** جميع الترحيلات من `20260924100000` فصاعدًا بترتيبها، في معاملة واحدة، مع شروط مسبقة (قاعدة البيانات الصحيحة، وعدم التطبيق السابق) وتسجيل الإصدارات في سجل الترحيلات. يُشغَّل مرة واحدة في محرّر SQL في Lovable Cloud (الخطوة 2). |
| `build_launch_bundle.sh` | يعيد توليد `launch_bundle.sql` من `supabase/migrations` (ويفشل الخيار `--check` إذا كانت الحزمة المحفوظة قديمة). |
| `test_launch_bundle.sh` | ينشئ قاعدة بيانات تحاكي الإنتاج (الترحيلات السابقة لـ `20260924` مع بيانات قديمة واقعية)، ويطبّق الحزمة، ويقارن المخطط بقاعدة مبنية ترحيلًا ترحيلًا، ويتحقق من البيانات ومسار الإدراج ومحرّك المطابقة ورفض التشغيل الثاني ثم `go_live_reset.sql`. مستقل بذاته (عنقود مؤقت). |

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
2. **تطبيق حزمة الإطلاق** (`supabase/ops/launch_bundle.sql`):
   - شغّل أولًا `bash supabase/ops/build_launch_bundle.sh --check` (للتأكد من
     تطابق الحزمة مع الترحيلات)، ثم `npm run test:db`، ثم
     `bash supabase/ops/test_launch_bundle.sh`، ويجب أن تنجح جميعها؛
   - خذ نسخة احتياطية (أو تأكّد من تفعيل الاستعادة إلى نقطة زمنية)؛
   - الصق الملف كاملًا في محرّر SQL في Lovable Cloud وشغّله مرة واحدة. يُنفَّذ
     الملف معاملةً واحدة، فلا يتغيّر شيء عند أي خطأ. ينبغي أن يظهر الإشعار
     `LAUNCH_BUNDLE_DONE`. وتعني `LAUNCH_BUNDLE_ALREADY_APPLIED` أن سجل الترحيلات
     يتضمن بعض هذه الإصدارات (فطبّق الملفات الناقصة وحدها)، وتعني
     `LAUNCH_BUNDLE_WRONG_DATABASE` أن قاعدة البيانات ليست قاعدة «وحدة القيمة»؛
   - أثرها في البيانات القائمة: تُضاف قيود افتتاحية في سجل النقد للأرصدة القديمة
     (فيطابق الرصيد السجل)؛ وتوضع الأرصدة أو الوحدات التي لا يفسّرها أي سجل تحت
     المراجعة (`launch_review_holds`، ويُوقف التداول لتلك الحسابات)؛ وتُغلق الأوامر
     القائمة الكسرية أو القديمة؛ وتخرج من السوق كل أداة ليس لها سعر مرجعي حدّده
     مدير المنصة أو حكم شرعي ساري (ومنها الأدوات التجريبية الـ 276)؛ ولا يُنشأ
     أي حكم شرعي لم يصدره مراجع؛
   - الترحيلات التي تُضاف بعد تطبيق الحزمة تُطبَّق كلٌّ على حدة كالمعتاد.
3. **النشر**: انشر التطبيق من Lovable وافتح النطاق الرسمي. تحقّق من أن السوق
   لا تعرض أي أداة وتظهر حالة "لا توجد إدراجات" المصمَّمة، وأن الصفحات
   العربية تُعرض من اليمين إلى اليسار.
4. **تشغيل الفحص السريع**: سجّل الدخول بحساب مدير المنصة، وافتح
   `/admin/ops`، وشغّل مجموعة الفحص السريع، وتأكّد من نجاح كل الفحوص. ثم افتح
   `/admin/health`: تعرض فحوص `integrity.*` ثوابت السجل المالي والسوق
   (`public.integrity_report()`). وقبل إعادة الضبط قد يظهر الفحصان
   `units_match_history` و`units_conserved_per_symbol` باللون الأحمر بسبب وحدات
   قديمة لا يقابلها إصدار، وتزيلها الخطوة 5.
5. **تشغيل `go_live_reset.sql`** مرة واحدة في محرّر SQL في Lovable Cloud،
   بوصفه الخطوة الأخيرة قبل دعوة أول مستثمر فعلي:
   - الصق الملف كاملًا وشغّله؛
   - ينبغي أن يظهر الإشعار `GO_LIVE_RESET_DONE` مع أعداد الصفوف المؤرشفة؛
   - إذا توقّف برسالة `GO_LIVE_RESET_ALREADY_RUN` فقد شُغّل سابقًا ولم يتغيّر
     شيء؛ وتعني `GO_LIVE_RESET_NO_ADMIN` أنه لا يوجد حساب بدور
     `platform_admin` بعد؛ وأي خطأ آخر يعني كذلك أنه لم يتغيّر شيء؛
   - تُحفظ الأرشيفات في المخطط الخاص `go_live_archive`، وتشرح ترويسة الملف
     طريقة الاستعادة منها؛
   - بعد ذلك يجب أن تنجح كل فحوص `integrity.*` في `/admin/health` (ويرفض الملف
     نفسه إكمال التنفيذ دون تغيير أي شيء إذا فشل فحص يخص النقد أو الوحدات أو
     الأوامر: `GO_LIVE_RESET_INTEGRITY`).
6. **تفعيل المستثمرين وتمويلهم** من `/admin/investors`: فعّل كل مستثمر مدعو
   (يمنحه دور `trader`)، ثم سجّل إيداعه. يُقيَّد كل مبلغ في سجل النقد وسجل
   التدقيق.
7. **إدراج الأدوات عبر مسار الإدراج** (`/admin/submissions`) بهذا الترتيب، ولكل
   خطوة دورها الخاص، وتفرضها قاعدة البيانات:
   1. يقدّم مالك الشركة أو مسؤولها المالي المنتج (الحالة: *بانتظار المراجعة
      الشرعية*)؛
   2. يعتمده المراجع الشرعي (فيُسجَّل الحكم الشرعي وتُنشأ الأداة خارج السوق دون
      سعر) أو يرفضه مع ذكر السبب. ولا يُستبدل حكم مختلف ساري دون تأكيد صريح؛
   3. يعتمد مدير المنصة الإدراج: يحدّد سعرًا مرجعيًا فعليًا (يُبنى عليه نطاق
      التذبذب ±20% في اليوم الأول)، ويُدرج الأداة، ويمكنه تخصيص الوحدات الأولى
      لأحد مالكي الشركة أو مسؤوليها الماليين، في خطوة واحدة. أو يرفض الإدراج مع
      ذكر السبب.
   أما الأدوات الموجودة دون طلب إدراج (كالاعتماد القديم الذي أخرجته الحزمة من
   السوق) فيصدر المراجع الشرعي حكمه فيها من `/shariah/review` (وتظهر فيها الأدوات
   غير المدرجة أيضًا)، ثم يحدّد مدير المنصة سعرها ويُدرجها من شاشة الإدراج.
8. **إصدار وحدات إضافية** من `/admin/investors` عند الحاجة. لا تظهر في السوق ولا
   تقبل الأوامر إلا الأدوات المدرجة.
