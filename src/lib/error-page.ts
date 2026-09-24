/**
 * Static fallback page served when server rendering itself failed, so React
 * and the i18n provider are not available. The request language is unknown
 * here, so the page carries both languages: Arabic first (the default), then
 * English. Keep the copy in line with the `errorTitle`, `g_rootErrorDesc`,
 * `tryAgain` and `g_goHome` keys in src/lib/i18n/{ar,en}.ts.
 */
const COPY = {
  ar: {
    title: "تعذّر تحميل هذه الصفحة",
    desc: "حدث خطأ من جهتنا. أعد المحاولة، أو عُد إلى الصفحة الرئيسية.",
    retry: "إعادة المحاولة",
    home: "الانتقال إلى الصفحة الرئيسية",
  },
  en: {
    title: "This page didn't load",
    desc: "Something went wrong on our side. Try again, or return to the home page.",
    retry: "Try again",
    home: "Go to the home page",
  },
} as const;

function block(lang: "ar" | "en"): string {
  const c = COPY[lang];
  return `<section class="card" lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}">
      <h${lang === "ar" ? "1" : "2"}>${c.title}</h${lang === "ar" ? "1" : "2"}>
      <p>${c.desc}</p>
      <div class="actions">
        <button type="button" class="primary" onclick="location.reload()">${c.retry}</button>
        <a class="secondary" href="/">${c.home}</a>
      </div>
    </section>`;
}

export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>${COPY.ar.title} | ${COPY.en.title} — وحدة القيمة | Value Unit</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <style>
      body { font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; background: #fcfaf6; color: #071123; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      main { max-width: 30rem; width: 100%; }
      .card { text-align: center; padding: 1.5rem 1rem; }
      .card + .card { border-top: 1px solid #e4dfd3; }
      h1, h2 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.25rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { min-height: 44px; box-sizing: border-box; display: inline-flex; align-items: center; padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      a:focus-visible, button:focus-visible { outline: 2px solid #8a6516; outline-offset: 2px; }
      .primary { background: #071123; color: #fcfaf6; }
      .secondary { background: #fff; color: #071123; border-color: #d1d5db; }
    </style>
  </head>
  <body>
    <main>
    ${block("ar")}
    ${block("en")}
    </main>
  </body>
</html>`;
}
