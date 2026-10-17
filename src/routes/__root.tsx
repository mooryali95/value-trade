import type { ErrorComponentProps } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import {
  I18nProvider,
  LANG_COOKIE,
  ensureLang,
  langFromCookieString,
  parseLang,
  useI18n,
  type Lang,
} from "../lib/i18n";
import { SITE, canonicalUrl } from "@/lib/config/site";
import { AppModeProvider } from "@/lib/nav/app-mode";
import { supabase } from "../integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { CookieConsent } from "@/components/cookie-consent";
import { ConfirmProvider } from "@/components/confirm-dialog";

/**
 * Interface language for this request: the `vu_lang` cookie on the server,
 * the same cookie in the browser (Arabic when absent). Resolved in the root
 * `beforeLoad` so the shell renders `<html lang dir>` correctly on first paint.
 */
const readLang = createIsomorphicFn()
  .server((): Lang => parseLang(getCookie(LANG_COOKIE)) ?? "ar")
  .client((): Lang => langFromCookieString(document.cookie) ?? "ar");

function NotFoundComponent() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="text-7xl font-bold text-foreground" aria-hidden="true">
          404
        </p>
        <h1 className="mt-4 text-xl font-semibold text-foreground">{t("g_pageNotFoundTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("g_pageNotFoundDesc")}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("g_goHome")}
          </Link>
          <Link
            to="/market"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/60"
          >
            {t("g_browseMarket")}
          </Link>
        </div>
      </div>
    </main>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const { t } = useI18n();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("errorTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("g_rootErrorDesc")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("tryAgain")}
          </button>
          <a
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("g_goHome")}
          </a>
        </div>
      </div>
    </main>
  );
}

const SITE_TITLE = `${SITE.brandAr} | ${SITE.brandEn}`;
const SITE_DESCRIPTION =
  "وحدة القيمة سوق خاصة بالدعوة فقط: تُدرج الشركات أسهمها وصناديقها وصكوكها ووحدات علاماتها التجارية، ويتداولها مستثمرون تفعّلهم إدارة المنصة. Value Unit is a private, invitation-only market for brand units.";
const OG_IMAGE = canonicalUrl("/og-image.png");

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: () => ({ lang: readLang() }),
  head: async ({ match }) => {
    // Load the dictionary before the first render (server and hydration) so
    // an English page never renders Arabic copy first.
    await ensureLang(match.context.lang ?? "ar");
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: SITE_TITLE },
        { name: "description", content: SITE_DESCRIPTION },
        { name: "author", content: SITE.brandEn },
        { name: "application-name", content: SITE.brandEn },
        { name: "apple-mobile-web-app-title", content: SITE.brandAr },
        { name: "theme-color", content: "#071123" },
        { property: "og:site_name", content: SITE_TITLE },
        { property: "og:title", content: SITE_TITLE },
        { property: "og:description", content: SITE_DESCRIPTION },
        { property: "og:type", content: "website" },
        { property: "og:locale", content: "ar_SA" },
        { property: "og:locale:alternate", content: "en_US" },
        { property: "og:image", content: OG_IMAGE },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: SITE_TITLE },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: SITE_TITLE },
        { name: "twitter:description", content: SITE_DESCRIPTION },
        { name: "twitter:image", content: OG_IMAGE },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const { lang } = Route.useRouteContext();
  // The provider wraps the whole document so the root 404 / error screens
  // (rendered instead of RootComponent) are translated too.
  return (
    <I18nProvider initialLang={lang ?? "ar"}>
      <Document>{children}</Document>
    </I18nProvider>
  );
}

function Document({ children }: { children: ReactNode }) {
  const { lang, dir } = useI18n();
  return (
    <html lang={lang} dir={dir}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <AppModeProvider>
        <ConfirmProvider>
          <Outlet />
          <CookieConsent />
          <Toaster />
        </ConfirmProvider>
      </AppModeProvider>
    </QueryClientProvider>
  );
}
