import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/legal/privacy")({
  head: () => ({
    meta: [
      { title: "سياسة الخصوصية — قيمة | Privacy Policy — Value Unit" },
      { name: "description", content: "كيفية جمع واستخدام وحماية بياناتك في منصة قيمة." },
      { property: "og:title", content: "Privacy Policy — Value Unit" },
      { property: "og:description", content: "How Value Unit collects, uses, and protects your data." },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { lang } = useI18n();
  return (
    <AppShell>
      <article className="prose prose-sm mx-auto max-w-3xl py-8 text-ink">
        <div className="h-px hairline-gold mb-6" />
        {lang === "ar" ? <Ar /> : <En />}
      </article>
    </AppShell>
  );
}

function Ar() {
  return (
    <>
      <h1 className="text-3xl font-bold text-ink">سياسة الخصوصية</h1>
      <p className="text-xs text-muted-foreground">آخر تحديث: 2026-07-12</p>

      <h2 className="mt-8 text-lg font-semibold">1. البيانات التي نجمعها</h2>
      <ul className="list-disc pr-5 text-sm text-ink-soft">
        <li>بيانات الحساب: البريد، الاسم، الدور، الشركة المرتبطة.</li>
        <li>بيانات التداول والاستخدام: الأوامر، التنبيهات، سجلات النشاط.</li>
        <li>البيانات التقنية: عنوان IP، نوع المتصفح، ملفات ارتباط ضرورية للجلسة.</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold">2. أغراض الاستخدام</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        تشغيل المنصة، ضبط الصلاحيات، حماية الحسابات، تطوير الخدمة، والامتثال للأنظمة.
      </p>

      <h2 className="mt-6 text-lg font-semibold">3. المشاركة مع أطراف ثالثة</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        لا نبيع بياناتك. قد نشاركها مع مزوّدي البنية التحتية (استضافة، بريد، تحليلات) وفق اتفاقيات معالجة بيانات.
      </p>

      <h2 className="mt-6 text-lg font-semibold">4. حقوقك</h2>
      <ul className="list-disc pr-5 text-sm text-ink-soft">
        <li>الاطلاع على بياناتك وتعديلها.</li>
        <li>طلب حذف الحساب.</li>
        <li>سحب الموافقة على معالجة اختيارية.</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold">5. الاحتفاظ بالبيانات</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        نحتفظ بالبيانات طوال فترة الحساب وحتى 7 سنوات بعد الإغلاق حسب متطلبات الأنظمة المالية.
      </p>

      <h2 className="mt-6 text-lg font-semibold">6. التواصل</h2>
      <p className="text-sm leading-relaxed text-ink-soft">لأي استفسار عن الخصوصية: privacy@valueunit.app</p>
    </>
  );
}

function En() {
  return (
    <>
      <h1 className="text-3xl font-bold text-ink">Privacy Policy</h1>
      <p className="text-xs text-muted-foreground">Last updated: 2026-07-12</p>

      <h2 className="mt-8 text-lg font-semibold">1. Data We Collect</h2>
      <ul className="list-disc pl-5 text-sm text-ink-soft">
        <li>Account data: email, name, role, linked company.</li>
        <li>Trading & usage data: orders, alerts, activity logs.</li>
        <li>Technical data: IP, browser type, session cookies.</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold">2. Purposes</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        Operating the platform, enforcing permissions, account security, service improvement, and regulatory compliance.
      </p>

      <h2 className="mt-6 text-lg font-semibold">3. Third Parties</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        We do not sell your data. We may share with infrastructure providers (hosting, email, analytics) under data-processing agreements.
      </p>

      <h2 className="mt-6 text-lg font-semibold">4. Your Rights</h2>
      <ul className="list-disc pl-5 text-sm text-ink-soft">
        <li>Access and correct your data.</li>
        <li>Request account deletion.</li>
        <li>Withdraw optional processing consents.</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold">5. Retention</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        We keep account data for the account lifetime and up to 7 years afterwards to satisfy financial-regulation retention.
      </p>

      <h2 className="mt-6 text-lg font-semibold">6. Contact</h2>
      <p className="text-sm leading-relaxed text-ink-soft">Privacy inquiries: privacy@valueunit.app</p>
    </>
  );
}