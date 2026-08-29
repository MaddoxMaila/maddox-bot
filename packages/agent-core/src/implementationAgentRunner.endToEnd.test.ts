import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGitReadTools,
  createGitHubReadTools,
  createGitHubWriteTools,
  createGitWriteTools,
  createJiraReadTools,
  createJiraWriteTools,
  createRepoReadTools,
  createRepoWriteTools,
  ToolRegistry,
  type ToolDefinition,
} from "@maddox-bot/agent-tools";
import { Database, testDatabaseUrl } from "@maddox-bot/database";
import { GitClient } from "@maddox-bot/git";
import { GitHubClient, type OctokitLike, type RawGitHubPullRequest } from "@maddox-bot/github";
import { JiraClient, type JiraApiLike, type RawJiraTransition } from "@maddox-bot/jira";
import type { GenerateResult, LLMProvider, StructuredOutputResult } from "@maddox-bot/llm";
import { createId } from "@maddox-bot/shared";
import { simpleGit } from "simple-git";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ImplementationAgentRunner } from "./implementationAgentRunner.js";
import type { ImplementationPlan } from "./implementationPlan.js";
import type { SelfReview } from "./selfReview.js";

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

function toolUseTurn(id: string, name: string, input: unknown): GenerateResult {
  return { content: [{ type: "tool_use", id, name, input }], stopReason: "tool_use", usage: USAGE };
}

function textTurn(text: string): GenerateResult {
  return { content: [{ type: "text", text }], stopReason: "end_turn", usage: USAGE };
}

function fakeShellTool(name: string, execute: ToolDefinition["execute"]): ToolDefinition {
  return {
    name,
    description: "fake shell check for this test",
    inputSchema: z.object({}),
    execute,
  };
}

describe("ImplementationAgentRunner end-to-end (plan increment 13's own verification scenario)", () => {
  const database = Database.forUrl(testDatabaseUrl());
  let workDir: string;
  let bareRepoPath: string;
  let clonePath: string;
  let organizationId: string;
  let repositoryId: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "maddox-bot-impl-agent-e2e-"));
    bareRepoPath = join(workDir, "sample-repo.git");
    clonePath = join(workDir, "clone");

    const seedPath = join(workDir, "seed");
    await cp(FIXTURE_PATH, seedPath, { recursive: true });
    const seed = simpleGit(seedPath);
    await seed.init(false, ["--initial-branch=main"]);
    await seed.addConfig("user.email", "bot@example.com");
    await seed.addConfig("user.name", "Bot");
    await seed.add(".");
    await seed.commit("chore: initial commit");

    await mkdir(bareRepoPath, { recursive: true });
    await simpleGit(bareRepoPath).init(true);
    await seed.addRemote("origin", bareRepoPath);
    await seed.push("origin", "main");

    const org = await database.organizations.create({ name: `test-org-${createId()}` });
    organizationId = org.id;
    const suffix = createId();
    const repo = await database.repositories.create({
      organizationId,
      owner: `owner-${suffix}`,
      name: `repo-${suffix}`,
      defaultBranch: "main",
      cloneUrl: bareRepoPath,
      agentTriggerConfig: {},
      branchNamingTemplate: "feature/<jira-key>-<kebab-summary>",
    });
    repositoryId = repo.id;
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
    // See plannerRunner.endToEnd.test.ts for why fixture rows aren't deleted here.
    await database.disconnect();
  });

  it("implements a real diff, pushes it to a real remote, and opens a PR with Jira linked", async () => {
    const client = await GitClient.clone({
      url: bareRepoPath,
      directory: clonePath,
      identity: { name: "Bot", email: "bot@example.com" },
    });

    const fakeOctokit: OctokitLike = {
      getRepository: vi.fn(),
      getPullRequest: vi.fn(),
      getPullRequestDiff: vi.fn(),
      listIssueComments: vi.fn(),
      listReviews: vi.fn(),
      createPullRequest: vi.fn().mockResolvedValue({
        number: 7,
        title: "PROJ-1: Add a subtract function",
        body: "...",
        state: "open",
        draft: false,
        merged: false,
        html_url: "https://github.com/acme/sample-repo/pull/7",
        head: { ref: "feature/proj-1-subtract", sha: "deadbeef" },
        base: { ref: "main" },
      } satisfies RawGitHubPullRequest),
      createIssueComment: vi.fn().mockResolvedValue(undefined),
    };
    const githubClient = new GitHubClient(fakeOctokit);

    const fakeJiraApi: JiraApiLike = {
      getIssue: vi.fn(),
      getComments: vi.fn(),
      addComment: vi.fn().mockResolvedValue(undefined),
      getTransitions: vi
        .fn()
        .mockResolvedValue([
          { id: "21", name: "Start Review", to: { name: "In Review" } },
        ] satisfies RawJiraTransition[]),
      postTransition: vi.fn().mockResolvedValue(undefined),
    };
    const jiraClient = new JiraClient(fakeJiraApi);

    const registry = new ToolRegistry();
    for (const tool of [
      ...createRepoReadTools(clonePath),
      ...createRepoWriteTools(clonePath),
      ...createGitReadTools(client),
      ...createGitWriteTools(client),
      ...createGitHubReadTools(githubClient),
      ...createGitHubWriteTools(githubClient),
      ...createJiraReadTools(jiraClient),
      ...createJiraWriteTools(jiraClient),
      fakeShellTool("shell.run_build", async () => ({
        ok: true,
        output: { skipped: true, reason: "no build script" },
      })),
      fakeShellTool("shell.run_lint", async () => ({
        ok: true,
        output: { skipped: true, reason: "no lint script" },
      })),
      fakeShellTool("shell.run_typecheck", async () => ({
        ok: true,
        output: { skipped: true, reason: "no typecheck script" },
      })),
      fakeShellTool("shell.run_tests", async () => ({
        ok: true,
        output: { skipped: false, exitCode: 0, stdout: "1 passed", stderr: "" },
      })),
    ]) {
      registry.register(tool);
    }

    const plan: ImplementationPlan = {
      summary: "Add a subtract function",
      approach: "Mirror add.js's shape in a new subtract.js",
      filesToModify: [],
      filesToCreate: [{ path: "src/subtract.js", reason: "the new function" }],
      risks: [],
      requiredTests: ["subtract(2, 1) === 1"],
    };
    const selfReview: SelfReview = { summary: "Small, focused change.", concerns: [] };

    const toolCall = vi
      .fn<() => Promise<GenerateResult>>()
      .mockResolvedValueOnce(
        toolUseTurn("t1", "repo.write_file", {
          path: "src/subtract.js",
          content:
            "function subtract(a, b) {\n  return a - b;\n}\n\nmodule.exports = { subtract };\n",
        }),
      )
      .mockResolvedValueOnce(
        toolUseTurn("t2", "git.commit", { message: "feat: add subtract function" }),
      )
      .mockResolvedValueOnce(textTurn("Implementation complete."));
    const structuredOutput = vi
      .fn<() => Promise<StructuredOutputResult<SelfReview>>>()
      .mockResolvedValue({ value: selfReview, stopReason: "end_turn", usage: USAGE });
    const llm = { toolCall, structuredOutput } as unknown as LLMProvider;

    const task = await database.agentTasks.create({
      organizationId,
      repositoryId,
      trigger: { kind: "explicit_command", command: "Implement PROJ-1" },
      bounds: {},
    });
    // The Implementation Agent's own precondition is AWAITING_APPROVAL — a real pipeline reaches
    // that via PlannerRunner + a human approval step; this test starts from the state the runner
    // actually requires, the same way plannerRunner.endToEnd.test.ts starts fresh from CREATED.
    await database.agentTasks.updateState(task.id, "ANALYZING");
    await database.agentTasks.updateState(task.id, "PLANNED");
    await database.agentTasks.updateState(task.id, "AWAITING_APPROVAL");

    const runner = new ImplementationAgentRunner({
      llm,
      model: "claude-opus-5",
      toolRegistry: registry,
      database,
      requestApproval: vi.fn(() => {
        throw new Error("every tool in this registry is safe-tier; approval should never fire");
      }),
    });

    const result = await runner.run({
      taskId: task.id,
      workspaceId: "ws-1",
      plan,
      jiraIssue: { key: "PROJ-1", summary: "Add a subtract function" },
      repository: { id: repositoryId, owner: "acme", name: "sample-repo" },
      baseBranch: "main",
      branchName: "feature/proj-1-subtract",
      targetReviewStatus: "In Review",
    });

    expect(result).toEqual({
      stopReason: "completed",
      pullRequest: { number: 7, url: "https://github.com/acme/sample-repo/pull/7" },
      fixAttempts: 0,
    });

    // The file really was written, committed, and pushed to the real bare remote.
    const pushedClone = join(workDir, "verify-clone");
    await simpleGit().clone(bareRepoPath, pushedClone);
    await simpleGit(pushedClone).checkout("feature/proj-1-subtract");
    const written = await readFile(join(pushedClone, "src", "subtract.js"), "utf8");
    expect(written).toContain("function subtract");

    expect(fakeOctokit.createPullRequest).toHaveBeenCalledWith(
      "acme",
      "sample-repo",
      expect.objectContaining({ head: "feature/proj-1-subtract", base: "main" }),
    );
    expect(fakeJiraApi.addComment).toHaveBeenCalledWith("PROJ-1", expect.anything());
    expect(fakeJiraApi.postTransition).toHaveBeenCalledWith("PROJ-1", "21");

    const persistedTask = await database.agentTasks.findById(task.id);
    expect(persistedTask?.state).toBe("AWAITING_HUMAN_REVIEW");

    const persistedPr = await database.pullRequests.findByRepositoryAndProviderNumber(
      repositoryId,
      7,
    );
    expect(persistedPr).toMatchObject({
      taskId: task.id,
      url: "https://github.com/acme/sample-repo/pull/7",
    });

    const events = await database.taskEvents.listByTask(task.id);
    expect(events.map((event) => event.type)).toEqual([
      "state_changed",
      "state_changed",
      "state_changed",
      "state_changed",
      "pull_request_created",
      "state_changed",
    ]);

    const toolCalls = await database.toolCalls.listByTask(task.id);
    expect(toolCalls.map((call) => call.toolName)).toContain("github.create_pr");
    expect(toolCalls.every((call) => call.role === "implementation_agent")).toBe(true);
  }, 20000);
});
