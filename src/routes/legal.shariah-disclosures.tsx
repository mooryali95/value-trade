import { createFileRoute, Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { LegalContacts, LegalList, LegalPage, type LegalSection } from "@/components/legal-page";
import { SITE, canonicalUrl } from "@/lib/config/site";

export const Route = createFileRoute("/legal/shariah-disclosures")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "الإفصاحات الشرعية — وحدة القيمة | Shariah Disclosures — Value Unit" },
      {
        name: "description",
        content:
          "كيف تُراجَع الإدراجات شرعيًا في وحدة القيمة، وأثر الأحكام وحدودها. · How Shariah review works on Value Unit, the effect of rulings and their limits.",
      },
      { property: "og:title", content: "Shariah Disclosures — Value Unit" },
      { property: "og:description", content: "How Shariah review works on Value Unit, the effect of rulings and their limits." },
      { property: "og:url", content: canonicalUrl("/legal/shariah-disclosures") },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/legal/shariah-disclosures") }],
  }),
  component: DisclosuresPage,
});

const linkCls = "font-medium text-[var(--gold-deep)] underline underline-offset-2";

function DisclosuresPage() {
  const { lang } = useI18n();
  return lang === "ar" ? (
    <LegalPage
      doc="shariah"
      title="الإفصاحات الشرعية"
      summary={
        <p>
          لكل أداة مدرجة في المنصة حكم شرعي ساري المفعول، يصدر عن المراجعين الشرعيين في المنصة ويطبّقه محرك المطابقة تلقائيًا.
          الحكم نتيجة مراجعة المنصة الداخلية، وليس شهادة من جهة خارجية ولا نصيحة استثمارية.
        </p>
      }
      sections={arSections()}
    />
  ) : (
    <LegalPage
      doc="shariah"
      title="Shariah Disclosures"
      summary={
        <p>
          Every instrument listed on the Platform has a Shariah ruling in force, issued by the Platform's Shariah reviewers and
          enforced automatically by the matching engine. A ruling is the outcome of the Platform's internal review; it is not a
          certificate from an external body and it is not investment advice.
        </p>
      }
      sections={enSections()}
    />
  );
}

function BoardList({ lang }: { lang: "ar" | "en" }) {
  if (SITE.shariahBoard.length === 0) return null;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {SITE.shariahBoard.map((m) => (
        <li key={m.nameEn || m.nameAr} className="rounded-lg border border-border/60 bg-card/60 px-4 py-3">
          <div className="font-semibold text-ink">{lang === "ar" ? m.nameAr || m.nameEn : m.nameEn || m.nameAr}</div>
          <div className="text-xs text-muted-foreground">{lang === "ar" ? m.roleAr || m.roleEn : m.roleEn || m.roleAr}</div>
        </li>
      ))}
    </ul>
  );
}

function arSections(): LegalSection[] {
  return [
    {
      id: "reviewers",
      heading: "من يراجع",
      body: (
        <>
          <p>
            يتولى المراجعة الشرعية المستخدمون الذين يمنحهم مدير المنصة دور «المراجع الشرعي». تُسجَّل هوية المراجع في كل حكم
            وكل تعديل عليه من جلسة دخوله مباشرةً، ولا تُنشر للعموم.
          </p>
          <BoardList lang="ar" />
        </>
      ),
    },
    {
      id: "process",
      heading: "آلية المراجعة",
      body: (
        <LegalList
          items={[
            "تقدّم الشركة علامتها التجارية مع المستندات المؤيدة.",
            "يراجع المراجع الشرعي الطلب فيقبله أو يرفضه، ولا يُقبل الرفض دون سبب مكتوب يوضّح للشركة ما يلزم.",
            "عند القبول تُنشر العلامة أداةً قابلة للتداول.",
            "يسجّل المراجعون لكل أداة حكمًا من ثلاثة: «متوافق»، أو «قيد المراجعة»، أو «غير متوافق»، مع سببه. الحكم الساري هو آخر تغيير مسجّل للأداة، ويُعرض مع تاريخ سريانه.",
          ]}
        />
      ),
    },
    {
      id: "effect",
      heading: "أثر الأحكام على التداول",
      body: (
        <LegalList
          items={[
            "«غير متوافق»: يرفض محرك المطابقة أي أمر شراء جديد، ويُلغي جميع أوامر الشراء المعلّقة على الأداة في العملية نفسها التي يُسجَّل فيها الحكم. يبقى البيع متاحًا ليتمكن الحاملون من الخروج.",
            "«قيد المراجعة»: لا يقيّد هذا الوضع التداول بذاته، وينبغي للمستثمر أخذه في الحسبان قبل التداول.",
            "«متوافق»: لا قيود شرعية على التداول في الأداة.",
          ]}
        />
      ),
    },
    {
      id: "features",
      heading: "ضوابط عامة في المنصة",
      body: (
        <LegalList
          items={[
            "لا رافعة مالية ولا تمويل بالهامش: يلزم أن يغطي رصيدك النقدي كل أمر شراء.",
            "لا بيع على المكشوف: لا يُقبل البيع إلا لوحدات تملكها.",
            "لا تُحتسب فوائد على الأرصدة النقدية ولا تُدفع.",
          ]}
        />
      ),
    },
    {
      id: "records",
      heading: "السجلات والشفافية",
      body: (
        <p>
          يُحفظ كل حكم مع سببه وتاريخ سريانه، ويُسجَّل كل تعديل في سجل تدقيق تُضاف إليه القيود ولا يستطيع المستخدمون تعديلها، ويتضمن المراجع وسبب التعديل.
          ويُعرض الحكم الساري لكل أداة منشورة في <Link to="/shariah" className={linkCls}>صفحة الحوكمة الشرعية</Link>، وقد يصلك
          إشعار بالبريد عند تغيّر حكم أداة تملكها أو تتابعها، وفق تفضيلاتك.
        </p>
      ),
    },
    {
      id: "limits",
      heading: "حدود الأحكام",
      body: (
        <p>
          يستند الحكم إلى المعلومات التي قدّمتها الشركة وقت المراجعة، وقد يتغيّر إذا تغيّرت. الحكم ليس فتوى صادرة عن جهة خارجية،
          ولا شهادة اعتماد من أي جهة معيارية، ولا نصيحة استثمارية. ولمن يرغب في الاطمئنان أن يستشير أهل العلم الذين يثق بهم.
        </p>
      ),
    },
    {
      id: "contact",
      contactKinds: ["contact", "privacy", "complaints", "security"],
      heading: "التواصل",
      body: <LegalContacts />,
    },
  ];
}

function enSections(): LegalSection[] {
  return [
    {
      id: "reviewers",
      heading: "Who reviews",
      body: (
        <>
          <p>
            Shariah review is carried out by users to whom the platform administrator grants the "Shariah reviewer" role. The
            reviewer's identity is recorded on every ruling and every change to it, taken directly from their signed-in session,
            and is not published.
          </p>
          <BoardList lang="en" />
        </>
      ),
    },
    {
      id: "process",
      heading: "Review process",
      body: (
        <LegalList
          items={[
            "A company submits its brand with supporting documents.",
            "A Shariah reviewer approves or rejects the submission; a rejection is only accepted with a written reason that tells the company what is needed.",
            "On approval, the brand is published as a tradable instrument.",
            "Reviewers record one of three rulings for each instrument, with its reason: \"compliant\", \"under review\" or \"non-compliant\". The ruling in force is the most recent change recorded for the instrument and is shown with its effective date.",
          ]}
        />
      ),
    },
    {
      id: "effect",
      heading: "Effect of rulings on trading",
      body: (
        <LegalList
          items={[
            "\"Non-compliant\": the matching engine refuses any new buy order and cancels every resting buy order on the instrument in the same operation that records the ruling. Selling stays open so holders can exit.",
            "\"Under review\": this status does not restrict trading by itself; investors should take it into account before trading.",
            "\"Compliant\": no Shariah restriction on trading the instrument.",
          ]}
        />
      ),
    },
    {
      id: "features",
      heading: "Platform-wide safeguards",
      body: (
        <LegalList
          items={[
            "No leverage or margin: your cash balance must cover every buy order.",
            "No short selling: you can only sell units you hold.",
            "No interest is charged or paid on cash balances.",
          ]}
        />
      ),
    },
    {
      id: "records",
      heading: "Records and transparency",
      body: (
        <p>
          Every ruling is kept with its reason and effective date, and every change is written to an append-only audit trail, which users cannot edit,
          recording the reviewer and the reason for the change. The ruling in force for each published instrument is shown on the{" "}
          <Link to="/shariah" className={linkCls}>Shariah governance page</Link>, and you may receive an email when the ruling on
          an instrument you hold or follow changes, according to your preferences.
        </p>
      ),
    },
    {
      id: "limits",
      heading: "Limits of rulings",
      body: (
        <p>
          A ruling relies on the information the company provided at the time of review and may change if that information
          changes. It is not a fatwa issued by an external body, not a certification by any standard-setting organisation, and
          not investment advice. Anyone who wants further assurance may consult scholars they trust.
        </p>
      ),
    },
    {
      id: "contact",
      contactKinds: ["contact", "privacy", "complaints", "security"],
      heading: "Contact",
      body: <LegalContacts />,
    },
  ];
}
