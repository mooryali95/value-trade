// Journey 2: an activated, funded investor trades against another investor.
import type { Page } from "@playwright/test";
import { test, expect, confirmDialog, hydrated, open, signIn, toast } from "./support/fixtures";
import {
  SEEDED,
  cashBalance,
  createListedInstrument,
  createUser,
  deposit,
  issueUnits,
  one,
  placeLimitOrder,
  positionQty,
  sql,
  uniqueTag,
} from "./support/db";
import { money, qty as fmtQty, t } from "./support/i18n";

/** The <dd> next to the <dt> whose text is exactly `label`. */
function dd(page: Page, label: string) {
  return page
    .locator("dt")
    .filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) })
    .locator("xpath=following-sibling::dd[1]");
}

test("trading: a crossing limit buy fills against a resting sell; out-of-band is refused; an open order is cancelled", async ({
  page,
}) => {
  const tag = uniqueTag();
  const symbol = `T${tag.slice(-6).toUpperCase()}`;
  const slug = `e2e-trade-${tag}`;
  const reference = 20; // band: 16.00 .. 24.00
  const ask = { qty: 300, price: 21.5 };
  const buy = { qty: 200, price: 21.5 };
  const cost = buy.qty * buy.price; // 4,300.00
  const funds = 50_000;

  // Arrange (as the server would): a listed halal instrument, units for the
  // seeded investor2 and their resting sell; a fresh activated, funded buyer.
  const nameAr = `علامة تداول تجريبية ${tag}`;
  await createListedInstrument({
    symbol,
    slug,
    nameAr,
    nameEn: `E2E Trade Brand ${tag}`,
    referencePrice: reference,
  });
  const seller = SEEDED.investor2.id;
  await issueUnits(seller, symbol, 1_000, reference);
  const resting = await placeLimitOrder(seller, symbol, "sell", ask.qty, ask.price);
  expect(resting.status).toBe("open");
  const sellerCashBefore = await cashBalance(seller);

  const email = `trader.${tag}@e2e.local`;
  const password = `Trade-${tag}7`;
  const buyer = await createUser({
    email,
    password,
    fullName: `متداول تجريبي ${tag}`,
    roles: ["trader"],
  });
  await deposit(buyer, funds);

  await signIn(page, email, password);
  await open(page, `/trade/${slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(t("nav_trade"));
  const submit = page.getByRole("button", { name: `${t("buy")} ${symbol}`, exact: true });
  const price = page.getByLabel(t("price"), { exact: true });
  const quantity = page.getByLabel(t("qty"), { exact: true });
  await hydrated(price);
  await expect(page.getByText(t("m_allowedToday"))).toContainText(`${money(16)}`);
  await expect(page.getByText(t("m_allowedToday"))).toContainText(`${money(24)}`);
  await expect(dd(page, t("m_buyingPower"))).toHaveText(money(funds));

  await test.step("a limit price outside today's band is refused", async () => {
    await quantity.fill("10");
    await price.fill("30.00");
    await expect(page.getByText(t("priceOutOfBand"))).toBeVisible();
    await expect(price).toHaveAttribute("aria-invalid", "true");
    await expect(submit).toBeDisabled();
    expect(await sql("SELECT 1 FROM public.orders WHERE user_id = $1", [buyer])).toHaveLength(0);
  });

  let buyOrderId = "";
  await test.step("a limit buy that crosses the resting sell fills", async () => {
    await price.fill(buy.price.toFixed(2));
    await quantity.fill(String(buy.qty));
    await expect(page.getByText(t("priceOutOfBand"))).toHaveCount(0);
    await expect(dd(page, t("m_estCost"))).toHaveText(money(cost));
    await expect(submit).toBeEnabled();
    await submit.click();

    const dialog = confirmDialog(page);
    await expect(dialog.getByRole("heading", { name: t("confirmOrderTitle") })).toBeVisible();
    await expect(dialog).toContainText(money(cost));
    await dialog.getByRole("button", { name: t("buy"), exact: true }).click();
    await expect(toast(page, t("orderPlaced"))).toBeVisible();

    // The ticket's account box: cash reduced by exactly qty x price.
    await expect(dd(page, t("m_buyingPower"))).toHaveText(money(funds - cost));
    await expect(dd(page, t("m_cashBalance"))).toHaveText(money(funds - cost));
    await expect(dd(page, t("m_heldUnits"))).toHaveText(`${fmtQty(buy.qty)} ${symbol}`);

    // Database: one trade between the two investors, equal and opposite cash.
    const trade = await one<{
      qty: string;
      price: string;
      buy_order_id: string;
      sell_order_id: string;
      seller_id: string;
    }>(
      "SELECT qty, price, buy_order_id, sell_order_id, seller_id FROM public.trades WHERE symbol = $1 AND buyer_id = $2",
      [symbol, buyer],
    );
    expect(Number(trade.qty)).toBe(buy.qty);
    expect(Number(trade.price)).toBe(buy.price);
    expect(trade.seller_id).toBe(seller);
    expect(trade.sell_order_id).toBe(resting.orderId);
    buyOrderId = trade.buy_order_id;

    const legs = await sql<{ user_id: string; kind: string; amount: string }>(
      "SELECT user_id, kind, amount FROM public.cash_ledger WHERE ref_order_id = ANY($1::uuid[]) ORDER BY kind",
      [[trade.buy_order_id, trade.sell_order_id]],
    );
    expect(legs.map((l) => [l.user_id, l.kind, Number(l.amount)])).toEqual([
      [buyer, "order_buy", -cost],
      [seller, "order_sell", cost],
    ]);
    expect(await cashBalance(buyer)).toBe(funds - cost);
    expect(await cashBalance(seller)).toBe(sellerCashBefore + cost);
    expect(await positionQty(buyer, symbol)).toBe(buy.qty);
    expect(await positionQty(seller, symbol)).toBe(1_000 - buy.qty);
    const orders = await sql<{ id: string; status: string; filled_qty: string }>(
      "SELECT id, status, filled_qty FROM public.orders WHERE id = ANY($1::uuid[])",
      [[trade.buy_order_id, trade.sell_order_id]],
    );
    const byId = Object.fromEntries(orders.map((o) => [o.id, [o.status, Number(o.filled_qty)]]));
    expect(byId[trade.buy_order_id]).toEqual(["filled", buy.qty]);
    expect(byId[trade.sell_order_id]).toEqual(["partial", buy.qty]);
  });

  await test.step("the portfolio shows the position and the reduced buying power", async () => {
    await open(page, "/portfolio");
    await expect(
      page
        .getByText(t("m_buyingPower"), { exact: true })
        .locator("xpath=following-sibling::div[1]"),
    ).toHaveText(money(funds - cost));
    // Positions row (desktop layout): quantity, average cost and value at the last trade.
    const row = page
      .getByText(nameAr, { exact: true })
      .filter({ visible: true })
      .locator("xpath=../..");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(symbol);
    await expect(row).toContainText(fmtQty(buy.qty));
    await expect(row).toContainText(money(buy.price));
    await expect(row).toContainText(money(cost));
  });

  let openOrderId = "";
  await test.step("a resting buy below the ask is placed, then cancelled from the portfolio", async () => {
    await open(page, `/trade/${slug}`);
    await hydrated(price);
    await price.fill("19.00");
    await quantity.fill("50");
    await expect(submit).toBeEnabled();
    await submit.click();
    await confirmDialog(page)
      .getByRole("button", { name: t("buy"), exact: true })
      .click();
    await expect(toast(page, t("orderResting"))).toBeVisible();
    const open1 = await one<{ id: string; status: string }>(
      "SELECT id, status FROM public.orders WHERE user_id = $1 AND id <> $2",
      [buyer, buyOrderId],
    );
    expect(open1.status).toBe("open");
    openOrderId = open1.id;
    // The resting buy reserves 50 x 19.00 of the buying power.
    await expect(dd(page, t("m_reservedByOrders"))).toHaveText(money(950));
    await expect(dd(page, t("m_buyingPower"))).toHaveText(money(funds - cost - 950));

    await open(page, "/portfolio?tab=orders");
    await expect(page.getByRole("tab", { name: t("tabOrders") })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const cancel = page
      .getByRole("button", { name: t("cancelOrder"), exact: true })
      .filter({ visible: true });
    await expect(cancel).toHaveCount(1);
    await cancel.click();
    const dialog = confirmDialog(page);
    await expect(dialog.getByRole("heading", { name: t("cancelOrder") })).toBeVisible();
    await expect(dialog).toContainText(symbol);
    await dialog.getByRole("button", { name: t("cancelOrder"), exact: true }).click();
    await expect(toast(page, t("orderCancelled"))).toBeVisible();
    await expect(cancel).toHaveCount(0);

    const after = await one<{ status: string }>("SELECT status FROM public.orders WHERE id = $1", [
      openOrderId,
    ]);
    expect(after.status).toBe("cancelled");
    // Nothing reserved any more; cash untouched by the cancelled order.
    await expect(
      page
        .getByText(t("m_buyingPower"), { exact: true })
        .locator("xpath=following-sibling::div[1]"),
    ).toHaveText(money(funds - cost));
    expect(await cashBalance(buyer)).toBe(funds - cost);
  });
});
