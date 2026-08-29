import { Database, testDatabaseUrl } from "@maddox-bot/database";
import type { AgentTriggerJobPayload } from "@maddox-bot/events";
import type { JiraClient } from "@maddox-bot/jira";
import { createId, createLogger } from "@maddox-bot/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAgentTriggerJob } from "./jobHandler.js";
import { runTask } from "./taskRunner.js";
import type { WorkerDependencies } from "./workerDependencies.js";

vi.mock("./taskRunner.js", () => ({ runTask: vi.fn() }));

const mockedRunTask = vi.mocked(runTask);

describe("handleAgentTriggerJob", () => {
  const database = Database.forUrl(testDatabaseUrl());
  let organizationId: string;
  let repositoryId: string;

  function fakeJiraClient(overrides: Partial<JiraClient> = {}): JiraClient {
    return {
      getIssue: vi.fn().mockResolvedValue({
        key: "PROJ-1",
        summary: "Add password reset",
        description: "Users can reset their password.",
        status: "AI READY",
        assignee: null,
        labels: ["ai-agent"],
      }),
      ...overrides,
    } as unknown as JiraClient;
  }

  function deps(overrides: Partial<WorkerDependencies> = {}): WorkerDependencies {
    return {
      database,
      agentTriggerQueue: undefined as never,
      llm: undefined as never,
      modelRouter: undefined as never,
      githubToken: "unused",
      githubClient: undefined as never,
      jiraClient: fakeJiraClient(),
      sandboxImage: "unused",
      gitIdentity: { name: "Bot", email: "bot@example.com" },
      autoApprovePlans: true,
      logger: createLogger("job-handler-test"),
      ...overrides,
    };
  }

  afterAll(async () => {
    await database.disconnect();
  });

  beforeEach(async () => {
    mockedRunTask.mockReset().mockResolvedValue(undefined);
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

  function jiraPayload(overrides: Partial<AgentTriggerJobPayload> = {}): AgentTriggerJobPayload {
    return {
      source: "jira",
      repositoryId,
      eventType: "jira:issue_updated",
      externalRefs: { issueKey: "PROJ-1" },
      receivedEventId: createId(),
      ...overrides,
    };
  }

  it("fetches the issue, upserts it, creates a task, and runs it", async () => {
    const jiraClient = fakeJiraClient();
    const payload = jiraPayload();

    await handleAgentTriggerJob(deps({ jiraClient }), payload);

    expect(jiraClient.getIssue).toHaveBeenCalledWith("PROJ-1");
    const issue = await database.jiraIssues.findByIssueKey("PROJ-1");
    expect(issue).toMatchObject({ summary: "Add password reset" });
    const task = await database.agentTasks.findByReceivedEventId(payload.receivedEventId);
    expect(task).not.toBeNull();
    expect(mockedRunTask).toHaveBeenCalledWith(expect.anything(), task?.id);
  });

  it("THE key property: retrying the same event never creates a second task", async () => {
    const jiraClient = fakeJiraClient();
    const payload = jiraPayload();

    await handleAgentTriggerJob(deps({ jiraClient }), payload);
    const firstTask = await database.agentTasks.findByReceivedEventId(payload.receivedEventId);

    // Simulates BullMQ retrying the whole handler after e.g. a transient error on the first
    // attempt's *next* step — the same job data, called again.
    await handleAgentTriggerJob(deps({ jiraClient }), payload);

    expect(jiraClient.getIssue).toHaveBeenCalledOnce();
    const tasksForRepo = await database.agentTasks.listByRepository(repositoryId);
    const matchingTasks = tasksForRepo.filter(
      (task) =>
        (task.trigger as { receivedEventId?: string }).receivedEventId === payload.receivedEventId,
    );
    expect(matchingTasks).toHaveLength(1);
    expect(mockedRunTask).toHaveBeenCalledTimes(2);
    expect(mockedRunTask).toHaveBeenNthCalledWith(2, expect.anything(), firstTask?.id);
  });

  it("skips without calling runTask when externalRefs has no issueKey", async () => {
    await handleAgentTriggerJob(deps(), jiraPayload({ externalRefs: {} }));
    expect(mockedRunTask).not.toHaveBeenCalled();
  });

  it("skips without calling runTask for an unknown repository", async () => {
    await handleAgentTriggerJob(deps(), jiraPayload({ repositoryId: createId() }));
    expect(mockedRunTask).not.toHaveBeenCalled();
  });

  it("skips github-sourced jobs without calling runTask (not implemented yet)", async () => {
    await handleAgentTriggerJob(
      deps(),
      jiraPayload({ source: "github", externalRefs: { prNumber: 7 } }),
    );
    expect(mockedRunTask).not.toHaveBeenCalled();
  });

  it("handles a direct-trigger job (VS Code's 'implement <KEY>') exactly like a jira one", async () => {
    const jiraClient = fakeJiraClient();
    const payload = jiraPayload({ source: "direct", eventType: "direct.implement_issue" });

    await handleAgentTriggerJob(deps({ jiraClient }), payload);

    expect(jiraClient.getIssue).toHaveBeenCalledWith("PROJ-1");
    const task = await database.agentTasks.findByReceivedEventId(payload.receivedEventId);
    expect(task).not.toBeNull();
    expect(mockedRunTask).toHaveBeenCalledWith(expect.anything(), task?.id);
  });
});
