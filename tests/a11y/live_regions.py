"""aria-live announcement suite.

Verifies that:
  - the order summary region is polite + atomic and updates when inputs change,
  - submit success and failure are announced assertively,
  - table result count / sort / filter changes are announced politely,
  - no live region contains focusable content.
Exit 1 on any failure.
"""

import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

sys.path.insert(0, str(Path(__file__).parent))
from pages import BASE_URL  # noqa: E402

FAILURES: list[str] = []


def check(ok: bool, label: str, detail: str = ""):
    print(("PASS  " if ok else "FAIL  ") + label + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(label)


async def live_texts(page, assertive=None):
    sel = "[aria-live]"
    return await page.evaluate(
        """(assertive) => Array.from(document.querySelectorAll('[aria-live]'))
            .filter(el => assertive === null || (el.getAttribute('aria-live') === 'assertive') === assertive)
            .map(el => ({ live: el.getAttribute('aria-live'), atomic: el.getAttribute('aria-atomic'),
                          text: (el.textContent || '').trim(),
                          focusables: el.querySelectorAll('a,button,input,select,textarea,[tabindex]').length }))""",
        assertive,
    )


async def test_no_focusables_in_live_regions(page, base):
    await page.goto(base + "/docs/a11y", wait_until="domcontentloaded")
    await page.wait_for_timeout(700)
    regions = await live_texts(page)
    check(len(regions) >= 3, "docs: live regions are mounted", str(len(regions)))
    check(all(r["focusables"] == 0 for r in regions), "docs: no focusable content inside live regions", str(regions))
    check(all(r["atomic"] == "true" for r in regions), "docs: every live region is atomic", str(regions))


async def test_order_summary_announces(page, base):
    await page.goto(base + "/docs/a11y", wait_until="domcontentloaded")
    await page.wait_for_timeout(700)
    summary = page.get_by_test_id("order-summary")
    before = (await summary.inner_text()).strip()
    live = await summary.get_attribute("aria-live")
    check(live == "polite", "order summary: aria-live=polite", str(live))
    qty = page.locator("#demo-qty")
    await qty.fill("25")
    await page.wait_for_timeout(300)
    after = (await summary.inner_text()).strip()
    check(before != after, "order summary: recalculation is announced", f"{before!r} -> {after!r}")


async def test_submit_outcomes(page, base):
    await page.goto(base + "/docs/a11y", wait_until="domcontentloaded")
    await page.wait_for_timeout(700)
    await page.locator("#demo-qty").fill("5")
    await page.get_by_role("button", name="Submit order").click()
    await page.wait_for_timeout(300)
    assertive = await live_texts(page, True)
    check(any("accepted" in r["text"] for r in assertive), "submit success announced assertively", str(assertive))

    await page.locator("#demo-qty").fill("0")
    await page.get_by_role("button", name="Submit order").click()
    await page.wait_for_timeout(300)
    assertive = await live_texts(page, True)
    check(any("rejected" in r["text"] for r in assertive), "submit failure announced assertively", str(assertive))


async def test_table_filter_and_sort_announced(page, base):
    await page.goto(base + "/docs/a11y", wait_until="domcontentloaded")
    await page.wait_for_timeout(700)

    async def status_text():
        return await page.evaluate(
            """() => Array.from(document.querySelectorAll('[aria-live=polite]'))
                 .map(el => (el.textContent || '').trim()).filter(t => t.includes('results')).join(' | ')"""
        )

    initial = await status_text()
    check("results" in initial, "table: result count announced on load", initial)

    await page.get_by_test_id("table-filter").fill("AL")
    await page.wait_for_timeout(700)
    filtered = await status_text()
    check(filtered != initial, "table: filter change updates the announcement", f"{initial!r} -> {filtered!r}")

    await page.get_by_role("button", name="Price").click()
    await page.wait_for_timeout(700)
    sorted_text = await status_text()
    check("Price" in sorted_text, "table: sort change is announced with the column", sorted_text)
    check(
        "ascending" in sorted_text or "descending" in sorted_text,
        "table: sort direction announced textually",
        sorted_text,
    )

    await page.get_by_test_id("table-filter").fill("zzzzz")
    await page.wait_for_timeout(700)
    empty_cta = await page.get_by_role("button", name="Clear filters").count()
    check(empty_cta == 1, "table: empty result offers a clear-filters CTA")


async def main():
    base = os.environ.get("A11Y_BASE_URL", BASE_URL)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        for test in (
            test_no_focusables_in_live_regions,
            test_order_summary_announces,
            test_submit_outcomes,
            test_table_filter_and_sort_announced,
        ):
            try:
                await test(page, base)
            except Exception as exc:  # noqa: BLE001
                check(False, f"{test.__name__} raised", repr(exc))
        await browser.close()
    print(f"\n{len(FAILURES)} failure(s)")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
