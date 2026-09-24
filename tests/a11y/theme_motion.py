"""High-contrast theme + reduced-motion CI gate.

For each of tablet/mobile viewports and each of the
(default, prefers-contrast: more, prefers-reduced-motion: reduce, forced-colors) modes:

  - focus management stays stable (focus ring visible, focus moves on Tab),
  - empty states and error states keep readable, non-colour-only messaging,
  - animations are effectively disabled under reduced motion.

Exit 1 on any failure. Screenshots go to tests/a11y/reports/theme-motion/.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

sys.path.insert(0, str(Path(__file__).parent))
from pages import BASE_URL, VIEWPORTS, launch_options  # noqa: E402

REPORTS = Path(__file__).parent / "reports" / "theme-motion"
FAILURES: list[str] = []

# name -> (color_scheme kwargs, media kwargs)
MODES = {
    "default": {},
    "reduced-motion": {"reduced_motion": "reduce"},
    "high-contrast": {"contrast": "more"},
    "forced-colors": {"forced_colors": "active"},
}

TARGETS = [
    ("a11y-docs", "/docs/a11y"),
    ("ui-states", "/docs/states"),
    ("market-empty", "/market?q=zzzzzzzz"),
    ("not-found", "/this-route-does-not-exist"),
]

DEVICES = ["desktop", "tablet", "mobile"]

# Retries guard against first-paint/hydration flakiness in dev mode.
ATTEMPTS = 3


def check(ok: bool, label: str, detail: str = ""):
    print(("PASS  " if ok else "FAIL  ") + label + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(label)


async def retry(fn, attempts: int = ATTEMPTS):
    """Run an async predicate until it returns a truthy value."""
    value = None
    for i in range(attempts):
        value = await fn()
        if value:
            return value
        await asyncio.sleep(0.6)
    return value


async def focus_snapshot(page):
    return await page.evaluate(
        """() => {
            const a = document.activeElement;
            if (!a || a === document.body) return null;
            const cs = getComputedStyle(a);
            const r = a.getBoundingClientRect();
            return {
              tag: a.tagName.toLowerCase(),
              label: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 50),
              outlineWidth: parseFloat(cs.outlineWidth) || 0,
              boxShadow: cs.boxShadow !== 'none',
              w: Math.round(r.width), h: Math.round(r.height),
            };
        }"""
    )


async def run_mode(browser, device, mode, results):
    ctx_args = {"viewport": VIEWPORTS[device], **MODES[mode]}
    context = await browser.new_context(**ctx_args)
    page = await context.new_page()
    base = os.environ.get("A11Y_BASE_URL", BASE_URL)

    for name, path in TARGETS:
        tag = f"{device}/{mode}/{name}"
        await page.goto(base + path, wait_until="domcontentloaded")
        # Wait for hydration: the app shell always renders a <main> landmark.
        try:
            await page.wait_for_selector("main", state="attached", timeout=10_000)
        except Exception:
            pass
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(400)

        # --- focus management -------------------------------------------------
        async def tab_pair():
            await page.evaluate("() => document.activeElement && document.activeElement.blur()")
            await page.keyboard.press("Tab")
            a = await focus_snapshot(page)
            await page.keyboard.press("Tab")
            b = await focus_snapshot(page)
            return (a, b) if a and b else None

        pair = await retry(tab_pair)
        first, second = pair if pair else (None, None)
        check(bool(first) and bool(second), f"{tag}: Tab moves focus", f"{first} -> {second}")
        if first and second:
            check(first["label"] != second["label"] or first["tag"] != second["tag"],
                  f"{tag}: focus advances between stops", f"{first} == {second}")
            visible = first["outlineWidth"] >= 1 or first["boxShadow"]
            check(visible, f"{tag}: focus indicator is visible", json.dumps(first))

        # --- empty / error copy ----------------------------------------------
        async def main_text():
            if await page.locator("main").count():
                return (await page.inner_text("main")).strip()
            return ""

        text = (await retry(main_text)) or ""
        if "empty" in name or "not-found" in name or "states" in name:
            async def cta_count():
                return await page.locator("main a, main button").count()

            has_cta = (await retry(cta_count)) or 0
            check(has_cta > 0, f"{tag}: empty/error state offers an action")
            check(len(text.strip()) > 30, f"{tag}: empty/error state explains the situation in text")

        # --- visual regression snapshots of each state block ------------------
        if name == "ui-states":
            out_states = REPORTS / device / mode / "states"
            out_states.mkdir(parents=True, exist_ok=True)
            for case in ["empty-basic", "empty-filtered", "error-load", "loading"]:
                el = page.locator(f"[data-state-case='{case}']")
                if await el.count():
                    await el.first.scroll_into_view_if_needed()
                    await el.first.screenshot(path=str(out_states / f"{case}.png"))
                    box = await el.first.bounding_box()
                    check(bool(box) and box["height"] > 40,
                          f"{tag}: {case} block renders with real height", json.dumps(box))

        # --- reduced motion ---------------------------------------------------
        if mode == "reduced-motion":
            longest = await page.evaluate(
                """() => Array.from(document.querySelectorAll('*')).reduce((max, el) => {
                    const cs = getComputedStyle(el);
                    const vals = (cs.transitionDuration + ',' + cs.animationDuration)
                      .split(',').map(v => parseFloat(v) * (v.includes('ms') ? 1 : 1000) || 0);
                    return Math.max(max, ...vals);
                }, 0)"""
            )
            check(longest <= 50, f"{tag}: animations/transitions effectively disabled", f"{longest}ms")

        results.setdefault(device, {}).setdefault(mode, {})[name] = {
            "textLength": len(text), "firstFocus": first,
        }
        out = REPORTS / device / mode
        out.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(out / f"{name}.png"))

    await context.close()


async def main():
    REPORTS.mkdir(parents=True, exist_ok=True)
    results: dict = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(**launch_options())
        for device in DEVICES:
            for mode in MODES:
                await run_mode(browser, device, mode, results)
        await browser.close()
    (REPORTS / "index.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\n{len(FAILURES)} failure(s)")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
