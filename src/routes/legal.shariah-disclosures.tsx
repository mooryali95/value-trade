import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/legal/shariah-disclosures")({
  head: () => ({
    meta: [
      { title: "الإفصاحات الشرعية — وحدة القيمة | Shariah Disclosures — Value Unit" },
      { name: "description", content: "الإفصاحات الشرعية والمعايير المرجعية لمنصة وحدة القيمة." },
      { property: "og:title", content: "Shariah Disclosures — Value Unit" },
      { property: "og:description", content: "Shariah governance disclosures and reference standards used by Value Unit." },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: DisclosuresPage,
});

function DisclosuresPage() {
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
      <h1 className="text-3xl font-bold text-ink">الإفصاحات الشرعية</h1>
      <p className="text-xs text-muted-foreground">وفق معايير AAOIFI</p>

      <h2 className="mt-8 text-lg font-semibold">الحوكمة الشرعية</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        تُشرف على المنصة هيئة رقابة شرعية مستقلة، تصدر قرارات جماعية بشأن الأدوات المتداولة، وتُنشر جميع القرارات مع أسبابها وسجل تدقيقها.
      </p>

      <h2 className="mt-6 text-lg font-semibold">المعايير المرجعية</h2>
      <ul className="list-disc pr-5 text-sm text-ink-soft">
        <li>معيار الصكوك (AAOIFI 17)</li>
        <li>معيار المشاركة (AAOIFI 12)</li>
        <li>معيار الأسهم (AAOIFI 21)</li>
        <li>معيار الوعد (AAOIFI 49)</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold">المحظورات</h2>
      <ul className="list-disc pr-5 text-sm text-ink-soft">
        <li>الربا بجميع صوره.</li>
        <li>الرافعة المالية والبيع على المكشوف.</li>
        <li>الأنشطة المخالفة (كحول، ميسر، محرمات).</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold">آلية المراجعة</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        كل براند يمرّ بمراجعة أولية للأنشطة والنسب المالية، ثم مراجعة سنوية دورية، مع إفصاح عن أي تغيّر جوهري.
      </p>
    </>
  );
}

function En() {
  return (
    <>
      <h1 className="text-3xl font-bold text-ink">Shariah Disclosures</h1>
      <p className="text-xs text-muted-foreground">AAOIFI-aligned</p>

      <h2 className="mt-8 text-lg font-semibold">Shariah Governance</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        The platform is overseen by an independent Shariah board that issues collective decisions on tradable instruments. All decisions are published with reasoning and an audit trail.
      </p>

      <h2 className="mt-6 text-lg font-semibold">Reference Standards</h2>
      <ul className="list-disc pl-5 text-sm text-ink-soft">
        <li>Sukuk (AAOIFI 17)</li>
        <li>Musharakah (AAOIFI 12)</li>
        <li>Equity Screening (AAOIFI 21)</li>
        <li>Promises (AAOIFI 49)</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold">Prohibitions</h2>
      <ul className="list-disc pl-5 text-sm text-ink-soft">
        <li>Riba in all forms.</li>
        <li>Leverage and short-selling.</li>
        <li>Non-permissible business activities (alcohol, gambling, etc.).</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold">Review Process</h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        Each brand passes an initial activity and financial-ratio screen, then a periodic annual review, with disclosure of any material change.
      </p>
    </>
  );
}