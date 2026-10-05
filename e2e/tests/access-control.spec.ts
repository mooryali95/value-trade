// Journey 5: access control smoke.
import { test, expect, hydrated, open, signIn } from "./support/fixtures";
import { createUser, uniqueTag } from "./support/db";
import { t } from "./support/i18n";

test.describe("access control", () => {
  test("a signed-in user without roles sees the access-denied state on /admin/investors", async ({
    page,
  }) => {
    const tag = uniqueTag();
    const email = `norole.${tag}@e2e.local`;
    const password = `Norole-${tag}1`;
    await createUser({ email, password, fullName: `مستخدم بلا صلاحيات ${tag}` });

    await signIn(page, email, password);
    await open(page, "/admin/investors");

    await expect(page).toHaveURL(/\/admin\/investors$/);
    await expect(page.getByRole("heading", { name: t("notAuthorizedTitle") })).toBeVisible();
    await expect(page.getByText(t("notAuthorizedDesc"))).toBeVisible();
    // None of the admin tools render.
    await expect(page.getByText(t("r_invPendingTitle"))).toHaveCount(0);
    await expect(page.locator("#investor-email")).toHaveCount(0);
  });

  test("an anonymous visitor to a guarded route is sent to /auth and back after signing in", async ({
    page,
  }) => {
    await open(page, "/portfolio");

    await page.waitForURL((u) => u.pathname === "/auth");
    // The page asked for travels along (with the route's default search params).
    const redirect = new URL(page.url()).searchParams.get("redirect") ?? "";
    expect(new URL(redirect, page.url()).pathname).toBe("/portfolio");
    await expect(page.getByRole("heading", { name: t("signinCta") })).toBeVisible();

    // The redirect target is honoured once the visitor signs in.
    const tag = uniqueTag();
    const email = `guarded.${tag}@e2e.local`;
    const password = `Guarded-${tag}1`;
    await createUser({ email, password, fullName: `زائر ${tag}` });
    const emailInput = page.locator('form input[type="email"]');
    await hydrated(emailInput);
    await emailInput.fill(email);
    await page.locator('form input[type="password"]').fill(password);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL((u) => u.pathname === "/portfolio");
    await expect(page.getByRole("heading", { name: t("portfolio"), level: 1 })).toBeVisible();
  });
});
