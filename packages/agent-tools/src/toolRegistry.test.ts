import { PermissionGate } from "@maddox-bot/permissions";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition, ToolExecutionContext } from "./toolDefinition.js";
import { ToolRegistry } from "./toolRegistry.js";

function fakeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    taskId: "task-1",
    workspaceId: "workspace-1",
    role: "implementation_agent",
    requestApproval: vi.fn().mockResolvedValue("approved"),
    ...overrides,
  };
}

const echoTool: ToolDefinition<{ value: string }, string> = {
  name: "git.status", // a fixed-safe tool name, so no approval flow kicks in
  description: "Echoes the input back.",
  inputSchema: z.object({ value: z.string() }),
  async execute(input) {
    return { ok: true, output: input.value };
  },
};

describe("ToolRegistry", () => {
  it("returns unknown_tool for a name that was never registered", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute("nonexistent.tool", {}, fakeContext());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("unknown_tool");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns invalid_input when the input fails the tool's schema", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const result = await registry.execute("git.status", { value: 123 }, fakeContext());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_input");
  });

  it("executes a safe tool without requesting approval", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const requestApproval = vi.fn().mockResolvedValue("approved");

    const result = await registry.execute(
      "git.status",
      { value: "hello" },
      fakeContext({ requestApproval }),
    );

    expect(result).toMatchObject({ ok: true, output: "hello" });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("prevents duplicate registration of the same tool name", () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    expect(() => registry.register(echoTool)).toThrow(/already registered/);
  });

  it("list() and has() reflect registered tools", () => {
    const registry = new ToolRegistry();
    expect(registry.has("git.status")).toBe(false);
    registry.register(echoTool);
    expect(registry.has("git.status")).toBe(true);
    expect(registry.list()).toEqual([echoTool]);
  });

  it("requests approval for an approval_required tool and proceeds when approved", async () => {
    const registry = new ToolRegistry();
    const shellRun: ToolDefinition<{ command: string }, string> = {
      name: "shell.run",
      description: "Runs a shell command.",
      inputSchema: z.object({ command: z.string() }),
      async execute(input) {
        return { ok: true, output: `ran: ${input.command}` };
      },
    };
    registry.register(shellRun);
    const requestApproval = vi.fn().mockResolvedValue("approved");

    const result = await registry.execute(
      "shell.run",
      { command: "echo hi" },
      fakeContext({ requestApproval }),
    );

    expect(requestApproval).toHaveBeenCalledWith(expect.stringContaining("shell.run"));
    expect(result).toMatchObject({ ok: true, output: "ran: echo hi" });
  });

  it("does not execute an approval_required tool when approval is denied", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn().mockResolvedValue({ ok: true, output: "should not run" });
    const shellRun: ToolDefinition<{ command: string }, string> = {
      name: "shell.run",
      description: "Runs a shell command.",
      inputSchema: z.object({ command: z.string() }),
      execute,
    };
    registry.register(shellRun);

    const result = await registry.execute(
      "shell.run",
      { command: "echo hi" },
      fakeContext({ requestApproval: vi.fn().mockResolvedValue("denied") }),
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: "approval_denied" } });
  });

  it("never executes a human_only tool, even without asking for approval", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn().mockResolvedValue({ ok: true, output: "should never run" });
    const push: ToolDefinition<{ branch: string }, void> = {
      name: "git.push",
      description: "Pushes a branch.",
      inputSchema: z.object({ branch: z.string() }),
      execute,
    };
    registry.register(push);
    const requestApproval = vi.fn().mockResolvedValue("approved");

    const result = await registry.execute(
      "git.push",
      { branch: "main" },
      fakeContext({ requestApproval }),
    );

    expect(execute).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: "human_only" } });
  });

  it("catches a thrown error from a tool's execute() and reports it, not the process", async () => {
    const registry = new ToolRegistry();
    const explodes: ToolDefinition<Record<string, never>> = {
      name: "git.status",
      description: "Throws.",
      inputSchema: z.object({}),
      async execute() {
        throw new Error("boom");
      },
    };
    registry.register(explodes);

    const result = await registry.execute("git.status", {}, fakeContext());

    expect(result).toMatchObject({
      ok: false,
      error: { code: "execution_error", message: "boom" },
    });
  });

  it("uses a custom PermissionGate when given one", async () => {
    const permissiveGate = new PermissionGate({ protectedBranches: [] });
    const registry = new ToolRegistry(permissiveGate);
    const execute = vi.fn().mockResolvedValue({ ok: true, output: undefined });
    registry.register({
      name: "git.push",
      description: "Pushes a branch.",
      inputSchema: z.object({ branch: z.string() }),
      execute,
    });

    // With no protected branches configured, even "main" is a routine safe push.
    const result = await registry.execute("git.push", { branch: "main" }, fakeContext());

    expect(execute).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});
