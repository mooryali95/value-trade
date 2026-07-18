
## خطة التحسين الشاملة — الطريق إلى الإطلاق

### أولاً: حالة الخطط السابقة (ما نُفّذ وما لم يُنفّذ)

خارطة الطريق الأصلية (`.lovable/plan.md`) تحوي 6 مراحل. إليك التقييم الفعلي:

| المرحلة | الحالة | ملاحظات |
|---|---|---|
| **1 — الأمان والامتثال** | 🟡 جزئي | ✅ فحوصات RLS، ✅ إصلاح ثغرتين حديثاً (`SUPA_authenticated_security_definer_function_executable`, `shariah_decision_audit_broad_auth_read`)، ✅ HMAC على `/api/public/cron-alerts`. ❌ **متبقّي:** تفعيل HIBP، Rate limiting، فحص نهائي، تدوير المفاتيح. |
| **2 — البريد والإشعارات** | 🔴 لم يبدأ | ما زال البريد يُرسل من `onboarding@resend.dev`. لا يوجد جدول `notifications` ولا badge. |
| **3 — بيانات السوق الحقيقية** | 🔴 لم يبدأ | لا يزال `mock-data.ts` و `mock-provider` هما المصدر. cron-alerts يقرأ من الـ mock. |
| **4 — المدفوعات** | 🔴 لم يبدأ | لا Stripe/Paddle، لا خطط اشتراك، لا صفحة `/billing`. |
| **5 — UX والمحتوى** | 🟡 جزئي | ✅ الصفحات القانونية موجودة، ✅ sitemap/robots. ❌ **متبقّي:** Onboarding، og:image ديناميكية، تدقيق أداء Lighthouse، Dark mode، تدقيق RTL. |
| **6 — الجودة والعمليات** | 🟡 جزئي | ✅ اختبارات RLS + invitations + cron. ❌ **متبقّي:** Playwright E2E، Sentry، Analytics، Backup policy، Runbook، Status page. |

**إضافة خارج الخارطة (نُفّذت مؤخراً):** طبقة RBAC كاملة + `AccessDenied` guards + جدول `audit_log` وصفحة `/company/audit` مع فلترة وتصدير CSV.

### ثانياً: الخطة المقترحة الشاملة (بترتيب تنفيذ منطقي)

#### ⏱ المسار السريع (Sprint 1 — إغلاق أمان قبل أي إطلاق)
1. **Rate limiting** على `/api/public/*` (جدول `rate_limits` بمفتاح IP/token + نافذة منزلقة).
2. تفعيل **HIBP** (Leaked Password Protection) في إعدادات المصادقة.
3. **فحص أمني نهائي** (`security--run_security_scan` + `supabase--linter`) وإغلاق أي بند حرج.
4. **تدوير مفاتيح API** (`rotate_api_keys`) قبل النشر النهائي فقط.
5. توثيق سياسة الحوادث ومسؤول الأمان (`SECURITY.md`).

#### 📬 Sprint 2 — البريد والإشعارات
6. ربط نطاق بريدي مخصص عبر `email_domain--setup_email_infra`.
7. قوالب AR/EN لـ: دعوة الشركة، تأكيد الحساب، إعادة كلمة السر، تنبيه سعر، قرار شرعي، قبول/رفض منتج.
8. جدول `notifications` (user_id, type, payload, read_at) + سياسات RLS.
9. Realtime badge في `AppShell` + صفحة `/notifications` + عدّاد غير المقروء.
10. Hooks للأحداث: تنفيذ أمر، إلغاء أمر، قرار مراجعة، قرار شرعي على براند مملوك.

#### 🧭 Sprint 3 — Onboarding و UX
11. Wizard مستخدم جديد: اختيار دور (Trader/Business) → إنشاء/الانضمام لشركة → جولة مرشدة.
12. Empty states احترافية موحّدة (Portfolio/Market/Workspace فارغين).
13. مراجعة RTL شاملة (form controls، ترقيم عربي، ثنائيات النصوص/الأرقام).
14. Dark mode toggle عبر CSS variables الموجودة في `styles.css` (اختياري بحسب رغبة المستخدم).
15. **og:image ديناميكية** لصفحات: `/company/$id`، `/market/$slug`، `/trade/$symbol` (توليد PNG داخل server-fn).
16. تحسين أداء Lighthouse (lazy load، code split routes، cache headers، معاينة الشموع بمكوّن lazy).

#### 📈 Sprint 4 — بيانات السوق الحقيقية
17. اختيار مزوّد أسعار (Twelve Data / Finnhub) وإضافة مفتاحه كـ secret.
18. `RealMarketProvider` يطبّق نفس واجهة `provider.ts` مع تخزين مؤقت (KV/Postgres).
19. Polling سعر خفيف (10–15ث) لصفحات `/market` و `/trade/$symbol` مع React Query.
20. شمعات تاريخية حقيقية (1D/1H/1W) بدل mock.
21. جدولة **pg_cron** لتشغيل `/api/public/cron-alerts` كل دقيقة مع توقيع HMAC.
22. علم بيئة `USE_MOCK_MARKET` للتراجع بأمان.

#### 💳 Sprint 5 — المدفوعات (اختياري بحسب النموذج التجاري)
23. تفعيل Stripe عبر `payments--enable_stripe_payments` (يحتاج قرار: عمولة/اشتراك/رسم اعتماد).
24. جداول `subscriptions`, `invoices` مع RLS و GRANT.
25. خطط: Free (10 براندات) / Pro (30) / Enterprise (custom) — تعديل `enforce_brand_cap`.
26. صفحة `/billing` داخل `_authenticated` + Customer Portal.
27. Webhook `/api/public/stripe` بتحقق توقيع (يُضاف تلقائياً).
28. رسوم اعتماد المنتج عند التقديم أو القبول.

#### 🛡️ Sprint 6 — الجودة والعمليات
29. **Playwright E2E** لخمسة سيناريوهات: تسجيل → إنشاء شركة → دعوة عضو → تقديم منتج → قرار شرعي → تنفيذ أمر → تنبيه سعر.
30. **Sentry** (browser + server functions) لتتبع الأخطاء.
31. **Analytics** بأحداث محدّدة (Plausible/PostHog): sign_up, submit_product, order_placed, alert_fired.
32. **Backup policy** موثقة + خطة استعادة موثّقة.
33. **Runbook** للحوادث + **Status page** عامة.
34. Load test خفيف على `place-order` و `cron-alerts`.

#### 🚀 Sprint 7 — النشر النهائي
35. ربط **نطاق مخصص**.
36. تدقيق نهائي لكل `head()` (title, description, og) على كل الصفحات العامة.
37. Smoke test على الإنتاج + مراقبة أول 24 ساعة.
38. تفعيل التنبيهات (Sentry + status page + on-call).

### ثالثاً: تفاصيل تقنية سريعة

- **Rate limiting**: جدول `rate_limits(key, window_start, count)` + دالة `check_rate_limit(_key text, _limit int, _window interval)` تُستدعى من كل server-fn حسّاسة.
- **Notifications**: نمط event-emitter بسيط عبر trigger على جداول `orders/product_submissions/shariah_decisions` يكتب في `notifications`.
- **og:image ديناميكية**: server route `/api/og/company/$id` يعيد PNG (satori/@vercel/og غير متاحين في Workers → استخدام SVG→PNG عبر resvg-wasm أو صورة مسبقة الصنع مع overlay نص).
- **RealMarketProvider**: يبقى `provider.ts` كواجهة موحّدة؛ التبديل يتم في `router.tsx` بسطر واحد.

### رابعاً: التقدير الزمني الإرشادي

| Sprint | الجهد | الاعتماديات |
|---|---|---|
| 1 (Security) | صغير | — |
| 2 (Email/Notifications) | متوسط | Sprint 1 |
| 3 (UX/Onboarding) | متوسط | — (يمكن بالتوازي) |
| 4 (Real Market) | كبير | مفتاح مزوّد |
| 5 (Payments) | كبير | قرار تسعير |
| 6 (QA/Ops) | متوسط | — |
| 7 (Launch) | صغير | كل ما سبق |

### خامساً: توصيتي بالترتيب

**1 → 2 → 3 → 6 (جزئي: Sentry فقط) → 4 → 5 → 6 (بقية) → 7**

مع تشغيل Sprint 3 بالتوازي مع 2 لأنهما لا يتقاطعان.

### للبدء

أخبرني بأي Sprint أبدأ (أو مهمة محددة داخله) وسأفصّلها في خطة تنفيذية دقيقة.
