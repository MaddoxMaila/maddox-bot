import { createId } from "@maddox-bot/shared";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../testDatabaseUrl.js";
import { AgentTaskRepository } from "./agentTaskRepository.js";
import { TaskEventRepository } from "./taskEventRepository.js";

describe("TaskEventRepository", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  const agentTasks = new AgentTaskRepository(prisma);
  const repository = new TaskEventRepository(prisma);
  let organizationId: string;
  let repositoryId: string;
  let taskId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: `test-org-${createId()}` } });
    organizationId = org.id;
    const suffix = createId();
    const repo = await prisma.repository.create({
      data: {
        organizationId,
        owner: `owner-${suffix}`,
        name: `repo-${suffix}`,
        defaultBranch: "main",
        cloneUrl: `https://github.com/owner-${suffix}/repo-${suffix}.git`,
        agentTriggerConfig: {},
        branchNamingTemplate: "feature/<jira-key>-<kebab-summary>",
      },
    });
    repositoryId = repo.id;
    const task = await agentTasks.create({ organizationId, repositoryId, trigger: {}, bounds: {} });
    taskId = task.id;
  });

  afterAll(async () => {
    await prisma.taskEvent.deleteMany({ where: { taskId } });
    await prisma.agentTask.delete({ where: { id: taskId } });
    await prisma.repository.delete({ where: { id: repositoryId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("creates an event and round-trips its payload", async () => {
    const event = await repository.create({
      taskId,
      type: "state_changed",
      payload: { from: "CREATED", to: "ANALYZING" },
    });

    expect(event.type).toBe("state_changed");
    expect(event.payload).toEqual({ from: "CREATED", to: "ANALYZING" });
  });

  it("listByTask returns events for that task in chronological order", async () => {
    await repository.create({ taskId, type: "first", payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repository.create({ taskId, type: "second", payload: {} });

    const events = await repository.listByTask(taskId);
    const firstIndex = events.findIndex((event) => event.type === "first");
    const secondIndex = events.findIndex((event) => event.type === "second");

    expect(firstIndex).toBeLessThan(secondIndex);
  });
});
