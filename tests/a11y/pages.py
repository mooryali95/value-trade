"""Shared route inventory for the accessibility tooling.

Every audited URL must exist on a fresh launch database: no listed
instruments, no trades. Instrument pages are audited through their
"not listed" state, which is what any unknown symbol or slug renders.
"""

import os

BASE_URL = "http://localhost:8080"

# name, path
PUBLIC_PAGES = [
    ("home", "/"),
    ("market", "/market"),
    ("market-empty", "/market?q=zzzzzzzz"),
    ("market-detail-missing", "/market/a11y-unlisted-instrument"),
    ("trade-missing", "/trade/A11YNONE"),
    ("shariah", "/shariah"),
    ("auth", "/auth"),
    ("request-access", "/request-access"),
    ("legal-terms", "/legal/terms"),
    ("legal-privacy", "/legal/privacy"),
    ("legal-cookies", "/legal/cookies"),
    ("legal-risk", "/legal/risk"),
    ("legal-shariah", "/legal/shariah-disclosures"),
    ("unsubscribe", "/unsubscribe"),
    ("a11y-docs", "/docs/a11y"),
    ("ui-states", "/docs/states"),
    ("not-found", "/this-route-does-not-exist"),
]

AUTHED_PAGES = [
    ("portfolio", "/portfolio"),
    ("portfolio-empty", "/portfolio?tab=orders&q=zzzzzzzz"),
    ("workspace", "/workspace"),
    ("shariah-review", "/shariah/review"),
    ("company-submissions", "/company/submissions"),
    ("company-submit", "/company/submit"),
    ("company-settings", "/company/settings"),
    ("settings-notifications", "/settings/notifications"),
    ("admin-email-log", "/admin/email-log"),
]

VIEWPORTS = {
    "desktop": {"width": 1440, "height": 1400},
    "tablet": {"width": 834, "height": 1112},
    "mobile": {"width": 390, "height": 844},
}


def launch_options() -> dict:
    """Chromium launch options.

    CI installs the browser build that matches the Python package. Locally,
    A11Y_CHROMIUM_EXECUTABLE can point at an already installed Chromium
    (for example /opt/pw-browsers/chromium-1194/chrome-linux/chrome).
    """
    opts: dict = {"headless": True}
    exe = os.environ.get("A11Y_CHROMIUM_EXECUTABLE")
    if exe:
        opts["executable_path"] = exe
    return opts
