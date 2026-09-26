// Journey 3: a company's brand unit from submission to the public market.
import { test, expect, hydrated, open, signIn, toast } from "./support/fixtures";
import { SAMPLE_COMPANY_A, SEEDED, SEED_PASSWORD, one, positionQty, sql, uniqueTag } from "./support/db";
import { money, t } from "./support/i18n";

test("listing lifecycle: submission -> Shariah approval -> listing with first units -> on the market", async ({
  page,
  newActor,
}) => {
  const tag = uniqueTag();
  const symbol = `L${tag.slice(-6).toUpperCase()}`;
  const slug = symbol.toLowerCase();
  const nameAr = `علامة إدراج تجريبية ${tag}`;
  const nameEn = `E2E Listing Brand ${tag}`;
  const reason = `ملاحظة شرعية تجريبية ${tag}: النشاط مباح ولا توجد إيرادات محرّمة.`;
  const referencePrice = 12.5;
  const units = 10_000;

  const owner = page;
  await test.step("the company owner submits a brand unit on /company/submit", async () => {
    await signIn(owner, SEEDED.owner.email, SEED_PASSWORD);
    await open(owner, `/company/submit?companyId=${SAMPLE_COMPANY_A.id}`);
    await expect(owner.getByRole("heading", { name: t("submitProductForm"), level: 1 })).toBeVisible();

    const company = owner.getByLabel(t("company"));
    await hydrated(company);
    await company.selectOption(SAMPLE_COMPANY_A.id);
    await owner.getByRole("button", { name: t("wizardNext") }).click();

    await owner.getByLabel(t("brandSymbol")).fill(symbol);
    await owner.getByLabel(t("nameAr")).fill(nameAr);
    await owner.getByLabel(t("nameEn")).fill(nameEn);
    await owner.getByLabel(t("sector")).selectOption("retail");
    await owner.getByRole("button", { name: t("wizardNext") }).click();

    // Review step, then submit.
    await expect(owner.locator("dl")).toContainText(symbol);
    await expect(owner.locator("dl")).toContainText(SAMPLE_COMPANY_A.nameAr);
    await owner.getByRole("button", { name: t("submitProduct") }).click();
    await expect(toast(owner, t("submissionSubmitted"))).toBeVisible();
    await owner.waitForURL((u) => u.pathname === "/company/submissions");
    await expect(owner.getByText(symbol).first()).toBeVisible();

    const sub = await one<{ status: string; company_id: string; submitted_by: string; asset_class: string }>(
      "SELECT status, company_id, submitted_by, asset_class FROM public.product_submissions WHERE symbol = $1",
      [symbol],
    );
    expect(sub).toEqual({ status: "pending", company_id: SAMPLE_COMPANY_A.id, submitted_by: SEEDED.owner.id, asset_class: "brand" });
    expect(await sql("SELECT 1 FROM public.brands WHERE symbol = $1", [symbol])).toHaveLength(0);
  });

  const reviewer = await newActor();
  await test.step("the Shariah reviewer rules it halal with a reason", async () => {
    await signIn(reviewer, SEEDED.reviewer.email, SEED_PASSWORD);
    // Submissions are ruled on in the review queue (the instrument only
    // exists from that approval on).
    await open(reviewer, "/admin/submissions");
    const note = reviewer.getByLabel(`${t("g_reviewNoteLabel")} — ${symbol}`);
    await hydrated(note);
    await note.fill(reason);
    const row = note.locator("xpath=..");
    await row.getByRole("button", { name: t("approve"), exact: true }).click();
    await expect(toast(reviewer, t("d_approvedToast"))).toBeVisible();

    const sub = await one<{ status: string; review_reason: string; reviewer_id: string }>(
      "SELECT status, review_reason, reviewer_id FROM public.product_submissions WHERE symbol = $1",
      [symbol],
    );
    expect(sub).toEqual({ status: "approved", review_reason: reason, reviewer_id: SEEDED.reviewer.id });
    const ruling = await one<{ status: string; reason: string; reviewer_id: string }>(
      "SELECT status, reason, reviewer_id FROM public.shariah_decisions WHERE symbol = $1",
      [symbol],
    );
    expect(ruling).toEqual({ status: "halal", reason, reviewer_id: SEEDED.reviewer.id });
    const brand = await one<{ published: boolean; reference_price: string; slug: string }>(
      "SELECT published, reference_price, slug FROM public.brands WHERE symbol = $1",
      [symbol],
    );
    expect(brand).toEqual({ published: false, reference_price: "0", slug });

    // The ruling and its reason are on the Shariah review console.
    await open(reviewer, `/shariah/review?q=${symbol}`);
    await expect(reviewer.getByRole("heading", { name: t("shariahReview"), level: 1 })).toBeVisible();
    const decision = reviewer.getByText(reason, { exact: true });
    await expect(decision).toBeVisible();
    const decisionRow = decision.locator("xpath=ancestor::div[1]");
    await expect(decisionRow).toContainText(symbol);
    await expect(decisionRow).toContainText(t("e2_shariahHalal"));
  });

  const admin = await newActor();
  await test.step("the admin approves the listing with a reference price and first units", async () => {
    await signIn(admin, SEEDED.admin.email, SEED_PASSWORD);
    await open(admin, `/admin/submissions?q=${symbol}`);
    const listButton = admin.getByRole("button", { name: t("d_approveListing") });
    await hydrated(listButton);
    // The submission's stage badge (not the status filter's <option>).
    await expect(admin.locator("span").filter({ hasText: new RegExp(`^${t("d_stApproved")}$`) })).toBeVisible();
    await listButton.click();

    const dialog = admin.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: t("d_listingDialogTitle", { symbol }) })).toBeVisible();
    await dialog.getByLabel(t("referencePrice")).fill(referencePrice.toFixed(2));
    await dialog.getByLabel(t("d_holder")).selectOption(SEEDED.owner.id);
    await dialog.getByLabel(t("d_units")).fill(String(units));
    await dialog.getByRole("button", { name: t("d_approveListing") }).click();
    await expect(toast(admin, t("d_listedToast", { symbol }))).toBeVisible();
    await expect(dialog).toHaveCount(0);

    const brand = await one<{ published: boolean; reference_price: string }>(
      "SELECT published, reference_price FROM public.brands WHERE symbol = $1",
      [symbol],
    );
    expect(brand.published).toBe(true);
    expect(Number(brand.reference_price)).toBe(referencePrice);
    const sub = await one<{ status: string; listing_decided_by: string }>(
      "SELECT status, listing_decided_by FROM public.product_submissions WHERE symbol = $1",
      [symbol],
    );
    expect(sub).toEqual({ status: "listed", listing_decided_by: SEEDED.admin.id });
    const issuance = await one<{ user_id: string; qty: string; price: string }>(
      "SELECT user_id, qty, price FROM public.unit_issuances WHERE symbol = $1",
      [symbol],
    );
    expect([issuance.user_id, Number(issuance.qty), Number(issuance.price)]).toEqual([SEEDED.owner.id, units, referencePrice]);
    expect(await positionQty(SEEDED.owner.id, symbol)).toBe(units);

    // Listing published it: the admin's publication control shows it as published.
    await open(admin, "/admin/investors");
    const search = admin.getByLabel(t("e2_searchInstruments"));
    await hydrated(search);
    await search.fill(symbol);
    const row = admin.getByRole("row").filter({ hasText: symbol });
    await expect(row).toContainText(t("e2_published"));
    await expect(row).toContainText(money(referencePrice));
    await expect(row.getByRole("button", { name: t("e2_unpublish") })).toBeVisible();
  });

  await test.step("a visitor finds it on /market with its reference price", async () => {
    const visitor = await newActor();
    await open(visitor, "/market");
    const link = visitor.getByRole("link").filter({ hasText: nameAr }).filter({ visible: true });
    await expect(link).toHaveCount(1);
    await expect(link).toContainText(symbol);
    await expect(link).toContainText(money(referencePrice));
    await link.click();
    await visitor.waitForURL((u) => u.pathname === `/market/${slug}`);
    await expect(visitor.getByRole("heading", { name: nameAr, level: 1 })).toBeVisible();
    const label = visitor.getByText(t("e2_referencePriceNoTrades"), { exact: true });
    await expect(label).toBeVisible();
    await expect(visitor.getByText(money(referencePrice)).first()).toBeVisible();
  });
});
