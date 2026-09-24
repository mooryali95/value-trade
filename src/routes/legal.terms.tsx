import { createFileRoute, Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { LegalContacts, LegalList, LegalPage, type LegalSection } from "@/components/legal-page";
import { canonicalUrl } from "@/lib/config/site";

export const Route = createFileRoute("/legal/terms")({
  head: () => ({
    meta: [
      { title: "الشروط والأحكام — وحدة القيمة | Terms of Service — Value Unit" },
      {
        name: "description",
        content:
          "شروط استخدام وحدة القيمة، السوق الخاصة لوحدات العلامات التجارية. · Terms of use of Value Unit, the private market for brand units.",
      },
      { property: "og:title", content: "Terms of Service — Value Unit" },
      { property: "og:description", content: "Terms of use of Value Unit, the private, invitation-only market for brand units." },
      { property: "og:url", content: canonicalUrl("/legal/terms") },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/legal/terms") }],
  }),
  component: TermsPage,
});

const linkCls = "font-medium text-[var(--gold-deep)] underline underline-offset-2";

function TermsPage() {
  const { lang } = useI18n();
  return lang === "ar" ? (
    <LegalPage doc="terms" title="الشروط والأحكام" summary={<ArSummary />} sections={arSections()} />
  ) : (
    <LegalPage doc="terms" title="Terms of Service" summary={<EnSummary />} sections={enSections()} />
  );
}

function ArSummary() {
  return (
    <p>
      وحدة القيمة سوق خاصة لوحدات العلامات التجارية، يقتصر الدخول إليها على من توافق عليهم إدارة المنصة. لا يُعدّ أي محتوى
      في المنصة نصيحة استثمارية، وقد تنخفض قيمة الوحدات أو يتعذّر بيعها. يُرجى قراءة{" "}
      <Link to="/legal/risk" className={linkCls}>إفصاح المخاطر</Link> قبل التداول.
    </p>
  );
}

function EnSummary() {
  return (
    <p>
      Value Unit is a private market for brand units, open only to participants approved by the platform administration.
      Nothing on the Platform is investment advice, and brand units can lose value or be hard to sell. Please read the{" "}
      <Link to="/legal/risk" className={linkCls}>Risk Disclosure</Link> before trading.
    </p>
  );
}

function arSections(): LegalSection[] {
  return [
    {
      id: "acceptance",
      heading: "نطاق الشروط وقبولها",
      body: (
        <>
          <p>
            تنظّم هذه الشروط الدخول إلى منصة «وحدة القيمة» (ويُشار إليها بـ«المنصة») واستخدامها. بإنشائك حسابًا أو قبولك دعوة
            أو استخدامك المنصة، فإنك توافق على هذه الشروط وعلى سياسة الخصوصية وسياسة ملفات الارتباط وإفصاح المخاطر والإفصاحات
            الشرعية، وهي جزء لا يتجزأ منها. إن لم توافق عليها فلا تستخدم المنصة.
          </p>
        </>
      ),
    },
    {
      id: "service",
      heading: "طبيعة الخدمة",
      body: (
        <>
          <p>
            المنصة سوق خاصة تُدرج فيها الشركات وحدات مرتبطة بعلاماتها التجارية («وحدات العلامات التجارية»)، ويشتريها
            المستثمرون المعتمدون ويبيعونها فيما بينهم عبر دفتر أوامر. المنصة ليست سوقًا ماليةً عامة، ولا يعني إدراج أي علامة
            تجارية أن المنصة تزكّيها أو تضمن قيمتها.
          </p>
        </>
      ),
    },
    {
      id: "access",
      heading: "الدخول والحسابات والأدوار",
      body: (
        <LegalList
          items={[
            "الدخول إلى المنصة بالدعوة فقط: تُراجع إدارة المنصة (أو مالك الشركة المعنية) طلبات الانضمام، ولها قبولها أو رفضها.",
            "إنشاء حساب لا يمنح صلاحية التداول. تُفعَّل صلاحية التداول للمستثمر من قِبل مدير المنصة وحده.",
            "تُمنح العضوية في الشركات بدعوة وبدور محدد: مالك، أو مالي، أو مراجع شرعي، أو متداول، أو مطّلع، وتتحدد الصلاحيات وفقًا للدور.",
            "أنت مسؤول عن سرية بيانات دخولك وعن كل ما يجري عبر حسابك، وعليك إبلاغنا فورًا بأي استخدام غير مصرّح به.",
          ]}
        />
      ),
    },
    {
      id: "listings",
      heading: "إدراج العلامات التجارية",
      body: (
        <>
          <p>
            تقدّم الشركة علامتها التجارية مع المستندات المؤيدة، ويراجعها المراجعون الشرعيون في المنصة فيقبلونها أو يرفضونها،
            ويُبيَّن سبب الرفض دائمًا. عند القبول تُنشر العلامة للتداول، ويحدد مدير المنصة السعر المرجعي للإدراج، وتدخل الوحدات
            السوق عبر إصدار أولي يسجّله مدير المنصة.
          </p>
          <p>
            تتحمل الشركة مسؤولية صحة المعلومات والمستندات التي تقدّمها ومشروعيتها، وامتلاكها الحقوق اللازمة في العلامة التجارية.
            المراجعة الشرعية ليست تدقيقًا ماليًا ولا تقييمًا مستقلًا للعلامة.
          </p>
        </>
      ),
    },
    {
      id: "funding",
      heading: "التمويل والأرصدة النقدية",
      body: (
        <>
          <p>
            يبدأ حساب المستثمر برصيد صفري. تُرتَّب الإيداعات والسحوبات مباشرة مع إدارة المنصة، ويسجّلها مدير المنصة في سجل
            النقد الخاص بالمنصة. لا تقبل المنصة الدفع بالبطاقات، وليست مرتبطة بأي حساب بنكي.
          </p>
          <p>
            الرصيد النقدي الظاهر في المنصة قيدٌ في سجلها، ولا يعني بذاته أن المبالغ محفوظة في حساب منفصل أو لدى أمين حفظ.
            تُتفق ترتيبات تحويل الأموال واستردادها مع الجهة المشغّلة خارج المنصة.
          </p>
        </>
      ),
    },
    {
      id: "trading",
      heading: "قواعد التداول",
      body: (
        <>
          <p>يطبّق محرك المطابقة القواعد التالية على كل أمر:</p>
          <LegalList
            items={[
              "الكميات بوحدات صحيحة فقط، من 1 إلى 10,000,000 وحدة في الأمر الواحد، وبفارق سعري أدنى قدره 0.01.",
              "أوامر محددة السعر وأوامر سوقية، تُطابَق باستمرار وفق أولوية السعر ثم أولوية الوقت.",
              "نطاق سعري يومي ±20٪ حول السعر المرجعي، وهو آخر سعر تنفيذ قبل بداية يوم التداول الحالي (بتوقيت الرياض)، أو السعر المرجعي للإدراج قبل أول تنفيذ. لا تُحرّك صفقات اليوم هذا النطاق، ويقع كل تنفيذ داخله.",
              "حماية الأوامر السوقية: لا يبقى الأمر السوقي معلّقًا في الدفتر، ويُلغى أي جزء لم يُنفَّذ داخل النطاق.",
              "حد أقصى لقيمة الأمر الواحد قدره 5,000,000.",
              "يجب أن يكفي رصيدك النقدي للشراء وأن تكفي وحداتك للبيع، مع احتساب أوامرك المفتوحة الأخرى.",
              "يُرفض الأمر الذي سيُطابَق مع أمر معلّق لك (منع التداول الذاتي)، ويُرفض الشراء على أداة حكمها الشرعي «غير متوافق».",
            ]}
          />
          <p>
            يمكنك إلغاء أوامرك المفتوحة قبل تنفيذها. الصفقات المنفّذة نهائية ولا يمكن التراجع عنها من المنصة. قد تُلغى الأوامر
            المفتوحة تلقائيًا عند إيقاف صلاحية التداول لحساب، أو عند صدور حكم «غير متوافق» (لأوامر الشراء المعلّقة).
          </p>
        </>
      ),
    },
    {
      id: "shariah",
      heading: "الحوكمة الشرعية",
      body: (
        <p>
          لكل أداة مدرجة حكم شرعي ساري المفعول تصدره مراجعة المنصة الشرعية، وتشرح{" "}
          <Link to="/legal/shariah-disclosures" className={linkCls}>الإفصاحات الشرعية</Link> آلية المراجعة وأثر الأحكام
          وحدودها. الحكم الشرعي في المنصة نتيجة مراجعتها الداخلية، وليس فتوى صادرة عن جهة خارجية ولا نصيحة استثمارية.
        </p>
      ),
    },
    {
      id: "no-advice",
      heading: "لا نصيحة استثمارية",
      body: (
        <p>
          لا تقدّم المنصة نصيحة استثمارية أو توصية أو دعوة لشراء أي وحدة أو بيعها. الأسعار والرسوم البيانية والأحكام المعروضة
          للاطلاع فقط. قراراتك مسؤوليتك وحدك، وننصحك بطلب استشارة مستقلة عند الحاجة.
        </p>
      ),
    },
    {
      id: "risk",
      heading: "المخاطر",
      body: (
        <p>
          قد تفقد وحدات العلامات التجارية جزءًا من قيمتها أو قيمتها كلها، وقد لا يوجد مشترٍ بالسعر الذي تريده أو بأي سعر. لا
          تضمن المنصة وجود طرف مقابل ولا إمكانية الخروج، ولا تشتري الوحدات من المستثمرين. التفاصيل في{" "}
          <Link to="/legal/risk" className={linkCls}>إفصاح المخاطر</Link>.
        </p>
      ),
    },
    {
      id: "conduct",
      heading: "الاستخدام المقبول",
      body: (
        <LegalList
          items={[
            "يُحظر التلاعب بالسوق، ومنه التداول الصوري والأوامر الوهمية وأي تنسيق للتأثير في الأسعار.",
            "يُحظر تقديم معلومات أو مستندات غير صحيحة أو مضللة.",
            "يُحظر التحايل على ضوابط المنصة أو محاولة الوصول إلى بيانات مستخدمين آخرين أو الوصول الآلي دون إذن مكتوب.",
            "يلتزم كل مستخدم بالأنظمة السارية، ومنها أنظمة مكافحة غسل الأموال وتمويل الإرهاب.",
          ]}
        />
      ),
    },
    {
      id: "suspension",
      heading: "الإيقاف وإنهاء الحساب",
      body: (
        <p>
          يجوز لإدارة المنصة إيقاف صلاحية التداول أو تعليق الحساب عند مخالفة هذه الشروط، أو الاشتباه في احتيال، أو لمتطلب نظامي
          أو أمني. يؤدي إيقاف صلاحية التداول إلى إلغاء جميع الأوامر المفتوحة للحساب. ويمكنك طلب إغلاق حسابك، وتُحفظ السجلات
          المالية وسجلات التدقيق وفق سياسة الخصوصية.
        </p>
      ),
    },
    {
      id: "availability",
      heading: "توافر الخدمة وتعديلها",
      body: (
        <p>
          تُقدَّم المنصة بحسب توافرها. قد تتوقف مؤقتًا للصيانة أو لأسباب تقنية، وقد تتأخر الأسعار أو يتعذّر تنفيذ الأوامر خلال
          ذلك. ويجوز لنا تطوير الخدمة أو تعديل خصائصها.
        </p>
      ),
    },
    {
      id: "liability",
      heading: "حدود المسؤولية",
      body: (
        <p>
          في حدود ما تسمح به الأنظمة، لا نتحمل مسؤولية الخسائر غير المباشرة أو التبعية أو فوات الربح، ولا الخسائر الناتجة عن
          تحركات الأسعار أو قراراتك الاستثمارية أو عن ظروف خارجة عن سيطرتنا المعقولة. ولا يحدّ أي بند في هذه الشروط من مسؤولية لا
          يجوز الحد منها نظامًا.
        </p>
      ),
    },
    {
      id: "ip",
      heading: "الملكية الفكرية",
      body: (
        <p>
          اسم «وحدة القيمة» والبرمجيات والتصاميم مملوكة للجهة المشغّلة للمنصة. أما العلامات التجارية المدرجة فمملوكة لأصحابها،
          ولا يمنحك استخدام المنصة أي حق فيها.
        </p>
      ),
    },
    {
      id: "changes",
      heading: "تعديل الشروط",
      body: (
        <p>
          ننشر أي تعديل على هذه الصفحة مع تاريخ التحديث، ونبلغك بالتعديلات الجوهرية عبر البريد الإلكتروني أو داخل المنصة. استمرارك
          في الاستخدام بعد سريان التعديل يعني قبوله.
        </p>
      ),
    },
    {
      id: "law",
      heading: "النظام المطبّق",
      body: (
        <p>
          تخضع هذه الشروط لأنظمة المملكة العربية السعودية وتُفسَّر وفقًا لها، وتختص الجهات القضائية المختصة في المملكة بالنظر في
          أي نزاع ينشأ عنها.
        </p>
      ),
    },
    {
      id: "contact",
      contactKinds: ["contact", "privacy", "complaints", "security"],
      heading: "التواصل",
      body: (
        <>
          <p>يمكنك التواصل معنا بشأن هذه الشروط عبر العناوين التالية:</p>
          <LegalContacts />
        </>
      ),
    },
  ];
}

function enSections(): LegalSection[] {
  return [
    {
      id: "acceptance",
      heading: "Scope and acceptance",
      body: (
        <p>
          These Terms govern access to and use of the Value Unit platform (the "Platform"). By creating an account, accepting
          an invitation or using the Platform, you agree to these Terms and to the Privacy Policy, Cookie Policy, Risk
          Disclosure and Shariah Disclosures, which form part of them. If you do not agree, do not use the Platform.
        </p>
      ),
    },
    {
      id: "service",
      heading: "The service",
      body: (
        <p>
          The Platform is a private market on which companies list units linked to their brands ("brand units") and approved
          investors buy and sell them among themselves on an order book. The Platform is not a public exchange, and the listing
          of a brand is not an endorsement of it or a guarantee of its value.
        </p>
      ),
    },
    {
      id: "access",
      heading: "Access, accounts and roles",
      body: (
        <LegalList
          items={[
            "Access is by invitation only: the platform administration (or the owner of the company concerned) reviews access requests and may accept or decline them.",
            "Creating an account does not grant trading access. An investor's trading access is activated by the platform administrator only.",
            "Company membership is granted by invitation with a specific role: owner, finance, Shariah reviewer, trader or viewer. Permissions follow the role.",
            "You are responsible for keeping your sign-in details confidential and for all activity under your account, and must tell us promptly about any unauthorised use.",
          ]}
        />
      ),
    },
    {
      id: "listings",
      heading: "Brand listings",
      body: (
        <>
          <p>
            A company submits its brand with supporting documents. The Platform's Shariah reviewers approve or reject the
            submission, and a rejection always states its reason. On approval the brand is published for trading, the platform
            administrator sets its listing reference price, and units enter the market through a primary issuance recorded by the
            platform administrator.
          </p>
          <p>
            The company is responsible for the accuracy and lawfulness of the information and documents it submits and for
            holding the necessary rights in the brand. Shariah review is not a financial audit or an independent valuation of the
            brand.
          </p>
        </>
      ),
    },
    {
      id: "funding",
      heading: "Funding and cash balances",
      body: (
        <>
          <p>
            Investor accounts start with a zero balance. Deposits and withdrawals are arranged directly with the platform
            administration and recorded by the platform administrator in the Platform's cash ledger. The Platform does not accept
            card payments and is not connected to any bank account.
          </p>
          <p>
            A cash balance shown on the Platform is an entry in its ledger; it does not by itself mean that funds are held in a
            segregated or custodial account. Arrangements for transferring and returning funds are agreed with the operator
            outside the Platform.
          </p>
        </>
      ),
    },
    {
      id: "trading",
      heading: "Trading rules",
      body: (
        <>
          <p>The matching engine applies the following rules to every order:</p>
          <LegalList
            items={[
              "Whole units only, from 1 to 10,000,000 units per order, with a minimum price increment of 0.01.",
              "Limit and market orders, matched continuously by price priority, then time priority.",
              "A daily price band of ±20% around the reference price: the last execution price before the current trading day (Riyadh time), or the listing reference price before the first execution. Trades during the day do not move the band, and every execution falls inside it.",
              "Market-order protection: a market order never rests on the book, and any part that cannot execute inside the band is cancelled.",
              "A maximum order value of 5,000,000.",
              "Your cash must cover buys and your units must cover sells, taking your other open orders into account.",
              "An order that would match your own resting order is refused (self-trade prevention), and buys on an instrument whose Shariah ruling is \"non-compliant\" are refused.",
            ]}
          />
          <p>
            You can cancel open orders before they execute. Executed trades are final and cannot be reversed from the Platform.
            Open orders may be cancelled automatically when an account's trading access is deactivated, or when a "non-compliant"
            ruling is issued (for resting buy orders).
          </p>
        </>
      ),
    },
    {
      id: "shariah",
      heading: "Shariah governance",
      body: (
        <p>
          Every listed instrument has a Shariah ruling in force, issued through the Platform's Shariah review. The{" "}
          <Link to="/legal/shariah-disclosures" className={linkCls}>Shariah Disclosures</Link> explain the review process, the
          effect of rulings and their limits. A ruling on the Platform is the outcome of its internal review; it is not a fatwa
          issued by an external body and it is not investment advice.
        </p>
      ),
    },
    {
      id: "no-advice",
      heading: "No investment advice",
      body: (
        <p>
          The Platform does not provide investment advice, recommendations or solicitations to buy or sell any unit. Prices,
          charts and rulings are shown for information only. Your decisions are your own responsibility; seek independent advice
          where appropriate.
        </p>
      ),
    },
    {
      id: "risk",
      heading: "Risk",
      body: (
        <p>
          Brand units can lose part or all of their value, and there may be no buyer at the price you want or at any price. The
          Platform does not guarantee a counterparty or an exit and does not buy units from investors. See the{" "}
          <Link to="/legal/risk" className={linkCls}>Risk Disclosure</Link> for details.
        </p>
      ),
    },
    {
      id: "conduct",
      heading: "Acceptable use",
      body: (
        <LegalList
          items={[
            "Market manipulation is prohibited, including wash trades, orders not intended to execute and any coordination to influence prices.",
            "Submitting false or misleading information or documents is prohibited.",
            "Circumventing the Platform's controls, attempting to access other users' data, or automated access without written permission is prohibited.",
            "Every user must comply with applicable laws, including anti-money-laundering and counter-terrorist-financing rules.",
          ]}
        />
      ),
    },
    {
      id: "suspension",
      heading: "Suspension and termination",
      body: (
        <p>
          The platform administration may deactivate trading access or suspend an account for breach of these Terms, suspected
          fraud, or a legal or security requirement. Deactivating trading access cancels all of the account's open orders. You
          may ask for your account to be closed; financial and audit records are retained as described in the Privacy Policy.
        </p>
      ),
    },
    {
      id: "availability",
      heading: "Availability and changes to the service",
      body: (
        <p>
          The Platform is provided as available. It may be interrupted for maintenance or technical reasons, during which prices
          may be delayed or orders may not execute. We may develop the service or change its features.
        </p>
      ),
    },
    {
      id: "liability",
      heading: "Limitation of liability",
      body: (
        <p>
          To the extent permitted by law, we are not liable for indirect or consequential loss or loss of profit, or for losses
          resulting from price movements, your investment decisions or circumstances beyond our reasonable control. Nothing in
          these Terms limits any liability that cannot be limited by law.
        </p>
      ),
    },
    {
      id: "ip",
      heading: "Intellectual property",
      body: (
        <p>
          The Value Unit name, software and designs belong to the operator of the Platform. Listed brands belong to their
          owners, and using the Platform gives you no rights in them.
        </p>
      ),
    },
    {
      id: "changes",
      heading: "Changes to these Terms",
      body: (
        <p>
          We publish any change on this page with its update date and notify you of material changes by email or on the
          Platform. Continuing to use the Platform after a change takes effect means you accept it.
        </p>
      ),
    },
    {
      id: "law",
      heading: "Governing law",
      body: (
        <p>
          These Terms are governed by and construed under the laws of the Kingdom of Saudi Arabia, and the competent courts of
          the Kingdom have jurisdiction over any dispute arising from them.
        </p>
      ),
    },
    {
      id: "contact",
      contactKinds: ["contact", "privacy", "complaints", "security"],
      heading: "Contact",
      body: (
        <>
          <p>You can contact us about these Terms at the following addresses:</p>
          <LegalContacts />
        </>
      ),
    },
  ];
}
