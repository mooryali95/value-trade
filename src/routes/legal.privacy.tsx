import { createFileRoute, Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { LegalContacts, LegalList, LegalPage, type LegalSection } from "@/components/legal-page";
import { SITE, canonicalUrl, isFilled } from "@/lib/config/site";

export const Route = createFileRoute("/legal/privacy")({
  head: () => ({
    meta: [
      { title: "سياسة الخصوصية — وحدة القيمة | Privacy Policy — Value Unit" },
      {
        name: "description",
        content:
          "البيانات الشخصية التي تعالجها وحدة القيمة وأغراضها ومدد حفظها وحقوقك. · The personal data Value Unit processes, why, for how long, and your rights.",
      },
      { property: "og:title", content: "Privacy Policy — Value Unit" },
      { property: "og:description", content: "The personal data Value Unit processes, why, for how long, and your rights." },
      { property: "og:url", content: canonicalUrl("/legal/privacy") },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/legal/privacy") }],
  }),
  component: PrivacyPage,
});

const linkCls = "font-medium text-[var(--gold-deep)] underline underline-offset-2";

function PrivacyPage() {
  const { lang } = useI18n();
  return lang === "ar" ? (
    <LegalPage
      doc="privacy"
      title="سياسة الخصوصية"
      summary={
        <p>
          نجمع ما يلزم فقط لتشغيل سوق خاصة بالدعوة: بيانات حسابك ودورك، وأوامرك وسجلك النقدي، وسجلات الأمان والتدقيق. لا نبيع
          البيانات الشخصية، ولا نستخدم ملفات ارتباط إعلانية أو تحليلية.
        </p>
      }
      sections={arSections()}
    />
  ) : (
    <LegalPage
      doc="privacy"
      title="Privacy Policy"
      summary={
        <p>
          We collect only what is needed to run a private, invitation-only market: your account and role, your orders and cash
          ledger, and security and audit logs. We do not sell personal data and we do not use advertising or analytics cookies.
        </p>
      }
      sections={enSections()}
    />
  );
}

type Row = [string, string];

function RetentionTable({ head, rows }: { head: Row; rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full min-w-[420px] text-start text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-semibold">{head[0]}</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a} className="border-t border-border/40 align-top">
              <td className="px-3 py-2 text-ink">{a}</td>
              <td className="px-3 py-2">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const privacyEmail = isFilled(SITE.privacyEmail) ? SITE.privacyEmail.trim() : "";

function arSections(): LegalSection[] {
  return [
    {
      id: "scope",
      heading: "نطاق السياسة",
      body: (
        <p>
          توضّح هذه السياسة كيف تعالج منصة «وحدة القيمة» البيانات الشخصية عند طلب الانضمام إليها أو استخدامها، وفقًا لنظام حماية
          البيانات الشخصية في المملكة العربية السعودية ولوائحه.
        </p>
      ),
    },
    {
      id: "data",
      heading: "البيانات التي نعالجها",
      body: (
        <LegalList
          items={[
            "بيانات الحساب: البريد الإلكتروني، وكلمة المرور (يحفظها مزوّد المصادقة بصيغة مشفّرة غير قابلة للاسترجاع)، وسجلات تسجيل الدخول.",
            "بيانات الملف الشخصي: الاسم واللغة المفضلة.",
            "طلبات الانضمام: الاسم والبريد الإلكتروني، والشركة المطلوب الانضمام إليها أو اسم الشركة الجديدة وقطاعها، ونتيجة المراجعة وسبب الرفض إن وُجد.",
            "العضوية في الشركات: الشركة ودورك فيها، والدعوات المرسلة والمقبولة.",
            "بيانات التداول والنقد: أوامرك وتاريخها، والصفقات التي كنت طرفًا فيها، ومراكزك، ورصيدك النقدي وقيود سجل النقد (ومنها الإيداعات والسحوبات التي يسجّلها مدير المنصة)، وتخصيصات الوحدات.",
            "طلبات الإدراج ومستنداتها التي ترفعها الشركات، وقد تتضمن بيانات ممثليها.",
            "سجلات المراجعة الشرعية: هوية المراجع الذي سجّل الحكم أو عدّله وسبب التعديل (للمراجعين فقط).",
            "التنبيهات والإشعارات: تنبيهات الأسعار، والرموز التي تتابعها، وتفضيلات الإشعارات، ورموز إلغاء الاشتراك.",
            "سجلات التدقيق: الإجراءات الحساسة ومنفّذها ووقتها.",
            "سجلات إرسال البريد: عنوان المستلم ونوع الرسالة وحالة الإرسال ووقته.",
            "البيانات التقنية: عنوان IP لأغراض الحد من معدل الطلبات، وسجلات الخوادم لدى مزوّد الاستضافة، والعناصر المحفوظة في متصفحك (انظر سياسة ملفات الارتباط).",
          ]}
        />
      ),
    },
    {
      id: "purposes",
      heading: "أغراض المعالجة وأسسها النظامية",
      body: (
        <>
          <LegalList
            items={[
              "إنشاء حسابك وتشغيل المنصة وتنفيذ أوامرك وحفظ سجلاتها: لتنفيذ العلاقة التعاقدية معك.",
              "مراجعة طلبات الانضمام والإدراج: بناءً على طلبك ولاتخاذ الخطوات السابقة للتعاقد.",
              "حفظ السجلات المالية وسجلات التدقيق والاستجابة للجهات المختصة: للوفاء بالالتزامات النظامية.",
              "حماية الحسابات ومنع الاحتيال والحد من إساءة الاستخدام: لمصلحة مشروعة لا تضر بحقوقك.",
              "رسائل الخدمة (الدعوات، وتأكيد البريد، وإعادة تعيين كلمة المرور، وإشعارات الأحكام الشرعية المرتبطة بمراكزك): لتنفيذ الخدمة. أما تنبيهات الأسعار والإشعارات الاختيارية فوفق تفضيلاتك، ويمكنك إيقافها في أي وقت.",
            ]}
          />
          <p>نطلب موافقتك حين يشترط النظام ذلك، ويمكنك سحبها متى شئت دون أن يؤثر ذلك في مشروعية المعالجة السابقة.</p>
        </>
      ),
    },
    {
      id: "sharing",
      heading: "مشاركة البيانات",
      body: (
        <LegalList
          items={[
            "لا نبيع البيانات الشخصية ولا نؤجّرها.",
            "لا تُكشف هوية الطرف المقابل في الصفقات لأي مستخدم. وتُنشر بيانات السوق العامة (الأسعار والكميات والصفقات) دون أي معرّف لأصحابها.",
            "يطّلع أعضاء الشركة على ما تتيحه أدوارهم داخل شركتهم فقط، ويطّلع مالك الشركة على سجل تدقيقها.",
            "نستعين بمزوّد لخدمات الاستضافة السحابية وقواعد البيانات، ومزوّد لخدمة البريد الإلكتروني للرسائل التشغيلية، ويعالجان البيانات نيابة عنا ووفق تعليماتنا.",
            "نفصح عن البيانات للجهات الحكومية أو القضائية المختصة متى أوجب النظام ذلك.",
          ]}
        />
      ),
    },
    {
      id: "transfers",
      heading: "نقل البيانات خارج المملكة",
      body: (
        <p>
          قد يعالج مزوّدو الخدمة البيانات على خوادم تقع خارج المملكة العربية السعودية. لا ننقل البيانات إلا في الحدود التي يجيزها
          نظام حماية البيانات الشخصية ولائحة نقل البيانات الشخصية إلى خارج المملكة، مع ضمانات مناسبة لحمايتها.
        </p>
      ),
    },
    {
      id: "retention",
      heading: "مدد الحفظ",
      body: (
        <>
          <RetentionTable
            head={["البيانات", "مدة الحفظ"]}
            rows={[
              ["سجل التدقيق", "24 شهرًا"],
              ["سجل تدقيق الأحكام الشرعية", "دون حد زمني، بوصفه سجلًا نظاميًا للأحكام"],
              ["الأوامر والمراكز وقيود سجل النقد", "دون حد زمني، بوصفها سجلات مالية"],
              ["سجل إرسال البريد", "90 يومًا"],
              ["سجلات الحد من معدل الطلبات (ومنها عنوان IP)", "ساعة واحدة"],
              ["رموز إلغاء الاشتراك في البريد", "12 شهرًا"],
              ["مستندات طلبات الإدراج", "مدة بقاء الطلب مضافًا إليها 24 شهرًا"],
            ]}
          />
          <p>
            تُحفظ بقية البيانات، كالملف الشخصي وطلبات الانضمام، ما دام حسابك قائمًا أو بالقدر اللازم للغرض الذي جُمعت من أجله.
            عند حذف الحساب نحذف بيانات الدخول والملف الشخصي والتنبيهات والرموز المتابَعة والتفضيلات، ونحتفظ بالسجلات المالية
            وسجلات التدقيق مرتبطةً بمعرّف داخلي للحساب فقط دون اسمك أو بريدك، للوفاء بالتزامات حفظ السجلات. تُؤخذ نسخ احتياطية
            يومية آلية، وقد تبقى البيانات المحذوفة فيها إلى أن تُستبدل.
          </p>
        </>
      ),
    },
    {
      id: "security",
      heading: "حماية البيانات",
      body: (
        <p>
          تُنقل البيانات عبر اتصال مشفّر (HTTPS)، وتخضع قاعدة البيانات لسياسات وصول على مستوى الصفوف تقصر اطلاع كل مستخدم على
          بياناته وبيانات شركته وفق دوره. لا يستطيع المستخدمون تعديل السجلات المالية مباشرة، وتُسجَّل الإجراءات الحساسة في سجل
          تدقيق، ونفحص كلمات المرور مقابل قوائم كلمات المرور المسرّبة.
        </p>
      ),
    },
    {
      id: "rights",
      heading: "حقوقك",
      body: (
        <>
          <p>بموجب نظام حماية البيانات الشخصية يحق لك:</p>
          <LegalList
            items={[
              "العلم بكيفية جمع بياناتك ومعالجتها والغرض من ذلك.",
              "الوصول إلى بياناتك والحصول على نسخة منها.",
              "تصحيح بياناتك غير الصحيحة أو الناقصة أو تحديثها.",
              "طلب إتلاف بياناتك متى انتفت الحاجة إليها، مع مراعاة ما يلزمنا النظام بحفظه.",
              "سحب موافقتك على أي معالجة قائمة على الموافقة.",
              "تقديم شكوى إلى الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا).",
            ]}
          />
          <p>
            لممارسة حقوقك{privacyEmail ? " راسلنا على " : " تواصل معنا عبر العناوين الواردة أدناه"}
            {privacyEmail && (
              <a href={`mailto:${privacyEmail}`} className={linkCls} dir="ltr">
                {privacyEmail}
              </a>
            )}
            ، وسنرد خلال المدة التي يحددها النظام. ويمكنك إدارة الإشعارات من إعدادات حسابك أو عبر رابط إلغاء الاشتراك في أي رسالة.
          </p>
        </>
      ),
    },
    {
      id: "cookies",
      heading: "ملفات الارتباط والتخزين في المتصفح",
      body: (
        <p>
          لا نستخدم ملفات ارتباط إعلانية أو تحليلية. تفاصيل ما يُحفظ في متصفحك في{" "}
          <Link to="/legal/cookies" className={linkCls}>سياسة ملفات الارتباط</Link>.
        </p>
      ),
    },
    {
      id: "minors",
      heading: "القاصرون",
      body: <p>المنصة غير موجّهة لمن هم دون 18 عامًا، ولا نعالج بياناتهم عن علم.</p>,
    },
    {
      id: "changes",
      heading: "تعديل السياسة",
      body: <p>ننشر أي تعديل على هذه الصفحة مع تاريخ التحديث، ونبلغك بالتعديلات الجوهرية عبر البريد الإلكتروني أو داخل المنصة.</p>,
    },
    {
      id: "contact",
      heading: "التواصل",
      body: <LegalContacts kinds={["privacy", "contact", "complaints"]} />,
    },
  ];
}

function enSections(): LegalSection[] {
  return [
    {
      id: "scope",
      heading: "Scope",
      body: (
        <p>
          This policy explains how the Value Unit platform processes personal data when you request access to it or use it, in
          line with the Personal Data Protection Law of the Kingdom of Saudi Arabia (PDPL) and its regulations.
        </p>
      ),
    },
    {
      id: "data",
      heading: "Data we process",
      body: (
        <LegalList
          items={[
            "Account data: email address, password (stored by the authentication provider as a one-way hash), and sign-in records.",
            "Profile data: name and preferred language.",
            "Access requests: name and email, the company you ask to join or the new company's name and sector, and the review outcome and any rejection reason.",
            "Company membership: the company, your role in it, and invitations sent and accepted.",
            "Trading and cash data: your orders and their history, trades you were a party to, your positions, your cash balance and cash-ledger entries (including deposits and withdrawals recorded by the platform administrator), and unit allocations.",
            "Listing submissions and the documents companies upload, which may include details of their representatives.",
            "Shariah review records: the identity of the reviewer who recorded or changed a ruling, and the reason for a change (reviewers only).",
            "Alerts and notifications: price alerts, symbols you follow, notification preferences and unsubscribe tokens.",
            "Audit logs: sensitive actions, who performed them and when.",
            "Email delivery logs: recipient address, message type, delivery status and time.",
            "Technical data: IP address for rate limiting, server logs kept by the hosting provider, and items stored in your browser (see the Cookie Policy).",
          ]}
        />
      ),
    },
    {
      id: "purposes",
      heading: "Purposes and legal bases",
      body: (
        <>
          <LegalList
            items={[
              "Creating your account, operating the Platform, executing your orders and keeping their records: to perform our contract with you.",
              "Reviewing access requests and listing submissions: at your request and to take steps before entering into a contract.",
              "Keeping financial and audit records and responding to competent authorities: to meet legal obligations.",
              "Protecting accounts, preventing fraud and limiting abuse: our legitimate interest, without prejudice to your rights.",
              "Service emails (invitations, email confirmation, password reset, and Shariah ruling notices linked to your positions): to provide the service. Price alerts and optional notifications follow your preferences and can be switched off at any time.",
            ]}
          />
          <p>Where the law requires consent we ask for it, and you can withdraw it at any time without affecting earlier processing.</p>
        </>
      ),
    },
    {
      id: "sharing",
      heading: "Sharing",
      body: (
        <LegalList
          items={[
            "We do not sell or rent personal data.",
            "Trade counterparties are never disclosed to any user. Public market data (prices, volumes and trades) is published without identifying anyone.",
            "Company members see only what their role allows within their own company; the company owner can see the company's audit log.",
            "We use a cloud hosting and database provider and a transactional email provider, which process data on our behalf and on our instructions.",
            "We disclose data to competent government or judicial authorities where the law requires it.",
          ]}
        />
      ),
    },
    {
      id: "transfers",
      heading: "Transfers outside the Kingdom",
      body: (
        <p>
          Our service providers may process data on servers outside the Kingdom of Saudi Arabia. We transfer data only as
          permitted by the PDPL and the Regulation on Personal Data Transfer outside the Kingdom, with appropriate safeguards.
        </p>
      ),
    },
    {
      id: "retention",
      heading: "Retention",
      body: (
        <>
          <RetentionTable
            head={["Data", "Retention"]}
            rows={[
              ["Audit log", "24 months"],
              ["Shariah ruling audit trail", "Indefinite, as the regulatory record of rulings"],
              ["Orders, positions and cash-ledger entries", "Indefinite, as financial records"],
              ["Email delivery log", "90 days"],
              ["Rate-limit records (including IP address)", "1 hour"],
              ["Email unsubscribe tokens", "12 months"],
              ["Listing submission documents", "Lifetime of the submission plus 24 months"],
            ]}
          />
          <p>
            Other data, such as your profile and access requests, is kept while your account exists or as long as needed for the
            purpose it was collected for. When an account is deleted we delete its sign-in data, profile, alerts, followed symbols
            and preferences; financial and audit records are kept linked only to an internal account identifier, not to your name
            or email, to meet record-keeping obligations. Automated daily backups are taken, and deleted data may remain in them
            until they are replaced.
          </p>
        </>
      ),
    },
    {
      id: "security",
      heading: "Security",
      body: (
        <p>
          Data travels over encrypted connections (HTTPS). Row-level access policies in the database limit each user to their own
          data and their company's data according to their role. Users cannot change financial records directly, sensitive
          actions are recorded in an audit log, and passwords are checked against known leaked-password lists.
        </p>
      ),
    },
    {
      id: "rights",
      heading: "Your rights",
      body: (
        <>
          <p>Under the PDPL you have the right to:</p>
          <LegalList
            items={[
              "be informed of how and why your data is collected and processed;",
              "access your data and obtain a copy of it;",
              "have inaccurate or incomplete data corrected or updated;",
              "ask for your data to be destroyed once it is no longer needed, subject to what the law requires us to keep;",
              "withdraw consent to any processing based on consent;",
              "lodge a complaint with the Saudi Data and Artificial Intelligence Authority (SDAIA).",
            ]}
          />
          <p>
            To exercise your rights{privacyEmail ? ", email " : ", contact us at the addresses below"}
            {privacyEmail && (
              <a href={`mailto:${privacyEmail}`} className={linkCls} dir="ltr">
                {privacyEmail}
              </a>
            )}
            ; we will respond within the period set by the law. You can manage notifications in your account settings or through
            the unsubscribe link in any email.
          </p>
        </>
      ),
    },
    {
      id: "cookies",
      heading: "Cookies and browser storage",
      body: (
        <p>
          We do not use advertising or analytics cookies. What is stored in your browser is described in the{" "}
          <Link to="/legal/cookies" className={linkCls}>Cookie Policy</Link>.
        </p>
      ),
    },
    {
      id: "minors",
      heading: "Minors",
      body: <p>The Platform is not intended for people under 18, and we do not knowingly process their data.</p>,
    },
    {
      id: "changes",
      heading: "Changes to this policy",
      body: <p>We publish any change on this page with its update date and notify you of material changes by email or on the Platform.</p>,
    },
    {
      id: "contact",
      heading: "Contact",
      body: <LegalContacts kinds={["privacy", "contact", "complaints"]} />,
    },
  ];
}
