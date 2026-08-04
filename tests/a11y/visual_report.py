"""Before/after visual report across desktop, tablet and mobile.

Usage:
  python3 tests/a11y/visual_report.py before
  python3 tests/a11y/visual_report.py after      # also writes report.md diff table
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

sys.path.insert(0, str(Path(__file__).parent))
from pages import BASE_URL, PUBLIC_PAGES, AUTHED_PAGES, VIEWPORTS  # noqa: E402
from session import restore_session  # noqa: E402

ROOT = Path(__file__).parent / "reports"


async def main():
    phase = (sys.argv[1] if len(sys.argv) > 1 else "after").lower()
    base = os.environ.get("A11Y_BASE_URL", BASE_URL)
    out = ROOT / phase
    out.mkdir(parents=True, exist_ok=True)
    index = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for device, vp in VIEWPORTS.items():
            context = await browser.new_context(viewport=vp)
            page = await context.new_page()
            authed = await restore_session(context, page, base)
            targets = list(PUBLIC_PAGES) + (list(AUTHED_PAGES) if authed else [])
            for name, path in targets:
                try:
                    await page.goto(base + path, wait_until="domcontentloaded")
                    await page.wait_for_timeout(700)
                    shot = out / f"{device}-{name}.png"
                    await page.screenshot(path=str(shot))
                    index.setdefault(name, {})[device] = shot.name
                    print(f"captured {device}/{name}")
                except Exception as exc:  # noqa: BLE001
                    print(f"skipped {device}/{name}: {exc!r}")
            await context.close()
        await browser.close()

    (out / "index.json").write_text(json.dumps(index, indent=2))

    if phase == "after" and (ROOT / "before" / "index.json").exists():
        lines = ["# Accessibility visual report — before / after", ""]
        for device in VIEWPORTS:
            lines += [f"## {device}", "", "| page | before | after |", "| --- | --- | --- |"]
            for name in sorted(index):
                shot = f"{device}-{name}.png"
                lines.append(f"| {name} | ![](before/{shot}) | ![](after/{shot}) |")
            lines.append("")
        (ROOT / "report.md").write_text("\n".join(lines))
        print(f"wrote {ROOT / 'report.md'}")


if __name__ == "__main__":
    asyncio.run(main())