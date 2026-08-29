import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // tests/fixtures/** represents independent external target repos the sandbox operates on
    // (e.g. sample-repo) — not code this repo's own standards govern.
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/*.d.ts",
      "tests/fixtures/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain build/config scripts (not type-checked TS, where @types/node's ambient globals cover
    // this) — apps/vscode-extension's esbuild.mjs is the first of these in the repo.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
);
