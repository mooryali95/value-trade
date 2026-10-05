"""axe-core sweep used as the CI accessibility gate.

Fails (exit 1) when any audited page reports a violation.
Writes a JSON report to tests/a11y/reports/axe.json.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

sys.path.insert(0, str(Path(__file__).parent))
from pages import BASE_URL, PUBLIC_PAGES, AUTHED_PAGES, launch_options  # noqa: E402
from session import restore_session  # noqa: E402

AXE_CDN = "https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js"
REPORTS = Path(__file__).parent / "reports"


async def audit(page, name, path, base_url, results, scope="document"):
    await page.goto(base_url + path, wait_until="domcontentloaded")
    await page.wait_for_timeout(700)
    if scope != "document":
        # Client-rendered after hydration; wait for it rather than guess.
        await page.wait_for_selector(scope, timeout=15000)
    local_axe = os.environ.get("A11Y_AXE_SCRIPT")
    if local_axe:
        # For sandboxes where the browser cannot reach the CDN directly.
        await page.add_script_tag(path=local_axe)
    else:
        await page.add_script_tag(url=AXE_CDN)
    raw = await page.evaluate(
        "async (scope) => { const ctx = scope === 'document' ? document : { include: [[scope]] }; "
        "const r = await window.axe.run(ctx, "
        "{ runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] } }); "
        "return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, "
        "nodes: v.nodes.slice(0,3).map(n => n.target.join(' ')) })); }",
        scope,
    )
    results[name] = {"path": path, "violations": raw}
    status = "OK" if not raw else f"{len(raw)} violation(s)"
    print(f"[{status}] {name} {path}")
    for v in raw:
        print(f"    - {v['id']} ({v['impact']}): {v['help']} :: {v['nodes']}")


async def main():
    base_url = os.environ.get("A11Y_BASE_URL", BASE_URL)
    REPORTS.mkdir(parents=True, exist_ok=True)
    results = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(**launch_options())
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        authed = await restore_session(context, page, base_url)

        # The fixed cookie notice sits over whatever is at the bottom of the
        # viewport until dismissed, so axe reports those links as obscured
        # depending on page height and fonts. Audit the notice on its own once,
        # then dismiss it so every page is audited on its own content.
        await audit(page, "cookie-notice", "/", base_url, results, scope='[role="region"].fixed.bottom-0')
        await page.evaluate("() => localStorage.setItem('cookie-notice:v1', 'dismissed')")

        for name, path in PUBLIC_PAGES:
            await audit(page, name, path, base_url, results)

        if authed:
            for name, path in AUTHED_PAGES:
                await audit(page, name, path, base_url, results)
        else:
            print("! No Supabase session available — authenticated routes skipped.")

        await browser.close()

    (REPORTS / "axe.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    total = sum(len(r["violations"]) for r in results.values())
    print(f"\nTotal violations: {total} across {len(results)} page(s)")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))