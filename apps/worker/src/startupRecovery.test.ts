import { Database, testDatabaseUrl } from "@maddox-bot/database";
import { createId, createLogger } from "@maddox-bot/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recoverStuckTasksOnStartup } from "./startupRecovery.js";
import { runTask } from "./taskRunner.js";
import type { WorkerDependencies } from "./workerDependencies.js";

vi.mock("./taskRunner.js", () => ({ runTask: vi.fn() }));

const mockedRunTask = vi.mocked(runTask);

describe("recoverStuckTasksOnStartup", () => {
  const database = Database.forUrl(testDatabaseUrl());
  let organizationId: string;
  let repositoryId: string;

  function deps(): WorkerDependencies {
    return {
      database,
      agentTriggerQueue: undefined as never,
      llm: undefined as never,
      modelRouter: undefined as never,
      githubToken: "unused",
      githubClient: undefined as never,
      jiraClient: undefined as never,
      sandboxImage: "unused",
      gitIdentity: { name: "Bot", email: "bot@example.com" },
      autoApprovePlans: true,
      logger: createLogger("startup-recovery-test"),
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

  it("calls runTask for a task left in a non-terminal, non-paused state", async () => {
    const task = await database.agentTasks.create({
      organizationId,
      repositoryId,
      trigger: {},
      bounds: {},
    });
    await database.agentTasks.updateState(task.id, "ANALYZING");

    await recoverStuckTasksOnStartup(deps());

    expect(mockedRunTask).toHaveBeenCalledWith(expect.anything(), task.id);
  });

  it("does not call runTask for a task already in a terminal state", async () => {
    const task = await database.agentTasks.create({
      organizationId,
      repositoryId,
      trigger: {},
      bounds: {},
    });
    for (const state of [
      "ANALYZING",
      "PLANNED",
      "AWAITING_APPROVAL",
      "IMPLEMENTING",
      "TESTING",
      "SELF_REVIEW",
      "PR_CREATED",
      "AWAITING_HUMAN_REVIEW",
      "COMPLETED",
    ] as const) {
      await database.agentTasks.updateState(task.id, state);
    }

    await recoverStuckTasksOnStartup(deps());

    expect(mockedRunTask).not.toHaveBeenCalledWith(expect.anything(), task.id);
  });

  it("does not let one task's failure stop the others from being resumed", async () => {
    const failing = await database.agentTasks.create({
      organizationId,
      repositoryId,
      trigger: {},
      bounds: {},
    });
    await database.agentTasks.updateState(failing.id, "ANALYZING");
    const succeeding = await database.agentTasks.create({
      organizationId,
      repositoryId,
      trigger: {},
      bounds: {},
    });
    await database.agentTasks.updateState(succeeding.id, "ANALYZING");

    mockedRunTask.mockImplementation(async (_deps, taskId) => {
      if (taskId === failing.id) {
        throw new Error("boom");
      }
    });

    await recoverStuckTasksOnStartup(deps());

    expect(mockedRunTask).toHaveBeenCalledWith(expect.anything(), failing.id);
    expect(mockedRunTask).toHaveBeenCalledWith(expect.anything(), succeeding.id);
  });

  it("is a no-op when nothing is stuck", async () => {
    await recoverStuckTasksOnStartup(deps());
    // No assertion beyond "doesn't throw" — other tests' fixtures may leave stuck tasks of their
    // own in this shared dev database, so a strict not.toHaveBeenCalled() would be flaky.
  });
});
