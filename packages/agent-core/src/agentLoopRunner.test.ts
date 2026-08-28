import { ToolRegistry, type ToolDefinition } from "@maddox-bot/agent-tools";
import type { Database } from "@maddox-bot/database";
import type {
  GenerateResult,
  LLMProvider,
  StructuredOutputResult,
  UserMessage,
} from "@maddox-bot/llm";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentLoopRunner, type AgentLoopOptions } from "./agentLoopRunner.js";

const USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

function toolUseTurn(blocks: Array<{ id: string; name: string; input: unknown }>): GenerateResult {
  return {
    content: blocks.map((block) => ({ type: "tool_use" as const, ...block })),
    stopReason: "tool_use",
    usage: USAGE,
  };
}

function textTurn(text: string): GenerateResult {
  return { content: [{ type: "text", text }], stopReason: "end_turn", usage: USAGE };
}

function fakeDatabase(): { database: Database; createCompleted: ReturnType<typeof vi.fn> } {
  const createCompleted = vi.fn().mockResolvedValue({ id: "call-1" });
  return { database: { toolCalls: { createCompleted } } as unknown as Database, createCompleted };
}

function registryWith(execute: ToolDefinition["execute"]): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: "git.status",
    description: "test tool",
    inputSchema: z.object({}),
    execute,
  });
  return registry;
}

function baseOptions(
  overrides: Partial<AgentLoopOptions<unknown>> = {},
): AgentLoopOptions<unknown> {
  return {
    role: "planner",
    system: "You are a test planner.",
    tools: [],
    model: "claude-opus-5",
    requestApproval: vi.fn().mockResolvedValue("approved"),
    ...overrides,
  };
}

describe("AgentLoopRunner", () => {
  it("executes a tool call, persists it, then produces a structured final output", async () => {
    const toolCall = vi
      .fn()
      .mockResolvedValueOnce(toolUseTurn([{ id: "t1", name: "git.status", input: {} }]))
      .mockResolvedValueOnce(textTurn("I've seen enough."));
    const structuredOutput = vi
      .fn<() => Promise<StructuredOutputResult<{ ok: true }>>>()
      .mockResolvedValue({ value: { ok: true }, stopReason: "end_turn", usage: USAGE });
    const llm = { toolCall, structuredOutput } as unknown as LLMProvider;
    const { database, createCompleted } = fakeDatabase();
    const registry = registryWith(async () => ({ ok: true, output: { current: "main" } }));
    const runner = new AgentLoopRunner(llm, registry, database);

    const result = await runner.run(
      { id: "task-1", workspaceId: "ws-1" },
      baseOptions({
        tools: registry.list(),
        structuredOutput: {
          schemaName: "Plan",
          schema: z.object({ ok: z.literal(true) }),
          prompt: "Go.",
        },
      }),
      [{ role: "user", content: "Begin." }],
    );

    expect(result).toMatchObject({
      output: { ok: true },
      toolCallCount: 1,
      stopReason: "completed",
    });
    expect(createCompleted).toHaveBeenCalledWith({
      taskId: "task-1",
      role: "planner",
      toolName: "git.status",
      input: {},
      permissionDecision: "safe",
      result: { ok: true, durationMs: expect.any(Number), output: { current: "main" } },
    });
    expect(structuredOutput).toHaveBeenCalledOnce();
  });

  it("returns output: null and skips the structured call when structuredOutput isn't configured", async () => {
    const toolCall = vi.fn().mockResolvedValue(textTurn("Nothing to explore."));
    const structuredOutput = vi.fn();
    const llm = { toolCall, structuredOutput } as unknown as LLMProvider;
    const { database } = fakeDatabase();
    const registry = new ToolRegistry();
    const runner = new AgentLoopRunner(llm, registry, database);

    const result = await runner.run({ id: "task-1", workspaceId: "ws-1" }, baseOptions(), [
      { role: "user", content: "Begin." },
    ]);

    expect(result).toEqual({
      messages: [
        { role: "user", content: "Begin." },
        { role: "assistant", content: [{ type: "text", text: "Nothing to explore." }] },
      ],
      toolCallCount: 0,
      output: null,
      stopReason: "completed",
    });
    expect(structuredOutput).not.toHaveBeenCalled();
  });

  it("stops at max_tool_calls without ever calling structuredOutput", async () => {
    const toolCall = vi
      .fn()
      .mockResolvedValue(toolUseTurn([{ id: "t1", name: "git.status", input: {} }]));
    const structuredOutput = vi.fn();
    const llm = { toolCall, structuredOutput } as unknown as LLMProvider;
    const { database } = fakeDatabase();
    const registry = registryWith(async () => ({ ok: true, output: null }));
    const runner = new AgentLoopRunner(llm, registry, database);

    const result = await runner.run(
      { id: "task-1", workspaceId: "ws-1" },
      baseOptions({
        maxToolCalls: 2,
        structuredOutput: { schemaName: "Plan", schema: z.object({}), prompt: "Go." },
      }),
      [{ role: "user", content: "Begin." }],
    );

    expect(result).toMatchObject({ stopReason: "max_tool_calls", output: null, toolCallCount: 2 });
    expect(structuredOutput).not.toHaveBeenCalled();
  });

  it("executes every tool_use block in a turn even if it crosses maxToolCalls mid-turn", async () => {
    const toolCall = vi.fn().mockResolvedValueOnce(
      toolUseTurn([
        { id: "t1", name: "git.status", input: {} },
        { id: "t2", name: "git.status", input: {} },
      ]),
    );
    const llm = { toolCall, structuredOutput: vi.fn() } as unknown as LLMProvider;
    const { database, createCompleted } = fakeDatabase();
    const registry = registryWith(async () => ({ ok: true, output: null }));
    const runner = new AgentLoopRunner(llm, registry, database);

    const result = await runner.run(
      { id: "task-1", workspaceId: "ws-1" },
      baseOptions({ maxToolCalls: 1 }),
      [{ role: "user", content: "Begin." }],
    );

    // Overshoots the nominal bound of 1 — both blocks in the one turn ran so the transcript stays
    // well-formed (every tool_use in the assistant turn has a matching tool_result).
    expect(result.toolCallCount).toBe(2);
    expect(result.stopReason).toBe("max_tool_calls");
    expect(createCompleted).toHaveBeenCalledTimes(2);
    const lastMessage = result.messages.at(-1) as UserMessage;
    expect(lastMessage.content).toHaveLength(2);
  });

  it("stops at the duration bound before making another LLM call", async () => {
    let calls = 0;
    const now = () => (calls++ === 0 ? 1_000 : 999_999);
    const toolCall = vi.fn();
    const llm = { toolCall, structuredOutput: vi.fn() } as unknown as LLMProvider;
    const { database } = fakeDatabase();
    const registry = new ToolRegistry();
    const runner = new AgentLoopRunner(llm, registry, database, now);

    const result = await runner.run(
      { id: "task-1", workspaceId: "ws-1" },
      baseOptions({ maxDurationMs: 100 }),
      [{ role: "user", content: "Begin." }],
    );

    expect(result).toMatchObject({ stopReason: "timeout", output: null, toolCallCount: 0 });
    expect(toolCall).not.toHaveBeenCalled();
  });

  it("records a failed tool call and feeds it back as an isError tool_result, without crashing", async () => {
    const toolCall = vi
      .fn()
      .mockResolvedValueOnce(toolUseTurn([{ id: "t1", name: "git.status", input: {} }]))
      .mockResolvedValueOnce(textTurn("done"));
    const llm = { toolCall, structuredOutput: vi.fn() } as unknown as LLMProvider;
    const { database, createCompleted } = fakeDatabase();
    const registry = registryWith(async () => {
      throw new Error("boom");
    });
    const runner = new AgentLoopRunner(llm, registry, database);

    const result = await runner.run({ id: "task-1", workspaceId: "ws-1" }, baseOptions(), [
      { role: "user", content: "Begin." },
    ]);

    expect(result.stopReason).toBe("completed");
    expect(createCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          ok: false,
          error: { code: "execution_error", message: "boom" },
        }),
      }),
    );
    const toolResultMessage = result.messages[2] as UserMessage;
    expect(toolResultMessage.content).toEqual([
      { type: "tool_result", toolUseId: "t1", content: "boom", isError: true },
    ]);
  });
});
