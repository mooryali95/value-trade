"""Shared route inventory for the accessibility tooling."""

BASE_URL = "http://localhost:8080"

# name, path, note
PUBLIC_PAGES = [
    ("home", "/"),
    ("market", "/market"),
    ("market-empty", "/market?q=zzzzzzzz"),
    ("market-detail", "/market/aramco"),
    ("trade", "/trade/ARAMCO"),
    ("shariah", "/shariah"),
    ("auth", "/auth"),
    ("request-access", "/request-access"),
    ("legal-terms", "/legal/terms"),
    ("legal-privacy", "/legal/privacy"),
    ("legal-cookies", "/legal/cookies"),
    ("legal-shariah", "/legal/shariah-disclosures"),
    ("unsubscribe", "/unsubscribe"),
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