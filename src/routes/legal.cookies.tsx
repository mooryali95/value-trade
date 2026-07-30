import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/legal/cookies")({
  head: () => ({
    meta: [
      { title: "سياسة ملفات الارتباط — وحدة القيمة | Cookie Policy — Value Unit" },
      { name: "description", content: "كيف تستخدم منصة وحدة القيمة ملفات الارتباط والتخزين المحلي." },
      { property: "og:title", content: "Cookie Policy — Value Unit" },
      { property: "og:description", content: "How Value Unit uses cookies and browser storage." },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: CookiesPage,
});

function CookiesPage() {
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
      <h1 className="text-3xl font-bold text-ink">سياسة ملفات الارتباط</h1>
      <p className="text-xs text-muted-foreground">آخر تحديث: 2026-07-12</p>
      <h2 className="mt-8 text-lg font-semibold">أنواع الملفات المستخدمة</h2>
      <ul className="list-disc pr-5 text-sm text-ink-soft">
        <li><b>ضرورية:</b> جلسة المصادقة، تفضيل اللغة، حماية CSRF.</li>
        <li><b>وظيفية:</b> تفضيلات العرض (فلاتر الجداول، حجم الصفحة).</li>
        <li><b>تحليلية (اختيارية):</b> عدّاد مجهول للاستخدام لتحسين الأداء.</li>
      </ul>
      <h2 className="mt-6 text-lg font-semibold">التحكم</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        يمكنك حذف الملفات من إعدادات المتصفح. تعطيل الضرورية قد يمنعك من تسجيل الدخول.
      </p>
    </>
  );
}

function En() {
  return (
    <>
      <h1 className="text-3xl font-bold text-ink">Cookie Policy</h1>
      <p className="text-xs text-muted-foreground">Last updated: 2026-07-12</p>
      <h2 className="mt-8 text-lg font-semibold">Types We Use</h2>
      <ul className="list-disc pl-5 text-sm text-ink-soft">
        <li><b>Strictly necessary:</b> auth session, language preference, CSRF protection.</li>
        <li><b>Functional:</b> UI preferences (table filters, page size).</li>
        <li><b>Analytics (optional):</b> anonymous usage counters for performance.</li>
      </ul>
      <h2 className="mt-6 text-lg font-semibold">Controls</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        You can clear cookies in your browser settings. Disabling strictly-necessary cookies may prevent sign-in.
      </p>
    </>
  );
}