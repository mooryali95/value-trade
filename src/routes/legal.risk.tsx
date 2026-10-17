import { createFileRoute, Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { LegalContacts, LegalList, LegalPage, type LegalSection } from "@/components/legal-page";
import { canonicalUrl } from "@/lib/config/site";

export const Route = createFileRoute("/legal/risk")({
  head: () => ({
    meta: [
      { title: "إفصاح المخاطر — وحدة القيمة | Risk Disclosure — Value Unit" },
      {
        name: "description",
        content:
          "المخاطر الرئيسية لتداول الأدوات في وحدة القيمة. · The main risks of trading instruments on Value Unit.",
      },
      { property: "og:title", content: "Risk Disclosure — Value Unit" },
      { property: "og:description", content: "The main risks of trading instruments on Value Unit, a private market." },
      { property: "og:url", content: canonicalUrl("/legal/risk") },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/legal/risk") }],
  }),
  component: RiskPage,
});

const linkCls = "font-medium text-[var(--gold-deep)] underline underline-offset-2";

function RiskPage() {
  const { lang } = useI18n();
  return lang === "ar" ? (
    <LegalPage
      doc="risk"
      title="إفصاح المخاطر"
      summary={
        <p>
          تداول الأدوات المدرجة في المنصة عالي المخاطر. قد تخسر المبلغ الذي استثمرته كله، وقد لا تتمكن من البيع متى أردت. لا
          تستثمر إلا مالًا تستطيع تحمّل خسارته، واطلب استشارة مستقلة عند الحاجة.
        </p>
      }
      sections={arSections()}
    />
  ) : (
    <LegalPage
      doc="risk"
      title="Risk Disclosure"
      summary={
        <p>
          Trading the instruments listed on the Platform is high risk. You could lose all of the money you invest, and you may not be able to sell when
          you want to. Only invest money you can afford to lose, and seek independent advice where appropriate.
        </p>
      }
      sections={enSections()}
    />
  );
}

function arSections(): LegalSection[] {
  return [
    {
      id: "purpose",
      heading: "الغرض من هذا الإفصاح",
      body: (
        <p>
          يبيّن هذا الإفصاح أهم المخاطر المرتبطة بتداول الأدوات في منصة «وحدة القيمة»، ولا يحصرها جميعًا.
          اقرأه مع <Link to="/legal/terms" className={linkCls}>الشروط والأحكام</Link> قبل تقديم أي أمر.
        </p>
      ),
    },
    {
      id: "loss",
      heading: "خسارة رأس المال",
      body: (
        <p>
          قد تنخفض قيمة الوحدات إلى الصفر. لا تدل الأسعار السابقة على الأسعار المستقبلية، ولا تضمن المنصة ولا الشركة المدرجة أي
          عائد أو استرداد لرأس المال.
        </p>
      ),
    },
    {
      id: "liquidity",
      heading: "السيولة والخروج",
      body: (
        <LegalList
          items={[
            "المنصة سوق خاصة بعدد محدود من المشاركين، وقد لا يوجد مشترٍ بالسعر الذي تريده أو بأي سعر.",
            "لا تضمن المنصة وجود طرف مقابل ولا إمكانية الخروج، ولا تعمل صانعَ سوق، ولا تلتزم هي ولا الشركة المدرجة بإعادة شراء الوحدات.",
            "قد يمنع النطاق السعري اليومي (±20٪) البيع أو الشراء بالسعر الذي تريده خلال اليوم نفسه.",
          ]}
        />
      ),
    },
    {
      id: "pricing",
      heading: "تكوّن الأسعار",
      body: (
        <LegalList
          items={[
            "السعر المعروض هو سعر آخر صفقة منفّذة بين المشاركين، وقد يستند إلى عدد قليل من الصفقات أو صفقة واحدة.",
            "قبل أول صفقة لا يوجد سعر سوقي، ويُستخدم السعر المرجعي الذي يحدده مدير المنصة عند الإدراج أساسًا للنطاق السعري فقط، وهو ليس تقييمًا مستقلًا.",
            "قد يكون دفتر الأوامر فارغًا أو ضعيف العمق، فيتسع الفارق بين أفضل سعر شراء وأفضل سعر بيع.",
          ]}
        />
      ),
    },
    {
      id: "issuer",
      heading: "مخاطر الجهة المُصدِرة والأداة",
      body: (
        <p>
          ترتبط قيمة كل أداة بأداء الجهة المُصدِرة وأصولها: نتائج الشركة للأسهم، وأصول الصندوق وإدارته للصناديق، والأصول المصكوكة وقدرة المُصدِر على السداد للصكوك، وأداء العلامة وسمعتها لوحدات العلامات التجارية. المعلومات عن الأداة تقدّمها الشركة نفسها،
          ومراجعة المنصة لها مراجعة شرعية وليست تدقيقًا ماليًا أو قانونيًا ولا ضمانًا لصحتها.
        </p>
      ),
    },
    {
      id: "shariah",
      heading: "مخاطر تغيّر الحكم الشرعي",
      body: (
        <p>
          قد يتغيّر الحكم الشرعي لأي أداة. عند صدور حكم «غير متوافق» تُرفض أوامر الشراء الجديدة وتُلغى أوامر الشراء المعلّقة
          فورًا، فتقل السيولة عادةً، ويبقى البيع متاحًا للحاملين. انظر{" "}
          <Link to="/legal/shariah-disclosures" className={linkCls}>الإفصاحات الشرعية</Link>.
        </p>
      ),
    },
    {
      id: "operational",
      heading: "المخاطر التشغيلية والتقنية",
      body: (
        <p>
          قد تتعطل المنصة أو تتأخر أو تتعرض لأعطال أو هجمات إلكترونية، فيتعذّر تقديم الأوامر أو إلغاؤها أو تنفيذها في الوقت
          المطلوب. كما يؤدي إيقاف صلاحية التداول لأي حساب إلى إلغاء أوامره المفتوحة.
        </p>
      ),
    },
    {
      id: "funding",
      heading: "مخاطر التمويل والتحويل",
      body: (
        <p>
          يسجّل مدير المنصة الإيداعات والسحوبات في سجل النقد، ولا تقبل المنصة الدفع بالبطاقات وليست مرتبطة بأي حساب بنكي. يعتمد
          تحويل الأموال واستردادها على ترتيبات تُتفق مع الجهة المشغّلة خارج المنصة، وقد يتأخر. ولا يعني الرصيد الظاهر في المنصة
          بذاته أن المبالغ محفوظة في حساب منفصل أو لدى أمين حفظ.
        </p>
      ),
    },
    {
      id: "legal",
      heading: "المخاطر النظامية والضريبية",
      body: (
        <p>
          قد تتغيّر الأنظمة المنطبقة على المنصة أو على الأدوات المدرجة فيها، مما قد يقيّد التداول أو يستلزم تغيير الخدمة أو
          إيقافها. وأنت مسؤول عن أي التزامات زكوية أو ضريبية تترتب على تداولاتك.
        </p>
      ),
    },
    {
      id: "no-advice",
      heading: "لا نصيحة استثمارية",
      body: (
        <p>
          لا تقدّم المنصة نصيحة استثمارية، ولا يُعدّ أي سعر أو رسم بياني أو حكم شرعي معروض فيها توصية بالشراء أو البيع.
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
      id: "purpose",
      heading: "Purpose of this disclosure",
      body: (
        <p>
          This disclosure describes the main risks of trading instruments on the Value Unit platform. It does not list every
          risk. Read it together with the <Link to="/legal/terms" className={linkCls}>Terms of Service</Link> before placing
          any order.
        </p>
      ),
    },
    {
      id: "loss",
      heading: "Loss of capital",
      body: (
        <p>
          Units can fall in value to zero. Past prices are not a guide to future prices, and neither the Platform nor the listed
          company guarantees any return or the repayment of capital.
        </p>
      ),
    },
    {
      id: "liquidity",
      heading: "Liquidity and exit",
      body: (
        <LegalList
          items={[
            "The Platform is a private market with a limited number of participants; there may be no buyer at the price you want or at any price.",
            "The Platform does not guarantee a counterparty or an exit, does not act as a market maker, and neither it nor the listed company is obliged to buy units back.",
            "The daily price band (±20%) may prevent you from buying or selling at the price you want within the same day.",
          ]}
        />
      ),
    },
    {
      id: "pricing",
      heading: "How prices form",
      body: (
        <LegalList
          items={[
            "The price shown is the price of the last trade executed between participants and may rest on very few trades, or a single one.",
            "Before the first trade there is no market price; the reference price set by the platform administrator at listing only anchors the price band and is not an independent valuation.",
            "The order book may be empty or thin, widening the gap between the best bid and the best offer.",
          ]}
        />
      ),
    },
    {
      id: "issuer",
      heading: "Issuer and instrument risk",
      body: (
        <p>
          The value of each Instrument depends on its issuer and underlying assets: the company's results for stocks, the fund's
          assets and management for funds, the underlying assets and the issuer's ability to pay for sukuk, and the brand's
          performance and reputation for brand units. Information about an Instrument is supplied by the company itself; the Platform's review of it is a Shariah review, not a
          financial or legal audit, and it does not guarantee that the information is accurate.
        </p>
      ),
    },
    {
      id: "shariah",
      heading: "Changes in Shariah rulings",
      body: (
        <p>
          The Shariah ruling on any instrument may change. When a "non-compliant" ruling is issued, new buy orders are refused
          and resting buy orders are cancelled at once, which usually reduces liquidity; holders can still sell. See the{" "}
          <Link to="/legal/shariah-disclosures" className={linkCls}>Shariah Disclosures</Link>.
        </p>
      ),
    },
    {
      id: "operational",
      heading: "Operational and technology risk",
      body: (
        <p>
          The Platform may be unavailable, delayed, or affected by faults or cyber-attacks, so that orders cannot be placed,
          cancelled or executed when you want. Deactivating an account's trading access also cancels its open orders.
        </p>
      ),
    },
    {
      id: "funding",
      heading: "Funding and transfer risk",
      body: (
        <p>
          Deposits and withdrawals are recorded in the cash ledger by the platform administrator; the Platform does not accept
          card payments and is not connected to any bank account. Transferring and returning funds depends on arrangements agreed
          with the operator outside the Platform and may be delayed. A balance shown on the Platform does not by itself mean that
          funds are held in a segregated or custodial account.
        </p>
      ),
    },
    {
      id: "legal",
      heading: "Legal, regulatory and tax risk",
      body: (
        <p>
          The rules that apply to the Platform or to the instruments listed on it may change, which could restrict trading or require the service
          to change or stop. You are responsible for any zakat or tax obligations arising from your trades.
        </p>
      ),
    },
    {
      id: "no-advice",
      heading: "No investment advice",
      body: (
        <p>
          The Platform does not provide investment advice, and no price, chart or Shariah ruling shown on it is a recommendation
          to buy or sell.
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
