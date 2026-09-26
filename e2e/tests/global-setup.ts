// Warm-up before the journeys: vite dev compiles modules on first request and
// may re-optimise dependencies it discovers late (which reloads open pages).
// Visiting every page the journeys use once, in a real browser, moves that
// cost and those reloads out of the timed tests.
import { chromium, type FullConfig } from "@playwright/test";
import { sessionStorageKey, stack } from "./support/stack";

const PUBLIC_ROUTES = ["/", "/auth", "/auth/update-password", "/request-access", "/market", "/market/sample-brand-1", "/trade/sample-brand-1"];
// Client-only (signed-in) pages, loaded with the seeded admin's session.
const SIGNED_IN_ROUTES = ["/portfolio", "/access-requests", "/admin/investors", "/admin/submissions", "/company/submit", "/shariah/review", "/trade/sample-brand-1"];

export default async function globalSetup(config: FullConfig): Promise<void> {
  const { APP_URL, SUPABASE_URL } = stack();
  for (const [name, url] of [
    ["app", `${APP_URL}/`],
    ["gateway", `${SUPABASE_URL}/health`],
  ]) {
    const res = await fetch(url).catch((e: Error) => e);
    if (res instanceof Error || !res.ok) {
      throw new Error(`The e2e stack is not answering (${name}: ${url}). Start it with 'bash e2e/stack/start.sh'.`);
    }
  }
  const started = Date.now();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: stack().ANON_KEY },
    body: JSON.stringify({ email: "admin@preview.local", password: "Preview123!" }),
  });
  if (!res.ok) throw new Error(`warm-up sign-in failed: ${res.status} ${await res.text()}`);
  const session = await res.json();

  const browser = await chromium.launch();
  try {
    const visit = async (routes: string[], withSession: boolean) => {
      const ctx = await browser.newContext({ baseURL: APP_URL, locale: "ar-SA" });
      if (withSession) {
        await ctx.addInitScript(
          ({ key, value }) => window.localStorage.setItem(key, value),
          { key: sessionStorageKey(), value: JSON.stringify(session) },
        );
      }
      const page = await ctx.newPage();
      for (const route of routes) {
        await page.goto(route, { waitUntil: "domcontentloaded", timeout: 180_000 });
        await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
      }
      await ctx.close();
    };
    // Twice: the second pass loads whatever a dependency re-optimisation of the first invalidated.
    for (let pass = 0; pass < 2; pass++) {
      await visit(PUBLIC_ROUTES, false);
      await visit(SIGNED_IN_ROUTES, true);
    }
  } finally {
    await browser.close();
  }
  console.log(`[e2e] warm-up took ${Math.round((Date.now() - started) / 1000)}s`);
  void config;
}
