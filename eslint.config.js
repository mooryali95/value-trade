import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // --- Accessibility gate (blocking) -----------------------------------
      ...jsxA11y.flatConfigs.recommended.rules,
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/anchor-is-valid": ["error", { aspects: ["noHref", "invalidHref"] }],
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/autocomplete-valid": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/control-has-associated-label": [
        "error",
        {
          labelAttributes: ["aria-label", "aria-labelledby", "title", "alt", "placeholder"],
          controlComponents: ["Button", "IconButton"],
          depth: 4,
        },
      ],
      "jsx-a11y/heading-has-content": "error",
      "jsx-a11y/interactive-supports-focus": "error",
      "jsx-a11y/label-has-associated-control": ["error", { assert: "either", depth: 4 }],
      "jsx-a11y/no-autofocus": ["error", { ignoreNonDOM: true }],
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/no-noninteractive-tabindex": "error",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "jsx-a11y/tabindex-no-positive": "error",
      "no-restricted-syntax": [
        "error",
        {
          // aria-live must be paired with aria-atomic so partial text is not read alone.
          selector:
            "JSXOpeningElement:has(JSXAttribute[name.name='aria-live']):not(:has(JSXAttribute[name.name='aria-atomic']))",
          message:
            "aria-live regions must set aria-atomic. Prefer <LiveRegion/> or <TableStatus/> from @/components/live-region.",
        },
        {
          // Live regions must never contain focusable content.
          selector:
            "JSXElement:has(> JSXOpeningElement > JSXAttribute[name.name='aria-live']) JSXOpeningElement[name.name=/^(button|a|input|select|textarea)$/]",
          message: "Never place focusable elements inside an aria-live region.",
        },
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)(h-screen|min-h-screen)(\\s|$)/]",
          message: "Use dvh units (h-dvh / min-h-dvh) so mobile browser chrome does not clip the layout.",
        },
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)(text|bg|border)-(gray|slate|zinc|neutral|white|black)(-\\d+)?(\\s|$)/]",
          message: "Use semantic tokens (text-ink, text-ink-soft, bg-card, border-border) — raw colours break theming and contrast.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
);
