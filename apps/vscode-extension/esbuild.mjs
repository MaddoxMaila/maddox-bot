import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.cjs",
  format: "cjs",
  platform: "node",
  target: "node20",
  // The extension host resolves "vscode" to its own runtime module — it doesn't exist on disk,
  // so it must never be bundled, only left as an external require().
  external: ["vscode"],
  sourcemap: true,
};

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
};

if (watch) {
  const contexts = await Promise.all(
    [extensionConfig, webviewConfig].map((config) => esbuild.context(config)),
  );
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("esbuild watching for changes...");
} else {
  await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
}
