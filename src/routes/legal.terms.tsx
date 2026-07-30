import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/legal/terms")({
  head: () => ({
    meta: [
      { title: "الشروط والأحكام — وحدة القيمة | Terms of Service — Value Unit" },
      { name: "description", content: "الشروط والأحكام لاستخدام منصة وحدة القيمة لتداول وحدة القيمة." },
      { property: "og:title", content: "Terms of Service — Value Unit" },
      { property: "og:description", content: "Terms governing the use of the Value Unit exchange platform." },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
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
      <h1 className="text-3xl font-bold text-ink">الشروط والأحكام</h1>
      <p className="text-xs text-muted-foreground">آخر تحديث: 2026-07-12</p>

      <h2 className="mt-8 text-lg font-semibold">1. القبول</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        باستخدامك لمنصة "قيمة" (المشار إليها بـ"المنصة") فإنك توافق على الالتزام بهذه الشروط. إذا كنت لا توافق على أي بند فيرجى عدم استخدام المنصة.
      </p>

      <h2 className="mt-6 text-lg font-semibold">2. طبيعة الخدمة</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        توفّر المنصة بيئة رقمية مؤسسية لإصدار وتقييم وتبادل وحدة القيمة المرتبطة بالعلامات التجارية والمنتجات، وفق معايير AAOIFI. المنصة ليست نصيحة استثمارية.
      </p>

      <h2 className="mt-6 text-lg font-semibold">3. الحسابات والأدوار</h2>
      <ul className="list-disc pr-5 text-sm text-ink-soft">
        <li>يتحمل صاحب الحساب مسؤولية سرية بيانات الدخول.</li>
        <li>تختلف الصلاحيات وفق الدور: مالك شركة، مالي، مراجع شرعي، متداول، مطّلع.</li>
        <li>يحق للمنصة تعليق أو إنهاء أي حساب في حالات الاحتيال أو مخالفة الأنظمة.</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold">4. الالتزام الشرعي</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        تخضع جميع الأدوات المتداولة لمراجعة الهيئة الشرعية المستقلة. لا تُتاح الرافعة المالية أو الفوائد الربوية، ويُمنع أي أمر يخالف قرارات الهيئة.
      </p>

      <h2 className="mt-6 text-lg font-semibold">5. المخاطر</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        قد تنطوي التعاملات على مخاطر انخفاض القيمة الجزئي أو الكلي. المستخدم وحده مسؤول عن قراراته.
      </p>

      <h2 className="mt-6 text-lg font-semibold">6. حدود المسؤولية</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        لا تتحمل المنصة أي خسارة غير مباشرة، ولا تضمن استمرارية الخدمة دون انقطاع تقني مبرَّر.
      </p>

      <h2 className="mt-6 text-lg font-semibold">7. القانون المطبق</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        تُفسَّر هذه الشروط وفق الأنظمة السارية في المملكة العربية السعودية، ويُختصّ بأي نزاع الجهات القضائية المختصّة فيها.
      </p>
    </>
  );
}

function En() {
  return (
    <>
      <h1 className="text-3xl font-bold text-ink">Terms of Service</h1>
      <p className="text-xs text-muted-foreground">Last updated: 2026-07-12</p>

      <h2 className="mt-8 text-lg font-semibold">1. Acceptance</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        By using the Value Unit platform ("Platform") you agree to be bound by these Terms. If you do not agree, do not use the Platform.
      </p>

      <h2 className="mt-6 text-lg font-semibold">2. Service Description</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        The Platform provides an institutional venue to issue, valuate and exchange value units tied to brands and products, in alignment with AAOIFI standards. Nothing herein is investment advice.
      </p>

      <h2 className="mt-6 text-lg font-semibold">3. Accounts & Roles</h2>
      <ul className="list-disc pl-5 text-sm text-ink-soft">
        <li>You are responsible for the confidentiality of your credentials.</li>
        <li>Access follows your role: company owner, finance, shariah reviewer, trader, viewer.</li>
        <li>We may suspend accounts for fraud or violation of applicable laws.</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold">4. Shariah Compliance</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        All tradable instruments are reviewed by an independent Shariah board. Leverage and interest are not offered; orders that violate board decisions are blocked.
      </p>

      <h2 className="mt-6 text-lg font-semibold">5. Risk</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        Transactions may involve partial or total value loss. You alone are responsible for your decisions.
      </p>

      <h2 className="mt-6 text-lg font-semibold">6. Limitation of Liability</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        The Platform is not liable for indirect losses and does not guarantee uninterrupted service.
      </p>

      <h2 className="mt-6 text-lg font-semibold">7. Governing Law</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        These Terms are governed by the laws of the Kingdom of Saudi Arabia, and its competent courts have jurisdiction over any dispute.
      </p>
    </>
  );
}