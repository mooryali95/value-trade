import { createFileRoute, Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { LegalContacts, LegalPage, type LegalSection } from "@/components/legal-page";
import { canonicalUrl } from "@/lib/config/site";

export const Route = createFileRoute("/legal/cookies")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "سياسة ملفات الارتباط — وحدة القيمة | Cookie Policy — Value Unit" },
      {
        name: "description",
        content:
          "ما تحفظه وحدة القيمة في متصفحك ولماذا، دون ملفات ارتباط إعلانية أو تحليلية. · What Value Unit stores in your browser and why, with no advertising or analytics cookies.",
      },
      { property: "og:title", content: "Cookie Policy — Value Unit" },
      { property: "og:description", content: "What Value Unit stores in your browser and why. No advertising or analytics cookies." },
      { property: "og:url", content: canonicalUrl("/legal/cookies") },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/legal/cookies") }],
  }),
  component: CookiesPage,
});

const linkCls = "font-medium text-[var(--gold-deep)] underline underline-offset-2";

/** Every item the app itself writes to browser storage (grep localStorage / sessionStorage / document.cookie). */
type Item = { key: string; ar: [string, string, string]; en: [string, string, string] };
const ITEMS: Item[] = [
  {
    key: "vu_lang",
    ar: [
      "ملف ارتباط من الطرف الأول يتذكّر لغة الواجهة التي اخترتها، كي يعرض الخادم الصفحات بها مباشرة. لا يُستخدم للتتبع.",
      "وظيفي",
      "سنة واحدة",
    ],
    en: [
      "First-party cookie that remembers the interface language you chose, so the server renders pages in it. Not used for tracking.",
      "Functional",
      "1 year",
    ],
  },
  {
    key: "sb-…-auth-token",
    ar: ["يُبقيك مسجّلًا للدخول (جلسة المصادقة). يُحفظ فقط بعد تسجيل الدخول.", "ضروري", "حتى تسجيل الخروج أو انتهاء الجلسة"],
    en: ["Keeps you signed in (authentication session). Stored only after you sign in.", "Strictly necessary", "Until you sign out or the session expires"],
  },
  {
    key: "qeema:lang",
    ar: ["نسخة قديمة من اختيار اللغة في التخزين المحلي، لا تُقرأ إلا عند غياب ملف الارتباط vu_lang.", "وظيفي", "حتى تمسحه من المتصفح"],
    en: ["Older copy of the language choice in local storage, read only when the vu_lang cookie is missing.", "Functional", "Until you clear it"],
  },
  {
    key: "cookie-notice:v1",
    ar: ["يتذكّر أنك أغلقت إشعار ملفات الارتباط كي لا يظهر مجددًا.", "وظيفي", "حتى تمسحه من المتصفح"],
    en: ["Remembers that you closed the cookie notice so it is not shown again.", "Functional", "Until you clear it"],
  },
  {
    key: "value.activeCompanyId",
    ar: ["يتذكّر الشركة المختارة في مساحة العمل (لأعضاء الشركات).", "وظيفي", "حتى تمسحه من المتصفح"],
    en: ["Remembers the company selected in the workspace (company members).", "Functional", "Until you clear it"],
  },
  {
    key: "vu_active_mode",
    ar: ["يتذكّر الواجهة التي تستخدمها: مستثمر أو شركة أو إدارة المنصة.", "وظيفي", "حتى تمسحه من المتصفح"],
    en: ["Remembers which view you use: investor, company or platform administration.", "Functional", "Until you clear it"],
  },
  {
    key: "email-log:filters:v1",
    ar: ["يتذكّر عوامل التصفية في شاشة سجل البريد (لمديري المنصة فقط).", "وظيفي", "حتى تمسحه من المتصفح"],
    en: ["Remembers the filters on the email log screen (platform administrators only).", "Functional", "Until you clear it"],
  },
];

function StorageTable({ lang }: { lang: "ar" | "en" }) {
  const head =
    lang === "ar" ? ["الاسم", "الغرض", "النوع", "المدة"] : ["Name", "Purpose", "Type", "Duration"];
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-start font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ITEMS.map((it) => {
            const [purpose, type, duration] = lang === "ar" ? it.ar : it.en;
            return (
              <tr key={it.key} className="border-t border-border/40 align-top">
                <td className="px-3 py-2 font-mono text-xs text-ink" dir="ltr">{it.key}</td>
                <td className="px-3 py-2">{purpose}</td>
                <td className="px-3 py-2 whitespace-nowrap">{type}</td>
                <td className="px-3 py-2">{duration}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CookiesPage() {
  const { lang } = useI18n();
  return lang === "ar" ? (
    <LegalPage
      doc="cookies"
      title="سياسة ملفات الارتباط"
      summary={
        <p>
          لا تستخدم المنصة ملفات ارتباط إعلانية أو تحليلية، ولا أي أداة تتبّع. تحفظ في التخزين المحلي لمتصفحك عناصر قليلة
          فقط، يلزم كل منها لتسجيل الدخول أو لتذكّر تفضيلاتك.
        </p>
      }
      sections={arSections()}
    />
  ) : (
    <LegalPage
      doc="cookies"
      title="Cookie Policy"
      summary={
        <p>
          The Platform uses no advertising or analytics cookies and no tracking tools. It keeps only a few items in your
          browser's local storage, each needed for signing in or for remembering your preferences.
        </p>
      }
      sections={enSections()}
    />
  );
}

function arSections(): LegalSection[] {
  return [
    {
      id: "stored",
      heading: "ما نحفظه في متصفحك",
      body: (
        <>
          <p>
            تحفظ المنصة العناصر التالية في متصفحك: ملف ارتباط واحد من الطرف الأول (vu_lang) وعناصر في التخزين المحلي (Local
            Storage)، ولا يُرسَل أيٌّ منها إلى أي طرف ثالث لأغراض إعلانية أو تحليلية:
          </p>
          <StorageTable lang="ar" />
        </>
      ),
    },
    {
      id: "cookies",
      heading: "ملفات الارتباط",
      body: (
        <p>
          ملف الارتباط الوحيد الذي يضعه تطبيق المنصة نفسه هو vu_lang، وهو ملف وظيفي من الطرف الأول يتذكّر لغة الواجهة (انظر
          الجدول أعلاه) ولا يُستخدم للتتبع. قد تضع البنية التحتية للاستضافة والحماية ملفات ارتباط ضرورية لحماية الخدمة من
          الاستخدام الآلي المسيء، ولا تُستخدم هذه الملفات للإعلان أو لبناء ملفات تعريفية عنك.
        </p>
      ),
    },
    {
      id: "no-tracking",
      heading: "لا تحليلات ولا إعلانات",
      body: (
        <p>
          لا نستخدم أدوات تحليل الاستخدام أو الإعلانات أو شبكات التواصل التي تتتبعك عبر المواقع. وإن قررنا مستقبلًا استخدام أي
          ملف ارتباط غير ضروري، فسنطلب موافقتك أولًا ونحدّث هذه السياسة.
        </p>
      ),
    },
    {
      id: "choices",
      heading: "خياراتك",
      body: (
        <p>
          كل العناصر أعلاه لازمة للميزة التي تخدمها، لذا يقتصر إشعار ملفات الارتباط على إعلامك بها. يمكنك مسحها في أي وقت من
          إعدادات المتصفح: مسح جلسة المصادقة يُخرجك من حسابك، ومسح تفضيل اللغة يعيد الواجهة إلى العربية.
        </p>
      ),
    },
    {
      id: "more",
      heading: "مزيد من المعلومات",
      body: (
        <>
          <p>
            لمعرفة كيف نعالج بياناتك الشخصية راجع <Link to="/legal/privacy" className={linkCls}>سياسة الخصوصية</Link>.
          </p>
          <LegalContacts kinds={["privacy", "contact"]} />
        </>
      ),
    },
  ];
}

function enSections(): LegalSection[] {
  return [
    {
      id: "stored",
      heading: "What we store in your browser",
      body: (
        <>
          <p>
            The Platform keeps the following items in your browser: one first-party cookie (vu_lang) and a few local storage
            entries. None of them is sent to a third party for advertising or analytics:
          </p>
          <StorageTable lang="en" />
        </>
      ),
    },
    {
      id: "cookies",
      heading: "Cookies",
      body: (
        <p>
          The only cookie the Platform application itself sets is vu_lang, a first-party functional cookie that remembers your
          interface language (see the table above); it is not used for tracking. Our hosting and security infrastructure may set
          strictly necessary cookies to protect the service against automated abuse; they are not used for advertising or to
          build a profile of you.
        </p>
      ),
    },
    {
      id: "no-tracking",
      heading: "No analytics, no advertising",
      body: (
        <p>
          We use no usage-analytics, advertising or social-media tools that track you across websites. If we ever decide to use a
          non-essential cookie, we will ask for your consent first and update this policy.
        </p>
      ),
    },
    {
      id: "choices",
      heading: "Your choices",
      body: (
        <p>
          Every item above is needed for the feature it supports, so the cookie notice only informs you about them. You can clear
          them at any time in your browser settings: clearing the authentication session signs you out, and clearing the language
          preference returns the interface to Arabic.
        </p>
      ),
    },
    {
      id: "more",
      heading: "More information",
      body: (
        <>
          <p>
            To learn how we process your personal data, see the <Link to="/legal/privacy" className={linkCls}>Privacy Policy</Link>.
          </p>
          <LegalContacts kinds={["privacy", "contact"]} />
        </>
      ),
    },
  ];
}
