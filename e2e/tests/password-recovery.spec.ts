// Journey 4: "forgot password" -> e-mailed link -> new password.
import { test, expect, hydrated, open, signIn } from "./support/fixtures";
import { createUser, one, uniqueTag } from "./support/db";
import { waitForMailLink } from "./support/mail";
import { t } from "./support/i18n";

test("password recovery: the e-mailed link sets a new password; the old one stops working", async ({
  page,
  newActor,
}) => {
  const tag = uniqueTag();
  const email = `recover.${tag}@e2e.local`;
  const oldPassword = `OldPass-${tag}1`;
  const newPassword = `NewPass-${tag}2`;
  const userId = await createUser({
    email,
    password: oldPassword,
    fullName: `مستخدم الاستعادة ${tag}`,
  });
  const before = await one<{ encrypted_password: string }>(
    "SELECT encrypted_password FROM auth.users WHERE id = $1",
    [userId],
  );

  // 1. /auth -> "forgot password?" -> request a link.
  await open(page, "/auth");
  await hydrated(page.getByRole("button", { name: t("forgotPassword") }));
  await page.getByRole("button", { name: t("forgotPassword") }).click();
  await expect(page.getByRole("heading", { name: t("forgotPasswordTitle") })).toBeVisible();
  await expect(page.locator('form input[type="password"]')).toHaveCount(0);
  await page.locator('form input[type="email"]').fill(email);
  await page.getByRole("button", { name: t("forgotPasswordCta") }).click();
  await expect(page.getByText(t("resetLinkSent"))).toBeVisible();

  // 2. The link from the e-mail lands on /auth/update-password, signed in by the link.
  const link = await waitForMailLink(email, "recovery");
  expect(link).toContain("type=recovery");
  await page.goto(link);
  await page.waitForURL((u) => u.pathname === "/auth/update-password");
  expect(new URL(page.url()).searchParams.get("flow")).toBe("recovery");
  await expect(page.getByRole("heading", { name: t("updatePassword"), level: 1 })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  // Opened from the mailbox: no "current password" field.
  await expect(page.getByLabel(t("r_pwCurrent"))).toHaveCount(0);

  const pw = page.getByLabel(t("newPassword"), { exact: true });
  await hydrated(pw);
  await pw.fill(newPassword);
  await page.getByLabel(t("confirmPassword"), { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: t("updatePassword") }).click();
  await expect(
    page.getByRole("status").filter({ hasText: t("r_pwUpdatedOthersSignedOut") }),
  ).toBeVisible();

  const after = await one<{ encrypted_password: string }>(
    "SELECT encrypted_password FROM auth.users WHERE id = $1",
    [userId],
  );
  expect(after.encrypted_password).not.toBe(before.encrypted_password);

  await page.getByRole("button", { name: t("r_continue") }).click();
  await page.waitForURL((u) => u.pathname === "/");

  // 3. Someone else's browser: the old password fails, the new one works.
  const other = await newActor();
  await open(other, "/auth");
  const emailInput = other.locator('form input[type="email"]');
  await hydrated(emailInput);
  await emailInput.fill(email);
  await other.locator('form input[type="password"]').fill(oldPassword);
  await other.locator('form button[type="submit"]').click();
  await expect(
    other.getByRole("alert").filter({ hasText: t("r_authInvalidCredentials") }),
  ).toBeVisible();
  await expect(other).toHaveURL(/\/auth/);

  await signIn(other, email, newPassword);
  await expect(other).not.toHaveURL(/\/auth/);

  // 4. The link is single-use: opening it again shows the expired-link state.
  const third = await newActor();
  await third.goto(link);
  await third.waitForURL((u) => u.pathname === "/auth/update-password");
  await expect(third.getByRole("alert").filter({ hasText: t("r_authLinkExpired") })).toBeVisible();
  await expect(third.getByRole("link", { name: t("r_pwRequestNewLink") })).toBeVisible();
});
