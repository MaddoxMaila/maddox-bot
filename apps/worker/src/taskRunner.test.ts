import { Database, testDatabaseUrl } from "@maddox-bot/database";
import { createId, createLogger } from "@maddox-bot/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runImplementationPhase } from "./implementationPhase.js";
import { runPlannerPhase } from "./plannerPhase.js";
import { recoverIfStuck, requireTask, runTask } from "./taskRunner.js";
import type { WorkerDependencies } from "./workerDependencies.js";

vi.mock("./plannerPhase.js", () => ({ runPlannerPhase: vi.fn() }));
vi.mock("./implementationPhase.js", () => ({ runImplementationPhase: vi.fn() }));

const mockedPlannerPhase = vi.mocked(runPlannerPhase);
const mockedImplementationPhase = vi.mocked(runImplementationPhase);

describe("taskRunner", () => {
  const database = Database.forUrl(testDatabaseUrl());
  let organizationId: string;
  let repositoryId: string;

  function deps(overrides: Partial<WorkerDependencies> = {}): WorkerDependencies {
    return {
      database,
      // Only the recovery/dispatch logic under test ever runs — the mocked phase functions never
      // touch these, so plain placeholders are enough.
      agentTriggerQueue: undefined as never,
      llm: undefined as never,
      modelRouter: undefined as never,
      githubToken: "unused",
      githubClient: undefined as never,
      jiraClient: undefined as never,
      sandboxImage: "unused",
      gitIdentity: { name: "Bot", email: "bot@example.com" },
      autoApprovePlans: true,
      logger: createLogger("worker-test"),
      ...overrides,
    };
  }

  beforeAll(async () => {
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
    await database.disconnect();
  });

  beforeEach(() => {
    mockedPlannerPhase.mockReset().mockResolvedValue(undefined);
    mockedImplementationPhase.mockReset().mockResolvedValue(undefined);
  });

  async function createTask() {
    return database.agentTasks.create({ organizationId, repositoryId, trigger: {}, bounds: {} });
  }

  describe("recoverIfStuck", () => {
    it("restarts a crashed ANALYZING task from CREATED — the Planner has no external side effects", async () => {
      const task = await createTask();
      await database.agentTasks.updateState(task.id, "ANALYZING");
      const stuck = await requireTask(deps(), task.id);

      const recovered = await recoverIfStuck(deps(), stuck);

      expect(recovered.state).toBe("CREATED");
    });

    it("restarts the Implementation Agent from AWAITING_APPROVAL when no PR exists yet", async () => {
      const task = await createTask();
      for (const state of [
        "ANALYZING",
        "PLANNED",
        "AWAITING_APPROVAL",
        "IMPLEMENTING",
        "TESTING",
        "FIXING",
      ] as const) {
        await database.agentTasks.updateState(task.id, state);
      }
      const stuck = await requireTask(deps(), task.id);

      const recovered = await recoverIfStuck(deps(), stuck);

      expect(recovered.state).toBe("AWAITING_APPROVAL");
    });

    it("THE key property: fast-forwards to AWAITING_HUMAN_REVIEW instead of re-running the Implementation Agent when a PR already exists", async () => {
      const task = await createTask();
      for (const state of [
        "ANALYZING",
        "PLANNED",
        "AWAITING_APPROVAL",
        "IMPLEMENTING",
        "TESTING",
        "SELF_REVIEW",
        "PR_CREATED",
      ] as const) {
        await database.agentTasks.updateState(task.id, state);
      }
      await database.pullRequests.create({
        taskId: task.id,
        repositoryId,
        providerPrNumber: 4001,
        url: "https://github.com/acme/widgets/pull/1",
        title: "Already opened",
        body: "...",
        headBranch: "feature/x",
        baseBranch: "main",
      });
      const stuck = await requireTask(deps(), task.id);

      const recovered = await recoverIfStuck(deps(), stuck);

      expect(recovered.state).toBe("AWAITING_HUMAN_REVIEW");
    });

    it("leaves a task that isn't stuck untouched", async () => {
      const task = await createTask();
      const recovered = await recoverIfStuck(deps(), task);
      expect(recovered.state).toBe("CREATED");
    });
  });

  describe("runTask dispatch", () => {
    it("runs the Planner phase for a CREATED task, then the Implementation phase once auto-approved", async () => {
      const task = await createTask();
      mockedPlannerPhase.mockImplementation(async (_deps, t) => {
        await database.agentTasks.updatePlan(t.id, { summary: "x" });
        await database.agentTasks.updateState(t.id, "ANALYZING");
        await database.agentTasks.updateState(t.id, "PLANNED");
      });

      await runTask(deps(), task.id);

      expect(mockedPlannerPhase).toHaveBeenCalledOnce();
      expect(mockedImplementationPhase).toHaveBeenCalledOnce();
      const finalTask = await requireTask(deps(), task.id);
      expect(finalTask.state).toBe("AWAITING_APPROVAL");
    });

    it("does not run the Implementation phase when the Planner leaves the task BLOCKED", async () => {
      const task = await createTask();
      mockedPlannerPhase.mockImplementation(async (_deps, t) => {
        await database.agentTasks.updateState(t.id, "ANALYZING");
        await database.agentTasks.updateState(t.id, "BLOCKED");
      });

      await runTask(deps(), task.id);

      expect(mockedImplementationPhase).not.toHaveBeenCalled();
    });

    it("does not auto-approve or implement when autoApprovePlans is off", async () => {
      const task = await createTask();
      mockedPlannerPhase.mockImplementation(async (_deps, t) => {
        await database.agentTasks.updateState(t.id, "ANALYZING");
        await database.agentTasks.updateState(t.id, "PLANNED");
      });

      await runTask(deps({ autoApprovePlans: false }), task.id);

      expect(mockedImplementationPhase).not.toHaveBeenCalled();
      const finalTask = await requireTask(deps(), task.id);
      expect(finalTask.state).toBe("PLANNED");
    });

    it("THE key property: resuming a task that crashed after its PR was created never re-invokes the Implementation Agent", async () => {
      const task = await createTask();
      for (const state of [
        "ANALYZING",
        "PLANNED",
        "AWAITING_APPROVAL",
        "IMPLEMENTING",
        "TESTING",
        "SELF_REVIEW",
        "PR_CREATED",
      ] as const) {
        await database.agentTasks.updateState(task.id, state);
      }
      await database.pullRequests.create({
        taskId: task.id,
        repositoryId,
        providerPrNumber: 4002,
        url: "https://github.com/acme/widgets/pull/2",
        title: "Already opened",
        body: "...",
        headBranch: "feature/y",
        baseBranch: "main",
      });

      await runTask(deps(), task.id);

      expect(mockedImplementationPhase).not.toHaveBeenCalled();
      expect(mockedPlannerPhase).not.toHaveBeenCalled();
      const finalTask = await requireTask(deps(), task.id);
      expect(finalTask.state).toBe("AWAITING_HUMAN_REVIEW");
    });

    it("restarting a task stuck mid-implementation with no PR calls the Implementation phase exactly once", async () => {
      const task = await createTask();
      for (const state of ["ANALYZING", "PLANNED", "AWAITING_APPROVAL", "IMPLEMENTING"] as const) {
        await database.agentTasks.updateState(task.id, state);
      }
      await database.agentTasks.updatePlan(task.id, { summary: "x" });

      await runTask(deps(), task.id);

      expect(mockedImplementationPhase).toHaveBeenCalledOnce();
      expect(mockedPlannerPhase).not.toHaveBeenCalled();
    });
  });
});
