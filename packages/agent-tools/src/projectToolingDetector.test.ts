import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProjectCommand } from "./projectToolingDetector.js";

describe("detectProjectCommand", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "maddox-bot-tooling-detector-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when there is no package.json at all", async () => {
    expect(await detectProjectCommand(dir, "test")).toBeNull();
  });

  it("returns null when the script isn't configured", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
    expect(await detectProjectCommand(dir, "test")).toBeNull();
  });

  it("defaults to npm when there is no lockfile", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    expect(await detectProjectCommand(dir, "test")).toEqual({
      packageManager: "npm",
      script: "test",
    });
  });

  it("detects pnpm from pnpm-lock.yaml", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    expect(await detectProjectCommand(dir, "test")).toEqual({
      packageManager: "pnpm",
      script: "test",
    });
  });

  it("detects yarn from yarn.lock", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { lint: "eslint ." } }));
    await writeFile(join(dir, "yarn.lock"), "");
    expect(await detectProjectCommand(dir, "lint")).toEqual({
      packageManager: "yarn",
      script: "lint",
    });
  });

  it("returns null for malformed package.json rather than throwing", async () => {
    await writeFile(join(dir, "package.json"), "{ not valid json");
    expect(await detectProjectCommand(dir, "test")).toBeNull();
  });
});
