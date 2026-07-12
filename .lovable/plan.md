## خارطة الطريق للإطلاق الرسمي (Go-Live Roadmap)

منظّمة على 6 مراحل قابلة للتعديل. كل مرحلة مستقلة ويمكن تنفيذها بالتوازي أو الترتيب.

---

### المرحلة 1 — الأمان والامتثال (Security Hardening) [أولوية قصوى]

- تفعيل **Leaked Password Protection (HIBP)** في إعدادات المصادقة.
- مراجعة كامل سياسات RLS المتبقية من تقرير الفحص وإغلاقها.
- تدوير مفاتيح API قبل الإطلاق (`rotate_api_keys`).
- تشغيل `security--run_security_scan` نهائي والتأكد من صفر ثغرات حرجة.
- إضافة **Rate Limiting** على المسارات العامة (`/api/public/*`) خصوصاً webhook و cron.
- التحقق من توقيع HMAC على جميع endpoints العامة.

### المرحلة 2 — البريد والإشعارات (Notifications)

- ربط **نطاق بريدي مخصص** بـ Resend (بدل `onboarding@resend.dev`).
- قوالب بريد رسمية بالعربية/الإنجليزية: دعوة، تأكيد حساب، إعادة كلمة مرور، تنبيه سعر، قرار شرعي، قرار مراجعة منتج.
- إشعارات داخل التطبيق (in-app notifications) بجدول `notifications` + badge في الهيدر.
- إشعار المستخدم عند: تنفيذ أمر، إلغاء أمر، قبول/رفض منتج، إصدار قرار شرعي على براند يملكه.

### المرحلة 3 — البيانات الحقيقية (Real Market Data)

- استبدال `mock-data.ts` بموفّر بيانات حقيقي (Provider abstraction موجود في `src/lib/integrations/`).
- ربط مزوّد أسعار (مثال: Twelve Data / Finnhub / TradingView UDF) عبر secret.
- WebSocket/polling لتحديث الأسعار الحيّة في `/market` و `/trade/$symbol`.
- شمعات (candlesticks) تاريخية حقيقية بدل mock.
- تشغيل cron price-alerts على بيانات حقيقية + جدولته عبر `pg_cron`.

### المرحلة 4 — المدفوعات والاشتراكات (Monetization)

- تحديد نموذج التسعير: عمولة تداول / اشتراك شركة / رسوم اعتماد شرعي.
- تفعيل **Stripe** (أو Paddle) عبر أداة `payments--enable_stripe_payments`.
- خطط الاشتراك للشركات (Basic / Pro / Enterprise) مع حد البراندات (30 حالياً).
- فوترة رسوم اعتماد المنتج عند التقديم أو عند القبول.
- صفحة `/billing` داخل `_authenticated` + webhook Stripe موقّع.

### المرحلة 5 — تجربة المستخدم والمحتوى (UX & Content)

- **Onboarding** للمستخدم الجديد: اختيار دور، ربط شركة أو إنشاؤها، جولة تعريفية.
- صفحات قانونية: **الشروط، الخصوصية، الإفصاحات الشرعية، سياسة ملفات الارتباط**.
- تحسين SEO: `og:image` ديناميكية لكل براند/شركة، sitemap.xml، robots.txt.
- تحسين الأداء (Lighthouse ≥ 90): lazy load الصور، code splitting، cache headers.
- Dark mode toggle (إن كان مطلوباً) + تحقق كامل من RTL على كل الصفحات.
- صفحات فارغة/خطأ محسّنة (empty states, 404, 500).

### المرحلة 6 — الجودة والعمليات (QA & Ops)

- **E2E tests** بـ Playwright لأهم 5 سيناريوهات: تسجيل، تقديم منتج، مراجعة شرعية، تنفيذ أمر، دعوة عضو.
- **Load test** خفيف على cron و place-order.
- **Error monitoring**: تفعيل Sentry أو ما يعادله.
- **Analytics**: PostHog/Plausible للأحداث الأساسية.
- **Backup policy** لقاعدة البيانات + وثيقة استعادة.
- **Runbook** للحوادث (incidents) ومسؤوليات الفريق.
- **صفحة الحالة** (status page) عامة.

---

### مرحلة النشر (Launch Checklist)

1. ربط **نطاق مخصص** (Custom Domain) عبر إعدادات المشروع.
2. تعبئة **Metadata نهائية** (title, description, og:image) لكل صفحة عامة.
3. تشغيل `security--run_security_scan` + `supabase--linter` — صفر تحذيرات حرجة.
4. `preview_ui--publish` بـ slug نهائي.
5. اختبار سريع على الإنتاج (smoke test).
6. تفعيل الإشعارات والمراقبة.

---

### ملاحظات للتعديل

- كل مرحلة قابلة للتقسيم لمهام أصغر عند البدء بها.
- الترتيب المقترح: **1 → 2 → 5 → 3 → 4 → 6 → Launch**، لكن يمكن تشغيل 3 و 4 بالتوازي.
- أخبرني بأي مرحلة تريد البدء بها لأفصّلها لخطة تنفيذ تفصيلية.
