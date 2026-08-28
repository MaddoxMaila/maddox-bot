import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox } from "@maddox-bot/sandbox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShellTools } from "./shellTools.js";

function fakeSandbox(overrides: Partial<Sandbox> = {}): Sandbox {
  return {
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    ...overrides,
  } as unknown as Sandbox;
}

function findTool(tools: ReturnType<typeof createShellTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`tool not found: ${name}`);
  }
  return tool;
}

describe("createShellTools", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "maddox-bot-shell-tools-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("registers the four project-check tools", () => {
    const tools = createShellTools(fakeSandbox(), dir);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "shell.run_build",
      "shell.run_lint",
      "shell.run_tests",
      "shell.run_typecheck",
    ]);
  });

  it("skips (without erroring) when the project has no matching script", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: {} }));
    const sandbox = fakeSandbox();
    const tool = findTool(createShellTools(sandbox, dir), "shell.run_tests");

    const outcome = await tool.execute({}, {} as never);

    expect(sandbox.exec).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: true,
      output: { skipped: true, reason: 'no "test" script configured' },
    });
  });

  it("runs the detected package manager + script inside the sandbox", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const sandbox = fakeSandbox({
      exec: vi
        .fn()
        .mockResolvedValue({ exitCode: 0, stdout: "3 passed", stderr: "", timedOut: false }),
    });
    const tool = findTool(createShellTools(sandbox, dir), "shell.run_tests");

    const outcome = await tool.execute({}, {} as never);

    expect(sandbox.exec).toHaveBeenCalledWith(["pnpm", "run", "test"]);
    expect(outcome).toEqual({
      ok: true,
      output: { skipped: false, exitCode: 0, stdout: "3 passed", stderr: "", timedOut: false },
    });
  });

  it("reports a non-zero exit as a normal (ok: true) outcome, not a tool error", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { lint: "eslint ." } }));
    const sandbox = fakeSandbox({
      exec: vi
        .fn()
        .mockResolvedValue({ exitCode: 1, stdout: "", stderr: "2 problems", timedOut: false }),
    });
    const tool = findTool(createShellTools(sandbox, dir), "shell.run_lint");

    const outcome = await tool.execute({}, {} as never);

    expect(outcome.ok).toBe(true);
    expect(outcome.output).toMatchObject({ exitCode: 1, stderr: "2 problems" });
  });
});
