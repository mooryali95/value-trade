// Shared test fixtures: every browser context gets the Arabic interface
// (vu_lang=ar), the cookie notice pre-dismissed, and a guard that fails the
// test if the app tries to reach anything but the local stack (for example
// the production Supabase project committed in .env).
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Locator,
} from "@playwright/test";
import { closeDb } from "./db";
import { sessionStorageKey, stack } from "./stack";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

async function prepareContext(context: BrowserContext, external: string[]): Promise<void> {
  await context.addCookies([{ name: "vu_lang", value: "ar", url: stack().APP_URL }]);
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("cookie-notice:v1", "dismissed");
    } catch {
      // storage blocked: the notice just shows
    }
  });
  context.on("request", (req) => {
    const url = req.url();
    if (!/^https?:/.test(url)) return;
    const host = new URL(url).hostname;
    if (!LOCAL_HOSTS.has(host)) external.push(`${req.method()} ${url}`);
  });
}

type Fixtures = {
  /** Opens another browser context (a second person) prepared like `page`'s. */
  newActor: () => Promise<Page>;
  /** Requests any page of the test sent outside the local stack (must stay empty). */
  externalRequests: string[];
};

export const test = base.extend<Fixtures, { dbPool: void }>({
  // Closes this worker's database pool when the worker ends.
  dbPool: [
    // Playwright requires the object pattern even when nothing is used.
    // eslint-disable-next-line no-empty-pattern
    async ({}, provide) => {
      await provide();
      await closeDb();
    },
    { scope: "worker", auto: true },
  ],
  // eslint-disable-next-line no-empty-pattern
  externalRequests: async ({}, provide) => {
    const list: string[] = [];
    await provide(list);
    // Hermetic: the app under test talks to the local stack only.
    expect(list, "requests that left the local stack").toEqual([]);
  },
  context: async ({ context, externalRequests }, provide) => {
    await prepareContext(context, externalRequests);
    await provide(context);
  },
  newActor: async ({ browser, externalRequests }, provide, testInfo) => {
    const contexts: BrowserContext[] = [];
    await provide(async () => {
      const ctx = await newPreparedContext(browser, testInfo.project.use, externalRequests);
      contexts.push(ctx);
      return ctx.newPage();
    });
    for (const ctx of contexts) await ctx.close().catch(() => undefined);
  },
});

async function newPreparedContext(
  browser: Browser,
  use: Record<string, unknown>,
  external: string[],
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    baseURL: use.baseURL as string,
    locale: use.locale as string,
    timezoneId: use.timezoneId as string,
    viewport: use.viewport as { width: number; height: number },
  });
  await prepareContext(ctx, external);
  return ctx;
}

export { expect };

// ------------------------------------------------------------- helpers ---

/**
 * Resolves once React has hydrated `locator`'s element (React attaches its
 * props to hydrated DOM nodes). Typing into a server-rendered input before
 * that is lost when React takes over.
 */
export async function hydrated(locator: Locator, timeout = 60_000): Promise<void> {
  await locator.waitFor({ state: "visible", timeout });
  await expect
    .poll(
      () =>
        locator
          .evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$")))
          .catch(() => false),
      { message: "element hydrated by React", timeout },
    )
    .toBe(true);
}

/** Goes to `path` and waits until React has hydrated the page and the dev server is quiet. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // Pages that poll never stay idle for long; this only absorbs the initial burst.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForFunction(
    () =>
      Array.from(document.body.querySelectorAll("*")).some((el) =>
        Object.keys(el).some((k) => k.startsWith("__reactProps$")),
      ),
    null,
    { timeout: 60_000, polling: 100 },
  );
}

/** Signs in through the real /auth form and waits until the app has a session. */
export async function signIn(
  page: Page,
  email: string,
  password: string,
  redirect?: string,
): Promise<void> {
  await open(page, redirect ? `/auth?redirect=${encodeURIComponent(redirect)}` : "/auth");
  const emailInput = page.locator('form input[type="email"]');
  await hydrated(emailInput);
  await emailInput.fill(email);
  await page.locator('form input[type="password"]').fill(password);
  await expect(emailInput).toHaveValue(email);
  await page.locator('form button[type="submit"]').click();
  await expect
    .poll(() => page.evaluate((k) => !!window.localStorage.getItem(k), sessionStorageKey()), {
      message: `a session for ${email}`,
      timeout: 30_000,
    })
    .toBe(true);
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30_000 });
}

/** The open confirm dialog (useConfirm, a Radix alert dialog). */
export function confirmDialog(page: Page): Locator {
  return page.getByRole("alertdialog");
}

/** A sonner toast containing `text`. */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}
