import { ToolRegistry, type ToolDefinition } from "@maddox-bot/agent-tools";
import type { Database } from "@maddox-bot/database";
import type { GenerateResult, LLMProvider, StructuredOutputResult } from "@maddox-bot/llm";
import type { TaskState } from "@maddox-bot/shared";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ImplementationAgentRunner,
  type ImplementationAgentDeps,
  type ImplementationAgentInput,
} from "./implementationAgentRunner.js";
import type { ImplementationPlan } from "./implementationPlan.js";
import type { SelfReview } from "./selfReview.js";

const USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

const PLAN: ImplementationPlan = {
  summary: "Add a health check endpoint",
  approach: "Add a new route returning 200",
  filesToModify: [],
  filesToCreate: [{ path: "src/health.ts", reason: "the new route" }],
  risks: [],
  requiredTests: ["GET /health returns 200"],
};

function baseInput(overrides: Partial<ImplementationAgentInput> = {}): ImplementationAgentInput {
  return {
    taskId: "task-1",
    workspaceId: "ws-1",
    plan: PLAN,
    jiraIssue: { key: "PROJ-1", summary: "Add a health check endpoint" },
    repository: { id: "repo-1", owner: "acme", name: "widgets" },
    baseBranch: "main",
    branchName: "feature/proj-1-health-check",
    ...overrides,
  };
}

function textTurn(text: string): GenerateResult {
  return { content: [{ type: "text", text }], stopReason: "end_turn", usage: USAGE };
}

function toolUseTurn(id: string, name: string, input: unknown = {}): GenerateResult {
  return { content: [{ type: "tool_use", id, name, input }], stopReason: "tool_use", usage: USAGE };
}

function fakeDatabase(overrides: { state?: TaskState; previousState?: TaskState | null } = {}): {
  database: Database;
  updateState: ReturnType<typeof vi.fn>;
  createEvent: ReturnType<typeof vi.fn>;
  createToolCall: ReturnType<typeof vi.fn>;
  createPullRequest: ReturnType<typeof vi.fn>;
} {
  let state = overrides.state ?? "AWAITING_APPROVAL";
  const previousState = overrides.previousState ?? null;
  const updateState = vi.fn().mockImplementation((_id: string, next: TaskState) => {
    state = next;
    return Promise.resolve({ id: "task-1", state });
  });
  const createEvent = vi.fn().mockResolvedValue({ id: "event-1" });
  const createToolCall = vi.fn().mockResolvedValue({ id: "call-1" });
  const createPullRequest = vi.fn().mockResolvedValue({ id: "pr-1" });

  const database = {
    agentTasks: {
      findById: vi
        .fn()
        .mockImplementation(() => Promise.resolve({ id: "task-1", state, previousState })),
      updateState,
    },
    taskEvents: { create: createEvent },
    toolCalls: { createCompleted: createToolCall },
    pullRequests: { create: createPullRequest },
  } as unknown as Database;

  return { database, updateState, createEvent, createToolCall, createPullRequest };
}

type ToolBehavior = ToolDefinition["execute"];

const DEFAULT_TOOL_BEHAVIORS: Record<string, ToolBehavior> = {
  "git.create_branch": async () => ({ ok: true, output: undefined }),
  "repo.write_file": async () => ({ ok: true, output: { path: "src/health.ts", sha: "abc" } }),
  "git.commit": async () => ({ ok: true, output: { sha: "abc123" } }),
  "shell.run_build": async () => ({
    ok: true,
    output: { skipped: true, reason: "no build script" },
  }),
  "shell.run_lint": async () => ({ ok: true, output: { skipped: true, reason: "no lint script" } }),
  "shell.run_typecheck": async () => ({
    ok: true,
    output: { skipped: true, reason: "no typecheck script" },
  }),
  "shell.run_tests": async () => ({
    ok: true,
    output: { skipped: false, exitCode: 0, stdout: "3 passed", stderr: "" },
  }),
  "git.diff": async () => ({ ok: true, output: "diff --git a/src/health.ts b/src/health.ts" }),
  "git.push": async () => ({ ok: true, output: undefined }),
  "github.create_pr": async () => ({
    ok: true,
    output: { number: 7, url: "https://github.com/acme/widgets/pull/7" },
  }),
  "jira.link_pr": async () => ({ ok: true, output: undefined }),
  "jira.update_issue": async () => ({ ok: true, output: undefined }),
};

function buildRegistry(overrides: Record<string, ToolBehavior> = {}): ToolRegistry {
  const registry = new ToolRegistry();
  const behaviors = { ...DEFAULT_TOOL_BEHAVIORS, ...overrides };
  for (const [name, execute] of Object.entries(behaviors)) {
    registry.register({
      name,
      description: "test tool",
      inputSchema: z.object({}).passthrough(),
      execute,
    });
  }
  return registry;
}

function fakeLlm(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    toolCall: vi
      .fn()
      .mockResolvedValueOnce(toolUseTurn("t1", "repo.write_file", { path: "src/health.ts" }))
      .mockResolvedValueOnce(toolUseTurn("t2", "git.commit", { message: "feat: add health route" }))
      .mockResolvedValue(textTurn("Done.")),
    structuredOutput: vi.fn<() => Promise<StructuredOutputResult<SelfReview>>>().mockResolvedValue({
      value: { summary: "Looks fine.", concerns: [] },
      stopReason: "end_turn",
      usage: USAGE,
    }),
    generate: vi.fn(),
    stream: vi.fn(),
    ...overrides,
  } as unknown as LLMProvider;
}

function buildDeps(
  overrides: Partial<ImplementationAgentDeps> = {},
  dbOverrides: Parameters<typeof fakeDatabase>[0] = {},
) {
  const dbHandles = fakeDatabase(dbOverrides);
  const deps: ImplementationAgentDeps = {
    llm: fakeLlm(),
    model: "claude-opus-5",
    toolRegistry: buildRegistry(),
    database: dbHandles.database,
    requestApproval: vi.fn(() => {
      throw new Error("no tool here should ever require approval");
    }),
    maxFixAttempts: 3,
    ...overrides,
  };
  return { deps, ...dbHandles };
}

describe("ImplementationAgentRunner — happy path", () => {
  it("implements, verifies, self-reviews, opens a PR, and links Jira", async () => {
    const { deps, createPullRequest, createEvent } = buildDeps();
    const runner = new ImplementationAgentRunner(deps);

    const result = await runner.run(baseInput());

    expect(result).toEqual({
      stopReason: "completed",
      pullRequest: { number: 7, url: "https://github.com/acme/widgets/pull/7" },
      fixAttempts: 0,
    });
    expect(createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        repositoryId: "repo-1",
        providerPrNumber: 7,
        url: "https://github.com/acme/widgets/pull/7",
        headBranch: "feature/proj-1-health-check",
        baseBranch: "main",
      }),
    );
    const eventTypes = createEvent.mock.calls.map(([call]) => call.type as string);
    expect(eventTypes).toEqual([
      "state_changed",
      "state_changed",
      "state_changed",
      "state_changed",
      "pull_request_created",
      "state_changed",
    ]);
  });

  it("transitions the Jira issue when targetReviewStatus is given", async () => {
    const updateIssueSpy = vi.fn().mockResolvedValue({ ok: true, output: undefined });
    const { deps } = buildDeps({
      toolRegistry: buildRegistry({ "jira.update_issue": updateIssueSpy }),
    });
    const runner = new ImplementationAgentRunner(deps);

    await runner.run(baseInput({ targetReviewStatus: "In Review" }));

    expect(updateIssueSpy).toHaveBeenCalledWith(
      { issueKey: "PROJ-1", status: "In Review" },
      expect.anything(),
    );
  });

  it("skips the Jira transition when targetReviewStatus is omitted", async () => {
    const updateIssueSpy = vi.fn().mockResolvedValue({ ok: true, output: undefined });
    const { deps } = buildDeps({
      toolRegistry: buildRegistry({ "jira.update_issue": updateIssueSpy }),
    });
    const runner = new ImplementationAgentRunner(deps);

    await runner.run(baseInput());

    expect(updateIssueSpy).not.toHaveBeenCalled();
  });

  it("still opens the PR and reports success when linking Jira fails", async () => {
    const { deps, createEvent } = buildDeps({
      toolRegistry: buildRegistry({
        "jira.link_pr": async () => ({
          ok: false,
          error: { code: "network_error", message: "Jira is unreachable" },
        }),
      }),
    });
    const runner = new ImplementationAgentRunner(deps);

    const result = await runner.run(baseInput());

    expect(result.stopReason).toBe("completed");
    expect(result.pullRequest).not.toBeNull();
    const failureEvent = createEvent.mock.calls.find(([call]) => call.type === "jira_link_failed");
    expect(failureEvent?.[0]).toMatchObject({ payload: { message: "Jira is unreachable" } });
  });

  it("still reports success when the Jira status transition fails", async () => {
    const { deps, createEvent } = buildDeps({
      toolRegistry: buildRegistry({
        "jira.update_issue": async () => ({
          ok: false,
          error: { code: "execution_error", message: "No such transition" },
        }),
      }),
    });
    const runner = new ImplementationAgentRunner(deps);

    const result = await runner.run(baseInput({ targetReviewStatus: "In Review" }));

    expect(result.stopReason).toBe("completed");
    const failureEvent = createEvent.mock.calls.find(
      ([call]) => call.type === "jira_transition_failed",
    );
    expect(failureEvent?.[0]).toMatchObject({
      payload: { message: "No such transition", targetReviewStatus: "In Review" },
    });
  });
});

describe("ImplementationAgentRunner — the fix loop", () => {
  it("retries once on a failing gate, then succeeds", async () => {
    let testsCall = 0;
    const { deps } = buildDeps({
      llm: fakeLlm({
        toolCall: vi
          .fn()
          .mockResolvedValueOnce(toolUseTurn("t1", "repo.write_file", { path: "src/health.ts" }))
          .mockResolvedValueOnce(textTurn("Implemented."))
          .mockResolvedValueOnce(toolUseTurn("t2", "repo.write_file", { path: "src/health.ts" }))
          .mockResolvedValue(textTurn("Fixed.")),
      }),
      toolRegistry: buildRegistry({
        "shell.run_tests": async () => {
          testsCall++;
          return testsCall === 1
            ? { ok: true, output: { skipped: false, exitCode: 1, stdout: "", stderr: "1 failed" } }
            : { ok: true, output: { skipped: false, exitCode: 0, stdout: "3 passed", stderr: "" } };
        },
      }),
    });
    const runner = new ImplementationAgentRunner(deps);

    const result = await runner.run(baseInput());

    expect(result).toMatchObject({ stopReason: "completed", fixAttempts: 1 });
  });

  it("treats a verification tool erroring outright as a gate failure, not a crash", async () => {
    const { deps } = buildDeps({
      toolRegistry: buildRegistry({
        "shell.run_lint": async () => ({
          ok: false,
          error: { code: "execution_error", message: "sandbox exec failed" },
        }),
      }),
      llm: fakeLlm({
        toolCall: vi
          .fn()
          .mockResolvedValueOnce(toolUseTurn("t1", "repo.write_file", { path: "src/health.ts" }))
          .mockResolvedValueOnce(textTurn("Implemented."))
          .mockResolvedValueOnce(toolUseTurn("t2", "repo.write_file", { path: "src/health.ts" }))
          .mockResolvedValue(textTurn("Fixed.")),
      }),
    });
    const runner = new ImplementationAgentRunner(deps);

    const result = await runner.run(baseInput());

    // The fake shell.run_lint always errors, so every gate attempt fails until the default
    // maxFixAttempts (3) is exhausted.
    expect(result).toEqual({ stopReason: "blocked", pullRequest: null, fixAttempts: 3 });
  });

  it("gives up after exhausting the fix-attempt budget", async () => {
    const { deps, updateState } = buildDeps({
      maxFixAttempts: 1,
      llm: fakeLlm({
        toolCall: vi.fn().mockResolvedValue(textTurn("Nothing more to do.")),
      }),
      toolRegistry: buildRegistry({
        "shell.run_tests": async () => ({
          ok: true,
          output: { skipped: false, exitCode: 1, stdout: "", stderr: "always fails" },
        }),
      }),
    });
    const runner = new ImplementationAgentRunner(deps);

    const result = await runner.run(baseInput());

    expect(result).toEqual({ stopReason: "blocked", pullRequest: null, fixAttempts: 1 });
    expect(updateState).toHaveBeenLastCalledWith("task-1", "BLOCKED");
  });

  it("blocks if a fix attempt itself doesn't complete (e.g. exhausts its own tool-call budget)", async () => {
    const { deps } = buildDeps({
      maxFixAttempts: 2,
      maxToolCalls: 2,
      llm: fakeLlm({
        toolCall: vi
          .fn()
          // The initial loop completes well within the bound (1 call, then stops).
          .mockResolvedValueOnce(toolUseTurn("t1", "repo.write_file", { path: "src/health.ts" }))
          .mockResolvedValueOnce(textTurn("Implemented."))
          // The fix attempt never stops calling tools, so it exhausts its own fresh maxToolCalls
          // (2) budget instead — each AgentLoopRunner.run() call starts its count back at 0.
          .mockResolvedValue(toolUseTurn("t2", "repo.write_file", { path: "src/health.ts" })),
      }),
      toolRegistry: buildRegistry({
        "shell.run_tests": async () => ({
          ok: true,
          output: { skipped: false, exitCode: 1, stdout: "", stderr: "fails" },
        }),
      }),
    });
    const runner = new ImplementationAgentRunner(deps);

    const result = await runner.run(baseInput());

    expect(result).toEqual({ stopReason: "blocked", pullRequest: null, fixAttempts: 1 });
  });
});

describe("ImplementationAgentRunner — early failures", () => {
  it("blocks immediately if branch creation fails, without starting the implementation loop", async () => {
    const toolCallSpy = vi.fn();
    const { deps } = buildDeps({
      llm: fakeLlm({ toolCall: toolCallSpy }),
      toolRegistry: buildRegistry({
        "git.create_branch": async () => ({
          ok: false,
          error: { code: "execution_error", message: "branch already exists" },
        }),
      }),
    });
    const runner = new ImplementationAgentRunner(deps);

    const result = await runner.run(baseInput());

    expect(result).toEqual({ stopReason: "blocked", pullRequest: null, fixAttempts: 0 });
    expect(toolCallSpy).not.toHaveBeenCalled();
  });

  it("blocks if the implementation loop doesn't complete (e.g. times out)", async () => {
    const { deps } = buildDeps({
      maxToolCalls: 1,
      llm: fakeLlm({
        toolCall: vi
          .fn()
          .mockResolvedValue(toolUseTurn("t1", "repo.write_file", { path: "src/health.ts" })),
      }),
    });
    const runner = new ImplementationAgentRunner(deps);

    const result = await runner.run(baseInput());

    expect(result).toEqual({ stopReason: "blocked", pullRequest: null, fixAttempts: 0 });
  });

  it("blocks if pushing before PR creation fails", async () => {
    const { deps } = buildDeps({
      toolRegistry: buildRegistry({
        "git.push": async () => ({
          ok: false,
          error: { code: "execution_error", message: "remote rejected the push" },
        }),
      }),
    });
    const runner = new ImplementationAgentRunner(deps);

    const result = await runner.run(baseInput());

    expect(result).toEqual({ stopReason: "blocked", pullRequest: null, fixAttempts: 0 });
  });

  it("blocks if PR creation fails, and never writes a pull_requests row", async () => {
    const { deps, createPullRequest } = buildDeps({
      toolRegistry: buildRegistry({
        "github.create_pr": async () => ({
          ok: false,
          error: { code: "execution_error", message: "422 Unprocessable Entity" },
        }),
      }),
    });
    const runner = new ImplementationAgentRunner(deps);

    const result = await runner.run(baseInput());

    expect(result).toEqual({ stopReason: "blocked", pullRequest: null, fixAttempts: 0 });
    expect(createPullRequest).not.toHaveBeenCalled();
  });
});
