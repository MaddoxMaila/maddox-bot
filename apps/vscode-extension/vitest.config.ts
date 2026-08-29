import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // extension.ts and config.ts touch the real `vscode` module (only resolvable inside a
      // running VS Code instance); webview/main.ts touches the DOM inside the webview sandbox.
      // Neither is reachable from Vitest's plain Node environment — verified manually in the
      // Extension Development Host instead (see this package's README).
      exclude: ["src/**/*.test.ts", "src/extension.ts", "src/config.ts", "src/webview/main.ts"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
