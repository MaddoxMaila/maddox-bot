import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database, testDatabaseUrl } from "@maddox-bot/database";
import { GitHubClient, type OctokitLike, type RawGitHubPullRequest } from "@maddox-bot/github";
import {
  JiraClient,
  type JiraApiLike,
  type RawJiraIssue,
  type RawJiraTransition,
} from "@maddox-bot/jira";
import { ModelRouter } from "@maddox-bot/llm";
import type { GenerateResult, LLMProvider, StructuredOutputResult } from "@maddox-bot/llm";
import { createId, createLogger } from "@maddox-bot/shared";
import { simpleGit } from "simple-git";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleAgentTriggerJob } from "./jobHandler.js";
import { requireTask } from "./taskRunner.js";
import type { WorkerDependencies } from "./workerDependencies.js";

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
const SANDBOX_IMAGE = "maddox-bot-sandbox:latest";

function toolUseTurn(id: string, name: string, input: unknown): GenerateResult {
  return { content: [{ type: "tool_use", id, name, input }], stopReason: "tool_use", usage: USAGE };
}

function textTurn(text: string): GenerateResult {
  return { content: [{ type: "text", text }], stopReason: "end_turn", usage: USAGE };
}

describe("worker pipeline end-to-end (plan increment 14's own verification scenario)", () => {
  const database = Database.forUrl(testDatabaseUrl());
  let workDir: string;
  let bareRepoPath: string;
  let organizationId: string;
  let repositoryId: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "maddox-bot-worker-e2e-"));
    bareRepoPath = join(workDir, "sample-repo.git");

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
      // A local bare repo path, not a real GitHub URL — githubToken is "" below so
      // buildAuthenticatedCloneUrl skips URL-parsing this as an https remote.
      cloneUrl: bareRepoPath,
      agentTriggerConfig: {},
      branchNamingTemplate: "feature/<jira-key>-<kebab-summary>",
    });
    repositoryId = repo.id;
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
    await database.disconnect();
  });

  it("takes a Jira trigger job all the way to an opened PR, with Jira linked", async () => {
    const issueKey = `PROJ-${Date.now()}`;

    const fakeJiraApi: JiraApiLike = {
      getIssue: vi.fn().mockResolvedValue({
        key: issueKey,
        fields: {
          summary: "Add a subtract function",
          description: null,
          status: { name: "AI READY" },
          assignee: null,
          labels: ["ai-agent"],
        },
      } satisfies RawJiraIssue),
      getComments: vi.fn().mockResolvedValue([]),
      addComment: vi.fn().mockResolvedValue(undefined),
      getTransitions: vi
        .fn()
        .mockResolvedValue([
          { id: "21", name: "Start Review", to: { name: "In Review" } },
        ] satisfies RawJiraTransition[]),
      postTransition: vi.fn().mockResolvedValue(undefined),
    };
    const jiraClient = new JiraClient(fakeJiraApi);

    const fakeOctokit: OctokitLike = {
      getRepository: vi.fn(),
      getPullRequest: vi.fn(),
      getPullRequestDiff: vi.fn(),
      listIssueComments: vi.fn(),
      listReviews: vi.fn(),
      createPullRequest: vi.fn().mockResolvedValue({
        number: 9,
        title: `${issueKey}: Add a subtract function`,
        body: "...",
        state: "open",
        draft: false,
        merged: false,
        html_url: "https://github.com/acme/sample-repo/pull/9",
        head: { ref: "feature/x", sha: "deadbeef" },
        base: { ref: "main" },
      } satisfies RawGitHubPullRequest),
      createIssueComment: vi.fn().mockResolvedValue(undefined),
    };
    const githubClient = new GitHubClient(fakeOctokit);

    // Planner: list files, read package.json, then stop and produce a plan.
    // Implementation Agent: write the file, commit, then stop.
    const toolCall = vi
      .fn<() => Promise<GenerateResult>>()
      .mockResolvedValueOnce(toolUseTurn("p1", "repo.list_files", {}))
      .mockResolvedValueOnce(textTurn("Investigated."))
      .mockResolvedValueOnce(
        toolUseTurn("i1", "repo.write_file", {
          path: "src/subtract.js",
          content:
            "function subtract(a, b) {\n  return a - b;\n}\n\nmodule.exports = { subtract };\n",
        }),
      )
      .mockResolvedValueOnce(toolUseTurn("i2", "git.commit", { message: "feat: add subtract" }))
      .mockResolvedValueOnce(textTurn("Implemented."));
    const structuredOutput = vi
      .fn()
      .mockResolvedValueOnce({
        value: {
          summary: "Add a subtract function",
          approach: "Mirror add.js",
          filesToModify: [],
          filesToCreate: [{ path: "src/subtract.js", reason: "the new function" }],
          risks: [],
          requiredTests: ["subtract(2, 1) === 1"],
        },
        stopReason: "end_turn",
        usage: USAGE,
      } satisfies StructuredOutputResult<unknown>)
      .mockResolvedValueOnce({
        value: { summary: "Small, focused change.", concerns: [] },
        stopReason: "end_turn",
        usage: USAGE,
      } satisfies StructuredOutputResult<unknown>);
    const llm = { toolCall, structuredOutput } as unknown as LLMProvider;

    const deps: WorkerDependencies = {
      database,
      agentTriggerQueue: undefined as never, // handleAgentTriggerJob is called directly, not via the queue
      llm,
      modelRouter: new ModelRouter(),
      githubToken: "",
      githubClient,
      jiraClient,
      sandboxImage: SANDBOX_IMAGE,
      gitIdentity: { name: "Bot", email: "bot@example.com" },
      autoApprovePlans: true,
      logger: createLogger("worker-e2e-test"),
    };

    const receivedEventId = createId();
    await handleAgentTriggerJob(deps, {
      source: "jira",
      repositoryId,
      eventType: "jira:issue_updated",
      externalRefs: { issueKey },
      receivedEventId,
    });

    const task = await database.agentTasks.findByReceivedEventId(receivedEventId);
    expect(task).not.toBeNull();
    const finalTask = await requireTask(deps, task?.id ?? "");

    expect(finalTask.state).toBe("AWAITING_HUMAN_REVIEW");

    const pr = await database.pullRequests.findByTaskId(finalTask.id);
    expect(pr).toMatchObject({
      providerPrNumber: 9,
      url: "https://github.com/acme/sample-repo/pull/9",
    });

    expect(fakeOctokit.createPullRequest).toHaveBeenCalledOnce();
    expect(fakeJiraApi.addComment).toHaveBeenCalled();
    // Not called: implementationPhase.ts doesn't set targetReviewStatus yet — there's no config
    // surface wiring a Jira review-status name in from anywhere (agentTriggerConfig doesn't carry
    // one). ImplementationAgentRunner's own tests already cover the transition-status behavior
    // when it *is* set; this is a known, documented gap in the worker's wiring, not this test's.
    expect(fakeJiraApi.postTransition).not.toHaveBeenCalled();

    // The file really was pushed to the real bare remote.
    const verifyClonePath = join(workDir, "verify-clone");
    await simpleGit().clone(bareRepoPath, verifyClonePath);
    const branches = await simpleGit(verifyClonePath).branch(["-r"]);
    const pushedBranch = branches.all.find((name) => name.includes("subtract"));
    expect(pushedBranch).toBeDefined();
    await simpleGit(verifyClonePath).checkout(pushedBranch as string);
    const written = await readFile(join(verifyClonePath, "src", "subtract.js"), "utf8");
    expect(written).toContain("function subtract");
  }, 30000);
});
