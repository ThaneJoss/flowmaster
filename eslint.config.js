import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import vue from "eslint-plugin-vue";
import globals from "globals";
import ts from "typescript-eslint";

export default defineConfig([
  { ignores: ["dist/**", ".worker-build/**", ".wrangler/**", ".sites-runtime/**", "test-results/**"] },
  {
    files: ["**/*.{js,mjs,ts,vue}"],
    extends: [js.configs.recommended],
    rules: {
      // Best-effort cleanup and readiness polling deliberately ignore failures.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["**/*.ts"],
    extends: [ts.configs.recommended],
    rules: {
      // Existing generic MCP/document boundaries are validated at runtime.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    files: ["web/src/**/*.vue"],
    extends: [vue.configs["flat/essential"]],
  },
  {
    files: ["web/src/components/StepInspector.vue"],
    // The editor intentionally edits an isolated parent-owned draft object.
    rules: { "vue/no-mutating-props": ["error", { shallowOnly: true }] },
  },
  {
    files: ["web/src/**/*.{js,ts,vue}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["*.{js,mjs}", "scripts/**/*.mjs", "tests/**/*.{ts,mjs}"],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright evaluate callbacks run in the browser, alongside Node fixtures.
    files: ["tests/*-smoke.mjs", "tests/accessibility.mjs"],
    languageOptions: { globals: globals.browser },
  },
]);
