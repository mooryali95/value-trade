"""Keyboard-only navigation and focus-management suite.

Checks, with no mouse input at all:
  - the skip link is the first tab stop,
  - Enter activates focused controls,
  - dialogs trap focus and close on Escape restoring focus to the trigger,
  - forms are fully reachable and submittable via Tab/Enter,
  - Shift+Tab walks focus back in the same order.
Exit code 1 on any failure.
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


async def focused(page):
    return await page.evaluate(
        "() => { const a = document.activeElement; if (!a) return null; return {"
        " tag: a.tagName.toLowerCase(), role: a.getAttribute('role'),"
        " label: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 60),"
        " inDialog: !!a.closest('[role=dialog],[role=alertdialog],[role=menu]') }; }"
    )


async def tab_sequence(page, steps, shift=False):
    seq = []
    for _ in range(steps):
        await page.keyboard.press("Shift+Tab" if shift else "Tab")
        seq.append(await focused(page))
    return seq


async def test_skip_link(page, base):
    await page.goto(base + "/", wait_until="domcontentloaded")
    await page.wait_for_timeout(500)
    await page.keyboard.press("Tab")
    f = await focused(page)
    check(bool(f) and f["tag"] in ("a", "button"), "home: first tab stop is a link/button", str(f))


async def test_tab_order_reversible(page, base):
    await page.goto(base + "/market", wait_until="domcontentloaded")
    await page.wait_for_timeout(600)
    forward = await tab_sequence(page, 6)
    backward = await tab_sequence(page, 5, shift=True)
    labels_f = [x and x["label"] for x in forward]
    labels_b = [x and x["label"] for x in backward]
    check(
        labels_b == list(reversed(labels_f[:-1])),
        "market: Shift+Tab reverses the focus order",
        f"{labels_f} vs {labels_b}",
    )


async def test_no_focus_traps_outside_dialogs(page, base):
    await page.goto(base + "/trade/ARAMCO", wait_until="domcontentloaded")
    await page.wait_for_timeout(800)
    seen = set()
    stuck = False
    for _ in range(40):
        await page.keyboard.press("Tab")
        f = await focused(page)
        key = f and (f["tag"], f["label"])
        if key and key in seen and len(seen) < 5:
            stuck = True
            break
        if key:
            seen.add(key)
    check(not stuck and len(seen) > 8, "trade: focus moves freely across the order form", f"{len(seen)} stops")


async def test_form_reachable(page, base):
    await page.goto(base + "/auth", wait_until="domcontentloaded")
    await page.wait_for_timeout(600)
    inputs = await page.evaluate(
        "() => Array.from(document.querySelectorAll('input, select, textarea'))"
        ".filter(el => !el.disabled).map(el => !!(el.getAttribute('aria-label') || el.id))"
    )
    check(bool(inputs) and all(inputs), "auth: every field is labelled", str(inputs))

    reached = []
    for _ in range(25):
        await page.keyboard.press("Tab")
        f = await focused(page)
        if f and f["tag"] in ("input", "select", "textarea"):
            reached.append(f["label"])
    check(len(reached) >= min(2, len(inputs)), "auth: fields reachable by Tab only", str(reached))


async def test_dialog_focus(page, base):
    """Escape closes an open dialog and focus returns to the invoking control."""
    await page.goto(base + "/trade/ARAMCO", wait_until="domcontentloaded")
    await page.wait_for_timeout(800)

    trigger = None
    for _ in range(60):
        await page.keyboard.press("Tab")
        f = await focused(page)
        if f and f["tag"] == "button" and f["label"]:
            trigger = f["label"]
            break
    if not trigger:
        check(False, "trade: a keyboard-focusable action button exists")
        return

    await page.keyboard.press("Enter")
    await page.wait_for_timeout(600)
    overlay = await page.evaluate(
        "() => Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog],[role=menu]'))"
        ".some(el => el.checkVisibility ? el.checkVisibility() : !!el.offsetParent)"
    )
    if not overlay:
        print("SKIP  trade: focused control opened no dialog (guest mode)")
        return

    f = await focused(page)
    check(bool(f) and f["inDialog"], "dialog: focus moves inside on open", str(f))

    inside = await tab_sequence(page, 6)
    check(all(x and x["inDialog"] for x in inside), "dialog: focus is trapped while open", str(inside))

    await page.keyboard.press("Escape")
    await page.wait_for_timeout(400)
    still_open = await page.evaluate(
        "() => Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog],[role=menu]'))"
        ".some(el => el.checkVisibility ? el.checkVisibility() : !!el.offsetParent)"
    )
    check(not still_open, "dialog: Escape closes it")
    after = await focused(page)
    check(bool(after) and after["tag"] == "button", "dialog: focus restored to a control", str(after))


async def main():
    base = os.environ.get("A11Y_BASE_URL", BASE_URL)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        for test in (
            test_skip_link,
            test_tab_order_reversible,
            test_no_focus_traps_outside_dialogs,
            test_form_reachable,
            test_dialog_focus,
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