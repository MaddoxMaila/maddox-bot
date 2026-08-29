import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitReadTools, createRepoReadTools, ToolRegistry } from "@maddox-bot/agent-tools";
import { Database, testDatabaseUrl } from "@maddox-bot/database";
import { GitClient } from "@maddox-bot/git";
import type { GenerateResult, LLMProvider, StructuredOutputResult } from "@maddox-bot/llm";
import { createId } from "@maddox-bot/shared";
import { simpleGit } from "simple-git";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ImplementationPlan } from "./implementationPlan.js";
import { PlannerRunner } from "./plannerRunner.js";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/sample-repo",
);
const USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

const NEVER_APPROVE = vi.fn(() => {
  throw new Error("Planner's tools are all safe-tier; approval should never be requested");
});

function toolUseTurn(id: string, name: string, input: unknown): GenerateResult {
  return { content: [{ type: "tool_use", id, name, input }], stopReason: "tool_use", usage: USAGE };
}

function textTurn(text: string): GenerateResult {
  return { content: [{ type: "text", text }], stopReason: "end_turn", usage: USAGE };
}

describe("PlannerRunner end-to-end (plan increment 12's own verification scenario)", () => {
  const database = Database.forUrl(testDatabaseUrl());
  let workDir: string;
  let organizationId: string;
  let repositoryId: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "maddox-bot-planner-e2e-"));
    // Turn the committed fixture files into a real repo — there's no nested .git committed inside
    // this monorepo (see tests/fixtures/README.md and packages/sandbox's own end-to-end test).
    await cp(FIXTURE_PATH, workDir, { recursive: true });
    const seed = simpleGit(workDir);
    await seed.init(false, ["--initial-branch=main"]);
    await seed.addConfig("user.email", "bot@example.com");
    await seed.addConfig("user.name", "Bot");
    await seed.add(".");
    await seed.commit("chore: initial commit");

    const org = await database.organizations.create({ name: `test-org-${createId()}` });
    organizationId = org.id;
    const suffix = createId();
    const repo = await database.repositories.create({
      organizationId,
      owner: `owner-${suffix}`,
      name: `repo-${suffix}`,
      defaultBranch: "main",
      cloneUrl: `https://github.com/owner-${suffix}/repo-${suffix}.git`,
      agentTriggerConfig: {},
      branchNamingTemplate: "feature/<jira-key>-<kebab-summary>",
    });
    repositoryId = repo.id;
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
    // No row cleanup: only @maddox-bot/database is allowed to talk to Prisma directly, so there's
    // no facade method to delete an agent_task's dependent tool_calls/task_events short of adding
    // delete methods nothing else needs yet. This is disposable local dev Postgres — see
    // docker-compose.yml — so a handful of uniquely-suffixed leftover fixture rows are harmless.
    await database.disconnect();
  });

  function buildRegistry(): ToolRegistry {
    const gitClient = new GitClient(workDir);
    const registry = new ToolRegistry();
    for (const tool of [...createRepoReadTools(workDir), ...createGitReadTools(gitClient)]) {
      registry.register(tool);
    }
    return registry;
  }

  it("explores the repo via tools, produces a plan, and leaves a full audit trail", async () => {
    const task = await database.agentTasks.create({
      organizationId,
      repositoryId,
      trigger: { kind: "explicit_command", command: "Implement PROJ-1" },
      bounds: {},
    });

    const plan: ImplementationPlan = {
      summary: "Add a subtract function",
      approach: "Mirror add.js's shape in a new subtract.js",
      filesToModify: [],
      filesToCreate: [{ path: "src/subtract.js", reason: "the new function" }],
      risks: [],
      requiredTests: ["subtract(2, 1) === 1"],
    };
    const toolCall = vi
      .fn<() => Promise<GenerateResult>>()
      .mockResolvedValueOnce(toolUseTurn("t1", "repo.list_files", {}))
      .mockResolvedValueOnce(toolUseTurn("t2", "repo.read_file", { path: "package.json" }))
      .mockResolvedValueOnce(textTurn("I've reviewed the repository structure."));
    const structuredOutput = vi
      .fn<() => Promise<StructuredOutputResult<ImplementationPlan>>>()
      .mockResolvedValue({ value: plan, stopReason: "end_turn", usage: USAGE });
    const llm = { toolCall, structuredOutput } as unknown as LLMProvider;

    const runner = new PlannerRunner({
      llm,
      model: "claude-opus-5",
      toolRegistry: buildRegistry(),
      database,
      requestApproval: NEVER_APPROVE,
    });

    const result = await runner.run({
      taskId: task.id,
      workspaceId: "ws-1",
      context: {
        jiraIssue: {
          key: "PROJ-1",
          summary: "Add a subtract function",
          description: "We need a subtract(a, b) helper alongside the existing add(a, b).",
          status: "AI READY",
        },
        repository: { owner: "acme", name: "sample-repo", defaultBranch: "main" },
      },
    });

    expect(result).toEqual({ plan, toolCallCount: 2, stopReason: "completed" });

    const persistedTask = await database.agentTasks.findById(task.id);
    expect(persistedTask?.state).toBe("PLANNED");
    expect(persistedTask?.previousState).toBe("ANALYZING");
    expect(persistedTask?.plan).toEqual(plan);

    const events = await database.taskEvents.listByTask(task.id);
    expect(events.map((event) => event.type)).toEqual([
      "state_changed",
      "plan_produced",
      "state_changed",
    ]);
    expect(events[0]?.payload).toEqual({ from: "CREATED", to: "ANALYZING" });
    expect(events[2]?.payload).toEqual({ from: "ANALYZING", to: "PLANNED" });

    const toolCalls = await database.toolCalls.listByTask(task.id);
    expect(toolCalls.map((call) => call.toolName)).toEqual(["repo.list_files", "repo.read_file"]);
    expect(toolCalls.every((call) => call.permissionDecision === "safe")).toBe(true);
    expect(toolCalls.every((call) => call.role === "planner")).toBe(true);
  });

  it("moves to BLOCKED and records planning_failed when the loop never produces a plan", async () => {
    const task = await database.agentTasks.create({
      organizationId,
      repositoryId,
      trigger: { kind: "explicit_command", command: "Implement PROJ-2" },
      bounds: {},
    });

    // Always requests another tool call, so the loop exhausts its budget without ever reaching
    // the "no more tool_use blocks" branch that leads to a structured final call.
    const toolCall = vi.fn().mockResolvedValue(toolUseTurn("t1", "repo.list_files", {}));
    const structuredOutput = vi.fn();
    const llm = { toolCall, structuredOutput } as unknown as LLMProvider;

    const runner = new PlannerRunner({
      llm,
      model: "claude-opus-5",
      toolRegistry: buildRegistry(),
      database,
      requestApproval: NEVER_APPROVE,
      maxToolCalls: 2,
    });

    const result = await runner.run({
      taskId: task.id,
      workspaceId: "ws-1",
      context: {
        jiraIssue: {
          key: "PROJ-2",
          summary: "Something Planner can't finish",
          description: "n/a",
          status: "AI READY",
        },
        repository: { owner: "acme", name: "sample-repo", defaultBranch: "main" },
      },
    });

    expect(result).toEqual({ plan: null, toolCallCount: 2, stopReason: "max_tool_calls" });
    expect(structuredOutput).not.toHaveBeenCalled();

    const persistedTask = await database.agentTasks.findById(task.id);
    expect(persistedTask?.state).toBe("BLOCKED");
    expect(persistedTask?.plan).toBeNull();

    const events = await database.taskEvents.listByTask(task.id);
    expect(events.map((event) => event.type)).toEqual([
      "state_changed",
      "planning_failed",
      "state_changed",
    ]);
    expect(events[2]?.payload).toEqual({ from: "ANALYZING", to: "BLOCKED" });
  });
});
