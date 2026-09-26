// Journey 1: an investor from the public request form to a funded account.
import type { Page } from "@playwright/test";
import { test, expect, confirmDialog, hydrated, open, signIn, toast } from "./support/fixtures";
import { SEEDED, SEED_PASSWORD, cashBalance, hasRole, one, sql, uniqueTag, userIdByEmail } from "./support/db";
import { waitForMailLink } from "./support/mail";
import { money, t } from "./support/i18n";

/** The value under a KPI label on /portfolio. */
function kpiValue(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("xpath=following-sibling::div[1]");
}

function banner(page: Page) {
  return page.getByRole("region", { name: t("r_bannerRegion") });
}

test("investor onboarding: request -> approval -> invite link -> activation -> deposit", async ({ page, newActor }) => {
  const tag = uniqueTag();
  const email = `investor.${tag}@e2e.local`;
  const fullName = `مستثمر تجريبي ${tag}`;
  const password = `Invest-${tag}9`;
  const depositAmount = 25_000;
  const visitor = page;

  let reference = "";
  await test.step("a visitor asks to invest on /request-access", async () => {
    await open(visitor, "/request-access");
    const investRadio = visitor.getByRole("radio", { name: new RegExp(t("r_raKindInvest")) });
    await hydrated(investRadio);
    await investRadio.click();
    await expect(investRadio).toHaveAttribute("aria-checked", "true");
    await expect(visitor.getByText(t("r_raInvestNote"))).toBeVisible();

    await visitor.getByLabel(t("fullName")).fill(fullName);
    await visitor.getByLabel(t("email")).fill(email);
    const submit = visitor.getByRole("button", { name: t("submitRequest") });
    await expect(submit).toBeEnabled();
    await submit.click();

    const done = visitor.getByRole("status").filter({ hasText: t("r_raSubmittedTitle") });
    await expect(done).toBeVisible();
    await expect(done).toContainText(t("r_raNextInvest"));
    reference = (await done.getByRole("button", { name: t("r_raCopyReference") }).innerText()).trim();
    expect(reference).toMatch(/^VU-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const row = await one<{ status: string; join_method: string; full_name: string; reference_code: string }>(
      "SELECT status, join_method, full_name, reference_code FROM public.access_requests WHERE email = $1",
      [email],
    );
    expect(row).toEqual({ status: "pending", join_method: "investor", full_name: fullName, reference_code: reference });
  });

  const admin = await newActor();
  await test.step("the admin approves the investor request on /access-requests", async () => {
    await signIn(admin, SEEDED.admin.email, SEED_PASSWORD);
    await open(admin, "/access-requests");
    await expect(admin.getByRole("heading", { name: t("accessRequestsQueue"), level: 1 })).toBeVisible();

    const approveButton = admin.getByRole("button", { name: t("approve"), exact: true });
    const card = admin
      .locator("div")
      .filter({ has: admin.getByText(email, { exact: true }) })
      .filter({ has: approveButton })
      .last();
    await expect(card).toContainText(fullName);
    await expect(card).toContainText(t("r_methodInvestor"));
    await card.getByRole("button", { name: t("approve"), exact: true }).click();

    const dialog = confirmDialog(admin);
    await expect(dialog.getByRole("heading", { name: t("r_arApproveInvestorTitle") })).toBeVisible();
    await expect(dialog).toContainText(email);
    await dialog.getByRole("button", { name: t("approve"), exact: true }).click();
    await expect(toast(admin, t("r_arApprovedInvestorSent"))).toBeVisible();

    const req = await one<{ status: string; reviewed_by: string }>(
      "SELECT status, reviewed_by FROM public.access_requests WHERE email = $1",
      [email],
    );
    expect(req).toEqual({ status: "approved", reviewed_by: SEEDED.admin.id });
    // The platform invitation created the (unconfirmed) account.
    const user = await one<{ invited: boolean; confirmed: boolean }>(
      "SELECT invited_at IS NOT NULL AS invited, email_confirmed_at IS NOT NULL AS confirmed FROM auth.users WHERE email = $1",
      [email],
    );
    expect(user).toEqual({ invited: true, confirmed: false });
  });

  await test.step("the invitation link lets the investor choose a password and signs them in", async () => {
    const link = await waitForMailLink(email, "invite");
    expect(link).toContain("type=invite");
    await visitor.goto(link);
    await visitor.waitForURL((u) => u.pathname === "/auth/update-password");
    expect(new URL(visitor.url()).searchParams.get("flow")).toBe("invite");
    await expect(visitor.getByRole("heading", { name: t("r_pwCreateTitle"), level: 1 })).toBeVisible();
    await expect(visitor.getByText(email)).toBeVisible();

    const pw = visitor.getByLabel(t("newPassword"), { exact: true });
    await hydrated(pw);
    await pw.fill(password);
    await visitor.getByLabel(t("confirmPassword"), { exact: true }).fill(password);
    await visitor.getByRole("button", { name: t("r_pwCreateCta") }).click();
    await expect(visitor.getByRole("status").filter({ hasText: t("r_pwUpdatedOthersSignedOut") })).toBeVisible();
    await visitor.getByRole("button", { name: t("r_continue") }).click();
    await visitor.waitForURL((u) => u.pathname === "/");

    // Signed in, not activated yet.
    await open(visitor, "/portfolio");
    await expect(visitor).toHaveURL(/\/portfolio/);
    await expect(banner(visitor)).toContainText(t("r_bannerAwaitingActivation"));
    const confirmed = await one<{ confirmed: boolean }>(
      "SELECT email_confirmed_at IS NOT NULL AS confirmed FROM auth.users WHERE email = $1",
      [email],
    );
    expect(confirmed.confirmed).toBe(true);
  });

  const userId = (await userIdByEmail(email))!;
  expect(userId).toBeTruthy();

  await test.step("the admin activates trading from the pending-activation queue", async () => {
    await open(admin, "/admin/investors");
    const queue = admin.locator("section").filter({ has: admin.getByRole("heading", { name: t("r_invPendingTitle") }) });
    const row = queue.getByRole("row").filter({ hasText: email });
    await expect(row).toBeVisible();
    await expect(row).toContainText(fullName);
    await expect(row).toContainText(t("r_invSourceInvestorRequest"));
    await row.getByRole("button", { name: t("activateTrading") }).click();

    const dialog = confirmDialog(admin);
    await expect(dialog.getByRole("heading", { name: t("activateTrading") })).toBeVisible();
    await expect(dialog).toContainText(email);
    await dialog.getByRole("button", { name: t("activateTrading") }).click();
    await expect(toast(admin, t("r_invActivatedFund"))).toBeVisible();
    await expect(queue.getByRole("row").filter({ hasText: email })).toHaveCount(0);
    expect(await hasRole(userId, "trader")).toBe(true);
  });

  await test.step("the investor sees that trading is on but the account has no funds yet", async () => {
    await visitor.reload();
    await expect(banner(visitor)).toContainText(t("r_bannerAwaitingFunding"));
    await expect(banner(visitor)).not.toContainText(t("r_bannerAwaitingActivation"));
    await expect(kpiValue(visitor, t("m_buyingPower"))).toHaveText(money(0));
  });

  await test.step("the admin records a deposit", async () => {
    // Activation opened the investor's panel.
    await expect(admin.getByText(t("tradingActive"), { exact: true })).toBeVisible();
    await admin.getByLabel(t("amount"), { exact: true }).fill(String(depositAmount));
    await admin.getByRole("button", { name: t("cashDeposit"), exact: true }).click();

    const dialog = confirmDialog(admin);
    await expect(dialog.getByRole("heading", { name: t("confirmDepositTitle") })).toBeVisible();
    await expect(dialog).toContainText(email);
    await expect(dialog).toContainText(money(depositAmount));
    await dialog.getByRole("button", { name: t("cashDeposit"), exact: true }).click();
    await expect(toast(admin, t("cashPosted", { balance: money(depositAmount) }))).toBeVisible();

    expect(await cashBalance(userId)).toBe(depositAmount);
    const ledger = await sql<{ kind: string; amount: string }>(
      "SELECT kind, amount FROM public.cash_ledger WHERE user_id = $1 ORDER BY created_at",
      [userId],
    );
    expect(ledger.map((l) => [l.kind, Number(l.amount)])).toEqual([["deposit", depositAmount]]);
  });

  await test.step("the investor's banner clears and the buying power shows the deposit", async () => {
    await visitor.reload();
    await expect(kpiValue(visitor, t("m_buyingPower"))).toHaveText(money(depositAmount));
    await expect(visitor.getByText(t("r_bannerAwaitingFunding"))).toHaveCount(0);
    await expect(visitor.getByText(t("r_bannerAwaitingActivation"))).toHaveCount(0);
  });
});
