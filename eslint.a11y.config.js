/**
 * Accessibility-only ESLint gate used by CI (`bun run lint:a11y`).
 *
 * It reuses the accessibility rules from the main config but drops formatting
 * and type-hygiene rules, so a PR is blocked *only* when it introduces a real
 * accessibility regression (missing aria-label, keyboard-less click handler,
 * aria-live misuse, non-token colours, h-screen instead of dvh, ...).
 */
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import base from "./eslint.config.js";

const main = base.find((c) => c.rules && c.rules["no-restricted-syntax"]);
const a11yRules = Object.fromEntries(
  Object.entries(main.rules).filter(
    ([rule]) => rule.startsWith("jsx-a11y/") || rule === "no-restricted-syntax",
  ),
);

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", "src/routeTree.gen.ts"] },
  {
    extends: [js.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser, parser: tseslint.parser },
    plugins: main.plugins,
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: { ...Object.fromEntries(Object.keys(js.configs.recommended.rules).map((r) => [r, "off"])), ...a11yRules },
  },
);
